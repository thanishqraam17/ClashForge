import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestDatabase, type TestDatabase } from '../database/repositories/test-helpers'
import { parseGameCatalogue } from '../domain/catalogue-validation'
import { parseTownHallRules } from '../domain/town-hall-rules-validation'
import { VillageStateValidationError } from '../domain/village-state'
import { SAMPLE_ITEMS, SAMPLE_MANIFEST } from '../game-data/fixtures/sample-catalogue'
import { SAMPLE_TOWN_HALL_RULES } from '../game-data/fixtures/sample-town-hall-rules'
import { createTownHallService } from './town-hall-service'
import {
  createVillageStateService,
  summariseHomeVillageBuilderOwnership,
  VillageStateNotFoundError,
  type ItemInstanceInput,
  type VillageStateService
} from './village-state-service'

const sampleCatalogue = parseGameCatalogue(SAMPLE_MANIFEST, SAMPLE_ITEMS)
const sampleRules = parseTownHallRules(SAMPLE_TOWN_HALL_RULES, sampleCatalogue)

function item(overrides: Partial<ItemInstanceInput> = {}): ItemInstanceInput {
  return {
    itemId: 'test-cannon',
    instanceNumber: 1,
    level: 3,
    targetLevel: null,
    upgradeStartedAt: null,
    upgradeEndsAt: null,
    builderId: null,
    ...overrides
  }
}

describe('legacy builder reclassification and removal', () => {
  let t: TestDatabase
  let service: VillageStateService

  beforeEach(() => {
    t = createTestDatabase({ withVillage: true })
    const townHall = createTownHallService(sampleCatalogue, sampleRules)
    service = createVillageStateService({ database: t.database, catalogue: sampleCatalogue, townHall })
  })

  afterEach(() => t.cleanup())

  const seedLegacy = (count: number) => {
    const used = new Set(t.database.builders.listByVillage(1).map((b) => b.slot))
    const created = []
    for (let i = 0; i < count; i += 1) {
      let slot = 1
      while (used.has(slot)) slot += 1
      used.add(slot)
      created.push(
        t.database.builders.create({
          villageId: 1,
          slot,
          kind: 'legacy-unclassified',
          source: 'manual',
          confidence: 1,
          confirmedAt: new Date(2026, 0, created.length + 1)
        })
      )
    }
    return created
  }
  const rows = () => t.database.builders.listByVillage(1).map((b) => ({ id: b.id, slot: b.slot, kind: b.kind }))
  const ownership = () => summariseHomeVillageBuilderOwnership(t.database.builders.listByVillage(1))

  describe('creating missing rows', () => {
    it('creates exactly the shortfall when legacy rows run out (your worked example)', () => {
      const legacy = seedLegacy(3)
      const result = service.reclassifyLegacyBuilders({ ordinaryCount: 5, bob: 'unsure' })
      expect(result.filter((b) => b.kind === 'ordinary')).toHaveLength(5)
      const after = rows()
      // All 3 legacy rows were converted (ids preserved), and exactly 2 new ones created.
      for (const row of legacy) expect(after.find((r) => r.id === row.id)).toMatchObject({ kind: 'ordinary' })
      expect(after.filter((r) => r.kind === 'ordinary')).toHaveLength(5)
      expect(after).toHaveLength(5)
      expect(ownership()).toMatchObject({ ordinaryConfirmed: 5, legacyUnclassified: 0 })
    })

    it('leaves the excess legacy row untouched when legacy outnumbers the confirmed target (your other example)', () => {
      seedLegacy(6)
      service.reclassifyLegacyBuilders({ ordinaryCount: 5, bob: false })
      const after = rows()
      expect(after.filter((r) => r.kind === 'ordinary')).toHaveLength(5)
      expect(after.filter((r) => r.kind === 'bob')).toHaveLength(0)
      expect(after.filter((r) => r.kind === 'legacy-unclassified')).toHaveLength(1)
      // Exactly 6 total, so the over-limit warning does not fire.
      expect(ownership()).toEqual({ ordinaryConfirmed: 5, bobConfirmed: false, legacyUnclassified: 1, exceedsLimit: false })
    })

    it('satisfies the ordinary shortfall before the B.O.B. shortfall, oldest legacy first', () => {
      const legacy = seedLegacy(4)
      service.reclassifyLegacyBuilders({ ordinaryCount: 3, bob: true })
      const after = t.database.builders.listByVillage(1)
      const byId = new Map(after.map((b) => [b.id, b.kind]))
      expect([byId.get(legacy[0]!.id), byId.get(legacy[1]!.id), byId.get(legacy[2]!.id)]).toEqual([
        'ordinary',
        'ordinary',
        'ordinary'
      ])
      expect(byId.get(legacy[3]!.id)).toBe('bob')
    })
  })

  describe('already-confirmed rows are accounted for first', () => {
    it('only consumes the shortfall against what is already confirmed', () => {
      service.setOrdinaryBuilderHuts(2)
      const legacy = seedLegacy(2)
      service.reclassifyLegacyBuilders({ ordinaryCount: 3, bob: 'unsure' })
      const after = rows()
      expect(after.filter((r) => r.kind === 'ordinary')).toHaveLength(3)
      expect(after.filter((r) => r.kind === 'legacy-unclassified')).toHaveLength(1)
      // The oldest legacy row was the one consumed.
      expect(after.find((r) => r.id === legacy[0]!.id)!.kind).toBe('ordinary')
      expect(after.find((r) => r.id === legacy[1]!.id)!.kind).toBe('legacy-unclassified')
    })

    it('never attempts a second bob row when one is already confirmed', () => {
      const [existingBob] = service.setBobUnlocked(true)
      seedLegacy(2)
      const result = service.reclassifyLegacyBuilders({ ordinaryCount: 0, bob: true })
      expect(result.filter((b) => b.kind === 'bob')).toEqual([expect.objectContaining({ id: existingBob!.id })])
      expect(rows().filter((r) => r.kind === 'legacy-unclassified')).toHaveLength(2)
    })

    it('refuses to shrink an already-confirmed count, directing to the correction methods', () => {
      service.setOrdinaryBuilderHuts(4)
      expect(() => service.reclassifyLegacyBuilders({ ordinaryCount: 2, bob: 'unsure' })).toThrow(
        'use setOrdinaryBuilderHuts to correct the count'
      )
      service.setBobUnlocked(true)
      expect(() => service.reclassifyLegacyBuilders({ ordinaryCount: 4, bob: false })).toThrow(
        'use setBobUnlocked to retract it'
      )
    })

    it('is a no-op when the target is already fully met, leaving legacy rows alone', () => {
      service.setOrdinaryBuilderHuts(3)
      seedLegacy(1)
      const before = rows()
      const result = service.reclassifyLegacyBuilders({ ordinaryCount: 3, bob: 'unsure' })
      expect(result.filter((b) => b.kind === 'ordinary')).toHaveLength(3)
      expect(rows()).toEqual(before)
    })
  })

  describe('a busy legacy row can still be classified', () => {
    it('relabels a legacy row with an active upgrade without disturbing the assignment', () => {
      const [legacy] = seedLegacy(1)
      const upgrading = service.saveItemInstance(item({ targetLevel: 4, builderId: legacy!.id }))

      service.reclassifyLegacyBuilders({ ordinaryCount: 0, bob: true })

      const builder = t.database.builders.getById(legacy!.id)!
      expect(builder.kind).toBe('bob')
      expect(t.database.villageItems.getById(upgrading.id)!.builderId).toBe(legacy!.id)
      expect(t.database.villageItems.getByBuilder(legacy!.id)?.id).toBe(upgrading.id)
    })
  })

  describe('stable builder ids', () => {
    it('never changes an id, whether relabelled or left alone', () => {
      const legacy = seedLegacy(5)
      const idsBefore = legacy.map((b) => b.id)
      service.reclassifyLegacyBuilders({ ordinaryCount: 3, bob: 'unsure' })
      const idsAfter = t.database.builders.listByVillage(1).map((b) => b.id)
      expect(idsAfter.sort()).toEqual(idsBefore.sort())
    })
  })

  describe('reclassification never needs to breach the limit', () => {
    it('always succeeds up to the 6-builder cap even with abundant legacy rows', () => {
      seedLegacy(9)
      expect(() => service.reclassifyLegacyBuilders({ ordinaryCount: 5, bob: true })).not.toThrow()
      expect(ownership()).toMatchObject({ ordinaryConfirmed: 5, bobConfirmed: true })
    })
  })

  describe('removeUnclassifiedBuilder', () => {
    it('removes exactly the selected idle legacy builder, recording the full before/after via its slot', () => {
      const [a, b] = seedLegacy(2)
      service.removeUnclassifiedBuilder(a!.id)
      expect(rows().map((r) => r.id)).toEqual([b!.id])
    })

    it('refuses to remove a busy legacy builder', () => {
      const [legacy] = seedLegacy(1)
      service.saveItemInstance(item({ targetLevel: 4, builderId: legacy!.id }))
      expect(() => service.removeUnclassifiedBuilder(legacy!.id)).toThrow(
        'is busy; finish or reassign its upgrade first'
      )
      expect(t.database.builders.getById(legacy!.id)).not.toBeNull()
    })

    it('refuses to remove an ordinary or bob row through this action', () => {
      const [ordinary] = service.setOrdinaryBuilderHuts(1)
      expect(() => service.removeUnclassifiedBuilder(ordinary!.id)).toThrow(
        'Only an unclassified legacy builder can be removed this way'
      )
      const [bob] = service.setBobUnlocked(true)
      expect(() => service.removeUnclassifiedBuilder(bob!.id)).toThrow(
        'Only an unclassified legacy builder can be removed this way'
      )
    })

    it('reports an unknown builder', () => {
      expect(() => service.removeUnclassifiedBuilder(999)).toThrow(VillageStateNotFoundError)
    })

    it('never removes more than one row, and never automatically', () => {
      const legacy = seedLegacy(3)
      service.removeUnclassifiedBuilder(legacy[1]!.id)
      expect(rows()).toHaveLength(2)
      expect(rows().map((r) => r.id).sort()).toEqual([legacy[0]!.id, legacy[2]!.id].sort())
    })
  })

  describe('legacy counts above six', () => {
    it('surfaces the over-limit warning without blocking anything that already exists', () => {
      seedLegacy(10)
      expect(ownership()).toEqual({ ordinaryConfirmed: 0, bobConfirmed: false, legacyUnclassified: 10, exceedsLimit: true })
      expect(() => service.getState()).not.toThrow()
    })

    it('rejects an invalid reclassification shape before touching anything', () => {
      seedLegacy(2)
      expect(() => service.reclassifyLegacyBuilders({ ordinaryCount: 6, bob: 'unsure' })).toThrow(
        VillageStateValidationError
      )
      expect(() => service.reclassifyLegacyBuilders({ ordinaryCount: 1, bob: 'maybe' as never })).toThrow(
        VillageStateValidationError
      )
      expect(rows().every((r) => r.kind === 'legacy-unclassified')).toBe(true)
    })
  })
})
