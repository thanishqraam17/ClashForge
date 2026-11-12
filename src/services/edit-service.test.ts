import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDatabase, type TestDatabase } from '../database/repositories/test-helpers'
import { parseGameCatalogue } from '../domain/catalogue-validation'
import { EditLogValidationError } from '../domain/edit-log'
import { parseTownHallRules } from '../domain/town-hall-rules-validation'
import { LOCAL_VILLAGE_ID } from '../domain/village'
import { VillageStateValidationError } from '../domain/village-state'
import { SAMPLE_ITEMS, SAMPLE_MANIFEST } from '../game-data/fixtures/sample-catalogue'
import { SAMPLE_TOWN_HALL_RULES } from '../game-data/fixtures/sample-town-hall-rules'
import { createEditService, type EditService, type VillageEditInput } from './edit-service'
import { createTownHallService } from './town-hall-service'
import { createVillageStateService, VillageStateNotFoundError, type VillageStateService } from './village-state-service'

const catalogue = parseGameCatalogue(SAMPLE_MANIFEST, SAMPLE_ITEMS)
const townHall = createTownHallService(catalogue, parseTownHallRules(SAMPLE_TOWN_HALL_RULES, catalogue))

const village: VillageEditInput = {
  townHallLevel: 6,
  gold: 100,
  elixir: 200,
  darkElixir: 0,
  goldCapacity: 1000,
  elixirCapacity: 1000,
  darkElixirCapacity: 0,
  lastScannedAt: null
}

const cannon = (overrides: Record<string, unknown> = {}) => ({
  itemId: 'test-cannon',
  instanceNumber: 1,
  level: 3,
  targetLevel: null,
  upgradeStartedAt: null,
  upgradeEndsAt: null,
  builderId: null,
  ...overrides
})

describe('EditService', () => {
  let t: TestDatabase
  let villageState: VillageStateService
  let edits: EditService

  beforeEach(() => {
    t = createTestDatabase() // no village yet
    villageState = createVillageStateService({ database: t.database, catalogue, townHall })
    edits = createEditService({ database: t.database, villageState, catalogue, townHall })
  })

  afterEach(() => t.cleanup())

  const log = () => t.database.editLog.list(LOCAL_VILLAGE_ID).reverse()

  describe('village', () => {
    it('logs the first save as create and later saves as update, with every field', () => {
      edits.saveVillage(village, 'initial setup')
      edits.saveVillage({ ...village, gold: 150 })
      const [created, updated] = log()
      expect(created).toMatchObject({ entityType: 'village', entityId: 1, action: 'create', before: null, note: 'initial setup' })
      expect(created!.after).toMatchObject({ townHallLevel: 6, gold: 100, source: 'manual', confidence: 1 })
      expect(Object.keys(created!.after as object).sort()).toEqual([
        'confidence', 'confirmedAt', 'darkElixir', 'darkElixirCapacity', 'elixir', 'elixirCapacity',
        'gold', 'goldCapacity', 'lastScannedAt', 'source', 'townHallLevel'
      ])
      expect(updated).toMatchObject({ action: 'update', before: created!.after })
      expect((updated!.after as { gold: number }).gold).toBe(150)
    })

    it('rejects a Town Hall decrease that leaves items above the limits, writing nothing', () => {
      edits.saveVillage(village)
      edits.saveItemInstance(cannon({ level: 6 }))
      const entries = log().length
      expect(() => edits.saveVillage({ ...village, townHallLevel: 2 })).toThrow(
        'Town Hall 2 would leave the village above its limits: Test Cannon: level 6 recorded, limit 2'
      )
      expect(t.database.villages.getVillage()!.townHallLevel).toBe(6)
      expect(t.database.villageItems.listByVillage(LOCAL_VILLAGE_ID)[0]!.level).toBe(6)
      expect(log()).toHaveLength(entries)
    })

    it('allows a Town Hall decrease when everything still fits, and increases', () => {
      edits.saveVillage(village)
      edits.saveItemInstance(cannon({ level: 2 }))
      expect(() => edits.saveVillage({ ...village, townHallLevel: 2 })).not.toThrow()
      expect(() => edits.saveVillage({ ...village, townHallLevel: 7 })).not.toThrow()
    })
  })

  describe('item instances', () => {
    beforeEach(() => edits.saveVillage(village))

    it('logs create, update (with upgrade and builder state) and delete with full before and after', () => {
      const [builder] = edits.setBuilderCount(1)
      const created = edits.saveItemInstance(cannon(), 'added')
      edits.saveItemInstance(cannon({ id: created.id, targetLevel: 4, builderId: builder!.id }))
      edits.removeItemInstance(created.id, 'sold')
      const [, , create, update, remove] = log()
      expect(create).toMatchObject({ entityType: 'item-instance', entityId: created.id, itemId: 'test-cannon', action: 'create', before: null, note: 'added' })
      expect(Object.keys(create!.after as object).sort()).toEqual([
        'builderAssignment', 'builderId', 'confidence', 'confirmedAt', 'instanceNumber', 'itemId', 'level',
        'source', 'targetLevel', 'upgradeEndsAt', 'upgradeObservedAt', 'upgradeObservedTimer', 'upgradeStartedAt'
      ])
      expect(update).toMatchObject({ action: 'update', before: create!.after })
      expect(update!.after).toMatchObject({ targetLevel: 4, builderId: builder!.id, builderAssignment: 'confirmed' })
      expect(remove).toMatchObject({ action: 'delete', before: update!.after, after: null, note: 'sold' })
    })

    it('writes nothing when the existing validation rejects the edit', () => {
      const entries = log().length
      expect(() => edits.saveItemInstance(cannon({ level: 9 }))).toThrow(VillageStateValidationError)
      expect(() => edits.saveItemInstance(cannon({ itemId: 'made-up' }))).toThrow(/not in the game catalogue/)
      expect(() => edits.removeItemInstance(999)).toThrow(VillageStateNotFoundError)
      expect(log()).toHaveLength(entries)
    })

    it('keeps the F6 rule: no manual upgrade without a certainly free builder', () => {
      const [builder] = edits.setBuilderCount(1)
      t.database.villageItems.create({
        villageId: 1, itemId: 'test-cannon', instanceNumber: 2, level: 3, targetLevel: 4, upgradeStartedAt: null,
        upgradeEndsAt: null, builderId: null, builderAssignment: 'unknown', upgradeObservedTimer: 5,
        upgradeObservedAt: new Date(0), source: 'data-export', confidence: 0.9, confirmedAt: null
      })
      const entries = log().length
      expect(() => edits.saveItemInstance(cannon({ targetLevel: 4, builderId: builder!.id }))).toThrow(/No builder is certainly free/)
      expect(log()).toHaveLength(entries)
    })
  })

  describe('builders and research', () => {
    beforeEach(() => edits.saveVillage(village))

    it('logs builder count changes with every slot', () => {
      edits.setBuilderCount(2)
      edits.setBuilderCount(1)
      const [, grow, shrink] = log()
      expect(grow).toMatchObject({ entityType: 'builders', entityId: null, action: 'set-count' })
      expect(grow!.before).toEqual({ count: 0, builders: [] })
      expect((grow!.after as { count: number }).count).toBe(2)
      expect(shrink!.before).toEqual(grow!.after)
      expect((shrink!.after as { builders: unknown[] }).builders).toHaveLength(1)
    })

    it('logs research create, update and delete', () => {
      edits.saveResearch({ itemId: 'test-archer', level: 1, targetLevel: null, researchStartedAt: null, researchEndsAt: null })
      edits.saveResearch({ itemId: 'test-archer', level: 1, targetLevel: 2, researchStartedAt: null, researchEndsAt: null })
      edits.removeResearch('test-archer')
      const [, create, update, remove] = log()
      expect(create).toMatchObject({ entityType: 'research', itemId: 'test-archer', action: 'create', before: null })
      expect(update).toMatchObject({ action: 'update', before: create!.after })
      expect(update!.after).toMatchObject({ level: 1, targetLevel: 2 })
      expect(remove).toMatchObject({ action: 'delete', after: null })
      expect(() => edits.removeResearch('test-archer')).toThrow(VillageStateNotFoundError)
    })
  })

  describe('no-ops, notes and atomicity', () => {
    beforeEach(() => edits.saveVillage(village))

    it('writes no entry when a save leaves the persisted state identical', () => {
      // Freeze time so a repeated manual save re-confirms at the same instant.
      vi.useFakeTimers()
      try {
        vi.setSystemTime(new Date('2026-11-12T12:00:00.000Z'))
        edits.setBuilderCount(2)
        const created = edits.saveItemInstance(cannon())
        edits.saveResearch({ itemId: 'test-archer', level: 1, targetLevel: null, researchStartedAt: null, researchEndsAt: null })
        edits.saveVillage({ ...village, gold: 300 })
        const entries = log().length

        edits.setBuilderCount(2)
        edits.saveItemInstance(cannon({ id: created.id }))
        edits.saveResearch({ itemId: 'test-archer', level: 1, targetLevel: null, researchStartedAt: null, researchEndsAt: null })
        edits.saveVillage({ ...village, gold: 300 })
        expect(log()).toHaveLength(entries)

        // A later re-confirmation is a real change (confirmedAt moves) and is logged.
        vi.setSystemTime(new Date('2026-11-12T12:05:00.000Z'))
        edits.saveItemInstance(cannon({ id: created.id }))
        expect(log()).toHaveLength(entries + 1)
        const last = log().at(-1)!
        expect((last.before as { confirmedAt: string }).confirmedAt).toBe('2026-11-12T12:00:00.000Z')
        expect((last.after as { confirmedAt: string }).confirmedAt).toBe('2026-11-12T12:05:00.000Z')
      } finally {
        vi.useRealTimers()
      }
    })

    it('rejects an invalid note before writing anything, even for a no-op', () => {
      const entries = log().length
      expect(() => edits.saveItemInstance(cannon(), '   ')).toThrow(EditLogValidationError)
      expect(() => edits.setBuilderCount(0, 'x'.repeat(501))).toThrow(EditLogValidationError)
      expect(t.database.villageItems.listByVillage(1)).toEqual([])
      expect(log()).toHaveLength(entries)
    })

    it('rolls the change back when the log write itself fails', () => {
      // Same connection and transaction, but the log write fails after the change.
      const failingLog = {
        ...t.database,
        editLog: {
          append: () => {
            throw new Error('log write failed')
          }
        }
      } as unknown as typeof t.database
      const failing = createEditService({
        database: failingLog,
        villageState: createVillageStateService({ database: failingLog, catalogue, townHall }),
        catalogue,
        townHall
      })
      expect(() => failing.saveItemInstance(cannon())).toThrow('log write failed')
      expect(() => failing.setBuilderCount(3)).toThrow('log write failed')
      expect(() => failing.saveVillage({ ...village, gold: 999 })).toThrow('log write failed')
      expect(t.database.villageItems.listByVillage(1)).toEqual([])
      expect(t.database.builders.listByVillage(1)).toEqual([])
      expect(t.database.villages.getVillage()!.gold).toBe(100)
    })
  })
})
