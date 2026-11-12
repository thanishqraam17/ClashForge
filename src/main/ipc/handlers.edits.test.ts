import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLegacyTestDatabase, createTestDatabase, type TestDatabase } from '../../database/repositories/test-helpers'
import { parseGameCatalogue } from '../../domain/catalogue-validation'
import { parseTownHallRules } from '../../domain/town-hall-rules-validation'
import { LOCAL_VILLAGE_ID } from '../../domain/village'
import { loadBundledGameData } from '../../game-data'
import { SAMPLE_ITEMS, SAMPLE_MANIFEST } from '../../game-data/fixtures/sample-catalogue'
import { SAMPLE_TOWN_HALL_RULES } from '../../game-data/fixtures/sample-town-hall-rules'
import { createAssetService } from '../../services/asset-service'
import { createCatalogueService } from '../../services/catalogue-service'
import { createEditService, type EditService } from '../../services/edit-service'
import { createImportService } from '../../services/import-service'
import { createTownHallService } from '../../services/town-hall-service'
import { createVillageStateService } from '../../services/village-state-service'
import type { IpcErrorCode, IpcResult } from '../../shared/ipc/contracts'
import { createIpcHandlers, type IpcHandlerMap } from './handlers'

const sampleCatalogue = parseGameCatalogue(SAMPLE_MANIFEST, SAMPLE_ITEMS)
const sampleRules = parseTownHallRules(SAMPLE_TOWN_HALL_RULES, sampleCatalogue)
const townHall = createTownHallService(sampleCatalogue, sampleRules)

function expectOk<T>(result: IpcResult<T>): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`)
  return result.data
}

function errorOf(result: IpcResult<unknown>): { code: IpcErrorCode; message: string } {
  if (result.ok) throw new Error('expected an error')
  return result.error
}

const cannon = (instanceNumber: number, extra: Record<string, unknown> = {}) => ({
  itemId: 'test-cannon', instanceNumber, level: 3, targetLevel: null,
  upgradeStartedAt: null, upgradeEndsAt: null, builderId: null, ...extra
})

describe('IPC handlers for bulk edits, legacy reconciliation and the edit log', () => {
  let t: TestDatabase
  let handlers: IpcHandlerMap
  const logger = { error: vi.fn() }

  /** Legacy seed: Town Hall 5 village, all four archived records pending. */
  function setup(kind: 'legacy' | 'empty', override?: (edits: EditService) => EditService) {
    t = kind === 'legacy' ? createLegacyTestDatabase() : createTestDatabase()
    logger.error.mockReset()
    const database = t.database
    const villageState = createVillageStateService({ database, catalogue: sampleCatalogue, townHall })
    const edits = createEditService({ database, villageState, catalogue: sampleCatalogue, townHall })
    handlers = createIpcHandlers({
      database,
      catalogue: createCatalogueService(sampleCatalogue),
      townHall,
      assets: createAssetService({ assets: [] }),
      villageState,
      edits: override ? override(edits) : edits,
      imports: createImportService({
        database,
        catalogue: sampleCatalogue,
        townHallRules: sampleRules,
        semantics: loadBundledGameData().exportSemantics,
        townHall,
        villageState
      }),
      readClipboardText: () => '',
      pickExportFile: () => null,
      logger
    })
  }

  afterEach(() => t.cleanup())

  /** Everything a failed request must leave untouched. */
  const state = () => ({
    items: t.database.villageItems.listByVillage(LOCAL_VILLAGE_ID),
    research: t.database.researchStates.listByVillage(LOCAL_VILLAGE_ID),
    builders: t.database.builders.listByVillage(LOCAL_VILLAGE_ID),
    legacy: t.database.legacyRecords.list({ villageId: LOCAL_VILLAGE_ID }),
    log: t.database.editLog.list(LOCAL_VILLAGE_ID, { limit: 200 })
  })

  describe('bulk edits', () => {
    it('sets levels and counts, returning the batch, readable through edit-log:get-batch', () => {
      setup('legacy')
      const a = expectOk(handlers['village-items:save'](cannon(1)))
      const b = expectOk(handlers['village-items:save'](cannon(2)))

      const levels = expectOk(handlers['village-items:set-levels']({ itemId: 'test-cannon', level: 5, instances: 'all', note: 'checked in game' }))
      expect(levels).toEqual({ batchId: expect.any(String), created: [], updated: [a.id, b.id], removed: [] })

      const count = expectOk(handlers['village-items:set-count']({ itemId: 'test-cannon', count: 3, levelForAdditions: 1 }))
      expect(count.created).toHaveLength(1)
      const fewer = expectOk(handlers['village-items:set-count']({ itemId: 'test-cannon', count: 1, removeInstances: [a.id, count.created[0]!] }))
      expect(fewer.removed).toEqual([a.id, count.created[0]])

      const batch = expectOk(handlers['edit-log:get-batch']({ batchId: levels.batchId! }))
      expect(batch.map((e) => [e.entityId, e.action, e.note])).toEqual([
        [a.id, 'update', 'checked in game'],
        [b.id, 'update', 'checked in game']
      ])
      expect(typeof batch[0]!.createdAt).toBe('string')
      expect(structuredClone(batch)).toEqual(batch)

      const unchanged = expectOk(handlers['village-items:set-levels']({ itemId: 'test-cannon', level: 5, instances: [b.id] }))
      expect(unchanged).toEqual({ batchId: null, created: [], updated: [], removed: [] })
    })

    it('leaves business rules to the edit service, with no partial changes', () => {
      setup('legacy')
      const [builder] = expectOk(handlers['builders:set-count']({ count: 1 }))
      const idle = expectOk(handlers['village-items:save'](cannon(1)))
      const busy = expectOk(handlers['village-items:save'](cannon(2, { targetLevel: 4, builderId: builder!.id })))
      const before = state()

      const rejected: Array<[keyof IpcHandlerMap, unknown, RegExp]> = [
        ['village-items:set-levels', { itemId: 'test-cannon', level: 2, instances: 'all' }, /active upgrade; include it explicitly/],
        ['village-items:set-levels', { itemId: 'test-cannon', level: 2, instances: [idle.id, 9999] }, /Not instances of this item: 9999/],
        ['village-items:set-levels', { itemId: 'test-cannon', level: 2, instances: [idle.id], includeActiveUpgrades: [idle.id] }, /has no active upgrade/],
        ['village-items:set-levels', { itemId: 'test-cannon', level: 7, instances: [idle.id] }, /above Town Hall 5 limits/],
        ['village-items:set-levels', { itemId: 'test-knight', level: 1, instances: 'all' }, /unlocks at Town Hall 7/],
        ['village-items:set-count', { itemId: 'test-cannon', count: 4, levelForAdditions: 1 }, /above Town Hall 5 limits/],
        ['village-items:set-count', { itemId: 'test-cannon', count: 0 }, /Only 1 Test Cannon is idle/],
        ['village-items:set-count', { itemId: 'test-cannon', count: 1, removeInstances: [busy.id] }, /active upgrade/],
        ['village-items:set-count', { itemId: 'test-archer', count: 1, levelForAdditions: 1 }, /not recorded as building instances/]
      ]
      for (const [channel, payload, message] of rejected) {
        const error = errorOf(handlers[channel](payload as never))
        expect(error.code, JSON.stringify(payload)).toBe('VALIDATION_ERROR')
        expect(error.message).toMatch(message)
      }
      expect(state()).toEqual(before)
    })

    it('reports a missing village and an incomplete catalogue', () => {
      setup('empty')
      const missing = errorOf(handlers['village-items:set-levels']({ itemId: 'test-cannon', level: 1, instances: 'all' }))
      expect(missing.code).toBe('VILLAGE_NOT_INITIALISED')
      expect(errorOf(handlers['village-items:set-count']({ itemId: 'test-cannon', count: 1, levelForAdditions: 1 })).code).toBe(
        'VILLAGE_NOT_INITIALISED'
      )
      expect(errorOf(handlers['legacy:map']({ kind: 'building', id: 1, itemId: 'test-cannon' })).code).toBe('NOT_FOUND')
      expect(expectOk(handlers['edit-log:list'](undefined))).toEqual({ entries: [], nextBeforeId: null })
    })
  })

  describe('legacy reconciliation', () => {
    it('maps, dismisses and restores, returning the updated records', () => {
      setup('legacy')
      const mapped = expectOk(handlers['legacy:map']({ kind: 'building', id: 1, itemId: 'test-cannon', level: 2, note: 'old cannons' }))
      expect(mapped).toEqual({ batchId: expect.any(String), entity: 'item-instance', created: [expect.any(Number), expect.any(Number)] })
      expect(t.database.villageItems.listByItem(LOCAL_VILLAGE_ID, 'test-cannon').map((c) => c.level)).toEqual([2, 2])

      const dismissed = expectOk(handlers['legacy:dismiss']({ kind: 'building', id: 2, note: 'gone' }))
      expect(dismissed).toMatchObject({ kind: 'building', id: 2, status: 'dismissed', note: 'gone', isUpgrading: true })
      expect(typeof dismissed.reconciledAt).toBe('string')
      const restored = expectOk(handlers['legacy:restore']({ kind: 'building', id: 2 }))
      expect(restored).toMatchObject({ status: 'pending', reconciledAt: null, mappedItemId: null, note: null })

      const research = expectOk(handlers['legacy:map']({ kind: 'research', id: 1, itemId: 'test-archer' }))
      expect(research.entity).toBe('research')
      expect(expectOk(handlers['edit-log:get-batch']({ batchId: mapped.batchId })).map((e) => e.action)).toEqual([
        'map',
        'create',
        'create'
      ])
    })

    it('rejects wrong statuses, bad mappings and unknown records without changes', () => {
      setup('legacy')
      expectOk(handlers['legacy:map']({ kind: 'building', id: 1, itemId: 'test-cannon' }))
      expectOk(handlers['research:save']({ itemId: 'test-archer', level: 1, targetLevel: null, researchStartedAt: null, researchEndsAt: null }))
      const before = state()
      const cases: Array<[keyof IpcHandlerMap, unknown, IpcErrorCode, RegExp]> = [
        ['legacy:map', { kind: 'building', id: 1, itemId: 'test-cannon' }, 'VALIDATION_ERROR', /is converted, not pending/],
        ['legacy:restore', { kind: 'building', id: 1 }, 'VALIDATION_ERROR', /is converted, not dismissed/],
        ['legacy:dismiss', { kind: 'building', id: 1 }, 'VALIDATION_ERROR', /is converted, not pending/],
        ['legacy:restore', { kind: 'hero', id: 1 }, 'VALIDATION_ERROR', /is pending, not dismissed/],
        ['legacy:map', { kind: 'research', id: 1, itemId: 'test-archer' }, 'VALIDATION_ERROR', /already recorded/],
        ['legacy:map', { kind: 'hero', id: 1, itemId: 'test-knight' }, 'VALIDATION_ERROR', /unlocks at Town Hall 7/],
        ['legacy:map', { kind: 'hero', id: 1, itemId: 'test-cannon' }, 'VALIDATION_ERROR', /cannot be mapped from an archived hero/],
        ['legacy:map', { kind: 'building', id: 2, itemId: 'made-up' }, 'VALIDATION_ERROR', /not in the game catalogue/],
        ['legacy:dismiss', { kind: 'hero', id: 42 }, 'NOT_FOUND', /No archived hero record 42/]
      ]
      for (const [channel, payload, code, message] of cases) {
        const error = errorOf(handlers[channel](payload as never))
        expect(error.code, JSON.stringify(payload)).toBe(code)
        expect(error.message).toMatch(message)
      }
      expect(state()).toEqual(before)
    })
  })

  describe('edit log', () => {
    it('pages without skipping or repeating entries, including an exactly full last page', () => {
      setup('legacy')
      for (let n = 1; n <= 3; n += 1) expectOk(handlers['village-items:save'](cannon(n)))
      for (let gold = 1; gold <= 3; gold += 1) {
        const v = t.database.villages.getVillage()!
        expectOk(handlers['village:save']({
          townHallLevel: 5, gold, elixir: v.elixir, darkElixir: v.darkElixir, goldCapacity: v.goldCapacity,
          elixirCapacity: v.elixirCapacity, darkElixirCapacity: v.darkElixirCapacity, lastScannedAt: null
        }))
      }
      const all = t.database.editLog.list(LOCAL_VILLAGE_ID).map((e) => e.id)
      expect(all.length).toBeGreaterThanOrEqual(6)

      for (const limit of [1, 2, 3, all.length, all.length + 1]) {
        const seen: number[] = []
        let beforeId: number | undefined
        for (let guard = 0; guard < 50; guard += 1) {
          const page = expectOk(handlers['edit-log:list']({ limit, ...(beforeId ? { beforeId } : {}) }))
          seen.push(...page.entries.map((e) => e.id))
          expect(page.entries.length).toBeLessThanOrEqual(limit)
          if (page.nextBeforeId === null) break
          expect(page.nextBeforeId).toBe(page.entries.at(-1)!.id)
          beforeId = page.nextBeforeId
        }
        expect(seen, `limit ${limit}`).toEqual(all)
      }

      const items = expectOk(handlers['edit-log:list']({ entityType: 'item-instance', limit: 3 }))
      expect(items.entries).toHaveLength(3)
      expect(items.nextBeforeId).toBeNull()
      expect(items.entries.every((e) => e.entityType === 'item-instance' && e.itemId === 'test-cannon')).toBe(true)
      const village = expectOk(handlers['edit-log:list']({ entityType: 'village', limit: 2 }))
      expect(village.entries.map((e) => (e.after as { gold: number }).gold)).toEqual([3, 2])
      expect(village.nextBeforeId).not.toBeNull()
      expect(expectOk(handlers['edit-log:list']({ itemId: 'test-mortar' })).entries).toEqual([])
    })

    it('accepts batch ids exactly as the service generates them, and reports unknown batches', () => {
      setup('legacy')
      const { batchId } = expectOk(handlers['legacy:map']({ kind: 'building', id: 2, itemId: 'test-mortar' }))
      expect(expectOk(handlers['edit-log:list']({ batchId })).entries).toHaveLength(2)
      const unknown = errorOf(handlers['edit-log:get-batch']({ batchId: '00000000-0000-4000-8000-000000000000' }))
      expect(unknown).toEqual({ code: 'NOT_FOUND', message: 'No edits were recorded under this batch' })
    })
  })

  describe('existing channels', () => {
    it('keep working without a note and record one when sent', () => {
      setup('legacy')
      const saved = expectOk(handlers['village-items:save'](cannon(1)))
      expectOk(handlers['village-items:save']({ ...cannon(1, { level: 4 }), id: saved.id, note: 'upgraded' }))
      expectOk(handlers['builders:set-count']({ count: 1, note: 'bought a hut' }))
      expectOk(handlers['research:save']({ itemId: 'test-archer', level: 1, targetLevel: null, researchStartedAt: null, researchEndsAt: null, note: null }))
      expectOk(handlers['research:remove']({ itemId: 'test-archer', note: 'typo' }))
      expectOk(handlers['village-items:remove']({ id: saved.id, note: 'sold' }))
      const notes = t.database.editLog.list(LOCAL_VILLAGE_ID).reverse().map((e) => [e.entityType, e.action, e.note])
      expect(notes).toEqual([
        ['item-instance', 'create', null],
        ['item-instance', 'update', 'upgraded'],
        ['builders', 'set-count', 'bought a hut'],
        ['research', 'create', null],
        ['research', 'delete', 'typo'],
        ['item-instance', 'delete', 'sold']
      ])
    })
  })

  describe('error translation', () => {
    it('hides internal failures behind INTERNAL_ERROR and logs the original only in the main process', () => {
      const internal = new Error('SQLITE_CONSTRAINT: CHECK constraint failed: edit_log')
      setup('legacy', (edits) => ({
        ...edits,
        setItemLevels: () => { throw internal },
        mapLegacyRecord: () => { throw internal }
      }))
      for (const result of [
        handlers['village-items:set-levels']({ itemId: 'test-cannon', level: 1, instances: 'all' }),
        handlers['legacy:map']({ kind: 'building', id: 1, itemId: 'test-cannon' })
      ]) {
        expect(result).toEqual({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' } })
      }
      expect(logger.error).toHaveBeenCalledTimes(2)
      expect(logger.error).toHaveBeenCalledWith('[ClashForge] IPC handler "village-items:set-levels" failed', internal)
    })

    it('rejects malformed input before reaching the service', () => {
      const calls: string[] = []
      setup('legacy', (edits) =>
        Object.fromEntries(
          Object.entries(edits).map(([name, fn]) => [name, (...args: never[]) => { calls.push(name); return (fn as (...a: never[]) => unknown)(...args) }])
        ) as EditService
      )
      const bad: Array<[keyof IpcHandlerMap, unknown]> = [
        ['village-items:set-levels', { itemId: 'test-cannon', level: 1, instances: 'some' }],
        ['village-items:set-levels', { itemId: 'test-cannon', level: 0, instances: 'all' }],
        ['village-items:set-count', { itemId: 'test-cannon', count: -1 }],
        ['legacy:map', { kind: 'castle', id: 1, itemId: 'test-cannon' }],
        ['legacy:dismiss', { kind: 'hero', id: 1, note: '' }],
        ['village-items:remove', { id: 1, note: 'x'.repeat(501) }],
        ['edit-log:list', { limit: 201 }],
        ['edit-log:get-batch', { batchId: 'not-a-batch' }]
      ]
      for (const [channel, payload] of bad) {
        expect(errorOf(handlers[channel](payload as never)).code, JSON.stringify(payload)).toBe('VALIDATION_ERROR')
      }
      expect(calls).toEqual([])
    })
  })
})
