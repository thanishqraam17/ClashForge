import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createLegacyTestDatabase, type TestDatabase } from '../database/repositories/test-helpers'
import { parseGameCatalogue } from '../domain/catalogue-validation'
import { EditLogValidationError } from '../domain/edit-log'
import { parseTownHallRules } from '../domain/town-hall-rules-validation'
import { LOCAL_VILLAGE_ID } from '../domain/village'
import { VillageStateValidationError } from '../domain/village-state'
import { SAMPLE_ITEMS, SAMPLE_MANIFEST } from '../game-data/fixtures/sample-catalogue'
import { SAMPLE_TOWN_HALL_RULES } from '../game-data/fixtures/sample-town-hall-rules'
import { createEditService, type EditService } from './edit-service'
import { createTownHallService } from './town-hall-service'
import { createVillageStateService, VillageStateNotFoundError } from './village-state-service'

const catalogue = parseGameCatalogue(SAMPLE_MANIFEST, SAMPLE_ITEMS)
const townHall = createTownHallService(catalogue, parseTownHallRules(SAMPLE_TOWN_HALL_RULES, catalogue))

// Legacy seed (Town Hall 5): building 1 Test Cannon x2 lvl 3; building 2 Mystery
// Tower lvl 1, upgrading; hero 1 Test Knight lvl 4; research 1 Test Archer lvl 2, researching.
const RECONCILIATION_COLUMNS = ['reconciliation_status', 'mapped_item_id', 'reconciliation_note', 'reconciled_at']
const TABLES = { building: 'legacy_buildings', hero: 'legacy_heroes', research: 'legacy_research' } as const

function makeService(database: TestDatabase['database']): EditService {
  const villageState = createVillageStateService({ database, catalogue, townHall })
  return createEditService({ database, villageState, catalogue, townHall })
}

describe('EditService legacy reconciliation', () => {
  let t: TestDatabase
  let edits: EditService

  beforeEach(() => {
    t = createLegacyTestDatabase()
    edits = makeService(t.database)
  })

  afterEach(() => t.cleanup())

  const log = () => t.database.editLog.list(LOCAL_VILLAGE_ID).reverse()

  /** Raw archived row, read through a separate read-only connection. */
  const rawRow = (kind: keyof typeof TABLES, id: number): Record<string, unknown> => {
    const raw = new Database(t.dbPath, { readonly: true })
    try {
      return raw.prepare(`SELECT * FROM ${TABLES[kind]} WHERE id = ?`).get(id) as Record<string, unknown>
    } finally {
      raw.close()
    }
  }
  const originalColumns = (row: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(row).filter(([key]) => !RECONCILIATION_COLUMNS.includes(key)))

  const raiseTownHall = (level: number) => {
    const v = t.database.villages.getVillage()!
    edits.saveVillage({
      townHallLevel: level,
      gold: v.gold,
      elixir: v.elixir,
      darkElixir: v.darkElixir,
      goldCapacity: v.goldCapacity,
      elixirCapacity: v.elixirCapacity,
      darkElixirCapacity: v.darkElixirCapacity,
      lastScannedAt: v.lastScannedAt
    })
  }

  describe('mapping', () => {
    it('creates quantity idle, manual, confirmed instances and logs one batch', () => {
      const raw = rawRow('building', 1)
      const result = edits.mapLegacyRecord({ kind: 'building', id: 1, itemId: 'test-cannon', note: 'mapped' })

      const cannons = t.database.villageItems.listByItem(LOCAL_VILLAGE_ID, 'test-cannon')
      expect(cannons.map((c) => [c.instanceNumber, c.level, c.targetLevel])).toEqual([
        [1, 3, null],
        [2, 3, null]
      ])
      expect(cannons.every((c) => c.source === 'manual' && c.confidence === 1 && c.confirmedAt !== null)).toBe(true)
      expect(result).toEqual({ batchId: expect.any(String), entity: 'item-instance', created: cannons.map((c) => c.id) })

      const record = t.database.legacyRecords.get('building', 1)!
      expect(record).toMatchObject({ status: 'converted', mappedItemId: 'test-cannon', note: 'mapped' })
      expect(record.reconciledAt).not.toBeNull()
      expect(originalColumns(rawRow('building', 1))).toEqual(originalColumns(raw))

      const entries = log()
      expect(entries).toHaveLength(3)
      expect(entries.every((e) => e.batchId === result.batchId && e.note === 'mapped')).toBe(true)
      const [map, ...creates] = entries
      expect(map).toMatchObject({ entityType: 'legacy-building', entityId: 1, itemId: 'test-cannon', action: 'map' })
      expect(map!.before).toMatchObject({ name: 'Test Cannon', quantity: 2, level: 3, status: 'pending', mappedItemId: null })
      expect(map!.after).toMatchObject({
        status: 'converted',
        mappedItemId: 'test-cannon',
        created: { entity: 'item-instance', ids: result.created },
        legacyWasUpgrading: false
      })
      expect(creates.map((e) => [e.entityType, e.action, e.entityId, e.before])).toEqual(
        result.created.map((id) => ['item-instance', 'create', id, null])
      )
    })

    it('makes an upgrading record idle at its recorded level and keeps the archived upgrade', () => {
      const raw = rawRow('building', 2)
      expect(raw.is_upgrading).toBe(1)
      const result = edits.mapLegacyRecord({ kind: 'building', id: 2, itemId: 'test-mortar' })
      const [mortar] = t.database.villageItems.listByItem(LOCAL_VILLAGE_ID, 'test-mortar')
      expect(mortar).toMatchObject({ id: result.created[0], level: 1, targetLevel: null, upgradeEndsAt: null, builderId: null })
      expect(originalColumns(rawRow('building', 2))).toEqual(originalColumns(raw))
      expect(t.database.legacyRecords.get('building', 2)).toMatchObject({
        isUpgrading: true,
        upgradeEndsAt: new Date('2026-09-15T00:00:00.000Z'),
        note: 'Mapped manually to Test Mortar'
      })
      expect(log()[0]!.after).toMatchObject({ legacyWasUpgrading: true, isUpgrading: true })
    })

    it('uses an explicit level correction and numbers new instances after existing ones', () => {
      edits.saveItemInstance({
        itemId: 'test-cannon', instanceNumber: 2, level: 5, targetLevel: null,
        upgradeStartedAt: null, upgradeEndsAt: null, builderId: null
      })
      edits.mapLegacyRecord({ kind: 'building', id: 2, itemId: 'test-cannon', level: 4 })
      const cannons = t.database.villageItems.listByItem(LOCAL_VILLAGE_ID, 'test-cannon')
      expect(cannons.map((c) => [c.instanceNumber, c.level])).toEqual([
        [1, 4],
        [2, 5]
      ])
    })

    it('maps research as an idle row at the archived level, and a hero once unlocked', () => {
      const research = edits.mapLegacyRecord({ kind: 'research', id: 1, itemId: 'test-archer' })
      expect(research.entity).toBe('research')
      expect(t.database.researchStates.getByItem(LOCAL_VILLAGE_ID, 'test-archer')).toMatchObject({
        id: research.created[0],
        level: 2,
        targetLevel: null,
        researchEndsAt: null,
        source: 'manual',
        confidence: 1
      })
      expect(rawRow('research', 1).is_researching).toBe(1)

      expect(() => edits.mapLegacyRecord({ kind: 'hero', id: 1, itemId: 'test-knight' })).toThrow(
        'Test Knight unlocks at Town Hall 7'
      )
      raiseTownHall(7)
      const hero = edits.mapLegacyRecord({ kind: 'hero', id: 1, itemId: 'test-knight' })
      expect(t.database.villageItems.listByItem(LOCAL_VILLAGE_ID, 'test-knight')).toEqual([
        expect.objectContaining({ id: hero.created[0], instanceNumber: 1, level: 4 })
      ])
      expect(log().filter((e) => e.batchId === hero.batchId).map((e) => e.entityType)).toEqual([
        'legacy-hero',
        'item-instance'
      ])
    })

    it('rejects invalid mappings, writing nothing', () => {
      const cases: Array<[Parameters<EditService['mapLegacyRecord']>[0], RegExp | (new (...a: never[]) => Error)]> = [
        [{ kind: 'building', id: 1, itemId: 'made-up' }, /not in the game catalogue/],
        [{ kind: 'building', id: 1, itemId: 'bb-test-cannon' }, /Builder Base/],
        [{ kind: 'building', id: 1, itemId: 'test-knight' }, /cannot be mapped from an archived building/],
        [{ kind: 'building', id: 1, itemId: 'test-archer' }, /cannot be mapped from an archived building/],
        [{ kind: 'hero', id: 1, itemId: 'test-cannon' }, /cannot be mapped from an archived hero/],
        [{ kind: 'research', id: 1, itemId: 'test-cannon' }, /cannot be mapped from an archived research/],
        [{ kind: 'building', id: 1, itemId: 'test-cannon', level: 7 }, /above Town Hall 5 limits/],
        [{ kind: 'building', id: 1, itemId: 'test-cannon', level: 0 }, /positive integer/],
        [{ kind: 'building', id: 1, itemId: 'test-cannon', level: 2.5 }, /positive integer/],
        [{ kind: 'building', id: 99, itemId: 'test-cannon' }, VillageStateNotFoundError],
        [{ kind: 'nope' as 'building', id: 1, itemId: 'test-cannon' }, /kind must be/],
        [{ kind: 'building', id: 1, itemId: 'test-cannon', note: ' ' }, EditLogValidationError]
      ]
      for (const [input, error] of cases) {
        expect(() => edits.mapLegacyRecord(input), JSON.stringify(input)).toThrow(error as never)
      }
      expect(t.database.villageItems.listByVillage(LOCAL_VILLAGE_ID)).toEqual([])
      expect(t.database.legacyRecords.countByStatus(LOCAL_VILLAGE_ID)).toEqual({ pending: 4, converted: 0, dismissed: 0 })
      expect(log()).toEqual([])
    })

    it('validates the quantity against the whole village', () => {
      for (const n of [1, 2]) {
        edits.saveItemInstance({
          itemId: 'test-cannon', instanceNumber: n, level: 3, targetLevel: null,
          upgradeStartedAt: null, upgradeEndsAt: null, builderId: null
        })
      }
      const entries = log().length
      expect(() => edits.mapLegacyRecord({ kind: 'building', id: 1, itemId: 'test-cannon' })).toThrow(
        /above Town Hall 5 limits/
      )
      expect(t.database.villageItems.listByItem(LOCAL_VILLAGE_ID, 'test-cannon')).toHaveLength(2)
      expect(t.database.legacyRecords.get('building', 1)!.status).toBe('pending')
      expect(log()).toHaveLength(entries)
    })

    it('rejects duplicate research and repeated mapping', () => {
      edits.saveResearch({ itemId: 'test-archer', level: 1, targetLevel: null, researchStartedAt: null, researchEndsAt: null })
      expect(() => edits.mapLegacyRecord({ kind: 'research', id: 1, itemId: 'test-archer' })).toThrow(
        'Research for Test Archer is already recorded'
      )
      expect(t.database.legacyRecords.get('research', 1)!.status).toBe('pending')

      edits.mapLegacyRecord({ kind: 'building', id: 1, itemId: 'test-cannon' })
      expect(() => edits.mapLegacyRecord({ kind: 'building', id: 1, itemId: 'test-cannon' })).toThrow(
        'Archived building "Test Cannon" is converted, not pending'
      )
      expect(() => edits.dismissLegacyRecord({ kind: 'building', id: 1 })).toThrow(/is converted, not pending/)
      expect(() => edits.restoreLegacyRecord({ kind: 'building', id: 1 })).toThrow(/is converted, not dismissed/)
      expect(t.database.villageItems.listByItem(LOCAL_VILLAGE_ID, 'test-cannon')).toHaveLength(2)
    })
  })

  describe('dismiss and restore', () => {
    it('dismisses and restores, changing only reconciliation fields and logging full states', () => {
      const raw = rawRow('building', 2)
      edits.dismissLegacyRecord({ kind: 'building', id: 2, note: 'demolished long ago' })
      expect(t.database.legacyRecords.get('building', 2)).toMatchObject({ status: 'dismissed', note: 'demolished long ago' })
      expect(t.database.legacyRecords.get('building', 2)!.reconciledAt).not.toBeNull()
      expect(() => edits.mapLegacyRecord({ kind: 'building', id: 2, itemId: 'test-cannon' })).toThrow(/is dismissed/)
      expect(() => edits.dismissLegacyRecord({ kind: 'building', id: 2 })).toThrow(/is dismissed, not pending/)

      edits.restoreLegacyRecord({ kind: 'building', id: 2, note: 'still there after all' })
      const restored = t.database.legacyRecords.get('building', 2)!
      expect(restored).toMatchObject({ status: 'pending', mappedItemId: null, reconciledAt: null, note: 'still there after all' })
      expect(originalColumns(rawRow('building', 2))).toEqual(originalColumns(raw))
      expect(() => edits.restoreLegacyRecord({ kind: 'building', id: 2 })).toThrow(/is pending, not dismissed/)

      const [dismiss, restore] = log()
      expect(dismiss).toMatchObject({ entityType: 'legacy-building', entityId: 2, action: 'dismiss', note: 'demolished long ago' })
      expect(dismiss!.before).toMatchObject({ status: 'pending', isUpgrading: true, upgradeEndsAt: '2026-09-15T00:00:00.000Z' })
      expect(dismiss!.after).toMatchObject({ status: 'dismissed', note: 'demolished long ago', isUpgrading: true })
      expect(restore).toMatchObject({ action: 'update', before: dismiss!.after, note: 'still there after all' })
      expect(restore!.after).toMatchObject({ status: 'pending', reconciledAt: null, note: 'still there after all' })
      expect(Object.keys(restore!.after as object).sort()).toEqual([
        'archivedAt', 'category', 'isUpgrading', 'kind', 'level', 'mappedItemId', 'name', 'note',
        'quantity', 'reconciledAt', 'status', 'upgradeEndsAt', 'upgradeStartedAt'
      ])

      // A restored record can be mapped normally.
      edits.mapLegacyRecord({ kind: 'building', id: 2, itemId: 'test-mortar' })
      expect(t.database.legacyRecords.get('building', 2)!.status).toBe('converted')
    })
  })

  describe('atomicity', () => {
    it('rolls everything back when the log write fails', () => {
      const failing = makeService({
        ...t.database,
        editLog: {
          ...t.database.editLog,
          append: () => { throw new Error('log write failed') },
          appendMany: () => { throw new Error('log write failed') }
        }
      } as unknown as TestDatabase['database'])
      expect(() => failing.mapLegacyRecord({ kind: 'building', id: 1, itemId: 'test-cannon' })).toThrow('log write failed')
      expect(() => failing.mapLegacyRecord({ kind: 'research', id: 1, itemId: 'test-archer' })).toThrow('log write failed')
      expect(() => failing.dismissLegacyRecord({ kind: 'hero', id: 1 })).toThrow('log write failed')
      expect(t.database.villageItems.listByVillage(LOCAL_VILLAGE_ID)).toEqual([])
      expect(t.database.researchStates.listByVillage(LOCAL_VILLAGE_ID)).toEqual([])
      expect(t.database.legacyRecords.countByStatus(LOCAL_VILLAGE_ID)).toEqual({ pending: 4, converted: 0, dismissed: 0 })
    })

    it('rolls back created instances when the archive update fails part-way', () => {
      const failing = makeService({
        ...t.database,
        legacyRecords: {
          get: t.database.legacyRecords.get.bind(t.database.legacyRecords),
          markConverted: () => { throw new Error('archive update failed') }
        }
      } as unknown as TestDatabase['database'])
      expect(() => failing.mapLegacyRecord({ kind: 'building', id: 1, itemId: 'test-cannon' })).toThrow('archive update failed')
      expect(t.database.villageItems.listByVillage(LOCAL_VILLAGE_ID)).toEqual([])
      expect(t.database.legacyRecords.get('building', 1)!.status).toBe('pending')
      expect(log()).toEqual([])
    })
  })
})
