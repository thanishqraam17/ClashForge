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

describe('Home Village builder ownership (ordinary huts and B.O.B.)', () => {
  let t: TestDatabase
  let service: VillageStateService

  beforeEach(() => {
    t = createTestDatabase({ withVillage: true })
    const townHall = createTownHallService(sampleCatalogue, sampleRules)
    service = createVillageStateService({ database: t.database, catalogue: sampleCatalogue, townHall })
  })

  afterEach(() => t.cleanup())

  const kinds = () => t.database.builders.listByVillage(1).map((b) => ({ id: b.id, slot: b.slot, kind: b.kind }))
  const ownership = () => summariseHomeVillageBuilderOwnership(t.database.builders.listByVillage(1))

  describe('setOrdinaryBuilderHuts', () => {
    it('creates ordinary rows up to 5 and rejects a 6th', () => {
      const result = service.setOrdinaryBuilderHuts(5)
      expect(result.map((b) => b.kind)).toEqual(['ordinary', 'ordinary', 'ordinary', 'ordinary', 'ordinary'])
      expect(ownership()).toEqual({ ordinaryConfirmed: 5, bobConfirmed: false, legacyUnclassified: 0, exceedsLimit: false })
      expect(() => service.setOrdinaryBuilderHuts(6)).toThrow('Ordinary Builder Huts must be between 0 and 5')
      expect(() => service.setOrdinaryBuilderHuts(-1)).toThrow(VillageStateValidationError)
    })

    it('never touches a legacy-unclassified or bob row', () => {
      t.database.builders.create({ villageId: 1, slot: 1, kind: 'legacy-unclassified', source: 'manual', confidence: 1, confirmedAt: new Date() })
      t.database.builders.create({ villageId: 1, slot: 2, kind: 'bob', source: 'manual', confidence: 1, confirmedAt: new Date() })
      service.setOrdinaryBuilderHuts(2)
      const rows = kinds()
      expect(rows.filter((b) => b.kind === 'legacy-unclassified')).toHaveLength(1)
      expect(rows.filter((b) => b.kind === 'bob')).toHaveLength(1)
      expect(rows.filter((b) => b.kind === 'ordinary')).toHaveLength(2)

      service.setOrdinaryBuilderHuts(0)
      const after = kinds()
      expect(after.filter((b) => b.kind === 'ordinary')).toHaveLength(0)
      expect(after.filter((b) => b.kind === 'legacy-unclassified')).toHaveLength(1)
      expect(after.filter((b) => b.kind === 'bob')).toHaveLength(1)
    })

    it('preserves ids and refuses to remove a busy ordinary hut', () => {
      const [a, b, c] = service.setOrdinaryBuilderHuts(3)
      service.saveItemInstance(item({ targetLevel: 4, builderId: c!.id }))
      expect(() => service.setOrdinaryBuilderHuts(2)).toThrow('is busy; finish or reassign its upgrade first')
      expect(t.database.builders.listByVillageAndKind(1, 'ordinary').map((x) => x.id).sort()).toEqual(
        [a!.id, b!.id, c!.id].sort()
      )
    })

    it('refuses to add builders beyond the limit while legacy rows already fill it', () => {
      for (let i = 0; i < 6; i += 1) {
        t.database.builders.create({ villageId: 1, slot: i + 1, kind: 'legacy-unclassified', source: 'manual', confidence: 1, confirmedAt: new Date() })
      }
      expect(() => service.setOrdinaryBuilderHuts(1)).toThrow(/more than the maximum of 6.*unclassified legacy/)
      expect(t.database.builders.listByVillageAndKind(1, 'ordinary')).toHaveLength(0)
    })
  })

  describe('setBobUnlocked', () => {
    it('creates exactly one bob row and is idempotent when already confirmed', () => {
      const first = service.setBobUnlocked(true)
      expect(first.map((b) => b.kind)).toEqual(['bob'])
      const bobId = first[0]!.id
      const second = service.setBobUnlocked(true)
      expect(second).toHaveLength(1)
      expect(second[0]!.id).toBe(bobId)
      expect(ownership()).toEqual({ ordinaryConfirmed: 0, bobConfirmed: true, legacyUnclassified: 0, exceedsLimit: false })
    })

    it('removes the bob row when un-set, and refuses while busy', () => {
      const [bob] = service.setBobUnlocked(true)
      const upgrading = service.saveItemInstance(item({ targetLevel: 4, builderId: bob!.id }))
      expect(() => service.setBobUnlocked(false)).toThrow('B.O.B. is busy; finish or reassign its upgrade first')

      // Finish the upgrade: clear every upgrade field, freeing the builder.
      service.saveItemInstance({
        ...item(),
        id: upgrading.id,
        level: 4,
        targetLevel: null,
        upgradeStartedAt: null,
        upgradeEndsAt: null,
        builderId: null
      })
      expect(service.setBobUnlocked(false)).toEqual([])
      expect(t.database.builders.listByVillageAndKind(1, 'bob')).toHaveLength(0)
    })

    it('un-setting when none exists is a harmless no-op', () => {
      expect(service.setBobUnlocked(false)).toEqual([])
    })

    it('never attempts to create a second bob row even under direct repository pressure', () => {
      service.setBobUnlocked(true)
      expect(() =>
        t.database.builders.create({ villageId: 1, slot: 2, kind: 'bob', source: 'manual', confidence: 1, confirmedAt: new Date() })
      ).toThrow(/UNIQUE/)
    })

    it('refuses to add while legacy rows already fill the limit', () => {
      for (let i = 0; i < 6; i += 1) {
        t.database.builders.create({ villageId: 1, slot: i + 1, kind: 'legacy-unclassified', source: 'manual', confidence: 1, confirmedAt: new Date() })
      }
      expect(() => service.setBobUnlocked(true)).toThrow(/more than the maximum of 6/)
    })
  })

  describe('summariseHomeVillageBuilderOwnership', () => {
    it('counts legacy rows toward neither confirmed total, but flags the total', () => {
      t.database.builders.create({ villageId: 1, slot: 1, kind: 'ordinary', source: 'manual', confidence: 1, confirmedAt: new Date() })
      for (let i = 0; i < 6; i += 1) {
        t.database.builders.create({ villageId: 1, slot: i + 2, kind: 'legacy-unclassified', source: 'manual', confidence: 1, confirmedAt: new Date() })
      }
      expect(ownership()).toEqual({ ordinaryConfirmed: 1, bobConfirmed: false, legacyUnclassified: 6, exceedsLimit: true })
    })

    it('does not flag a fully confirmed, in-limit village', () => {
      service.setOrdinaryBuilderHuts(5)
      service.setBobUnlocked(true)
      expect(ownership()).toEqual({ ordinaryConfirmed: 5, bobConfirmed: true, legacyUnclassified: 0, exceedsLimit: false })
    })
  })
})
