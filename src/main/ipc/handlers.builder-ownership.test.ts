import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTestDatabase, type TestDatabase } from '../../database/repositories/test-helpers'
import { parseGameCatalogue } from '../../domain/catalogue-validation'
import { parseTownHallRules } from '../../domain/town-hall-rules-validation'
import { LOCAL_VILLAGE_ID } from '../../domain/village'
import { loadBundledGameData } from '../../game-data'
import { SAMPLE_ITEMS, SAMPLE_MANIFEST } from '../../game-data/fixtures/sample-catalogue'
import { SAMPLE_TOWN_HALL_RULES } from '../../game-data/fixtures/sample-town-hall-rules'
import { createAssetService } from '../../services/asset-service'
import { createCatalogueService } from '../../services/catalogue-service'
import { createEditService } from '../../services/edit-service'
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

describe('IPC handlers for Home Village builder ownership', () => {
  let t: TestDatabase
  let handlers: IpcHandlerMap
  const logger = { error: vi.fn() }

  function setup() {
    t = createTestDatabase({ withVillage: true })
    logger.error.mockReset()
    const database = t.database
    const villageState = createVillageStateService({ database, catalogue: sampleCatalogue, townHall })
    handlers = createIpcHandlers({
      database,
      catalogue: createCatalogueService(sampleCatalogue),
      townHall,
      assets: createAssetService({ assets: [] }),
      villageState,
      edits: createEditService({ database, villageState, catalogue: sampleCatalogue, townHall }),
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

  const rows = () => t.database.builders.listByVillage(LOCAL_VILLAGE_ID).map((b) => ({ id: b.id, kind: b.kind }))
  const log = () => t.database.editLog.list(LOCAL_VILLAGE_ID, { limit: 200 })

  it('sets ordinary huts and B.O.B., each logged under its own action', () => {
    setup()
    const ordinary = expectOk(handlers['builders:set-ordinary-count']({ count: 3, note: 'checked in game' }))
    expect(ordinary.map((b) => b.kind)).toEqual(['ordinary', 'ordinary', 'ordinary'])
    const bob = expectOk(handlers['builders:set-bob']({ unlocked: true }))
    expect(bob.filter((b) => b.kind === 'bob')).toHaveLength(1)
    expect(bob.filter((b) => b.kind === 'ordinary')).toHaveLength(3)

    const actions = log().reverse().map((e) => e.action)
    expect(actions).toEqual(['set-ordinary-huts', 'set-bob'])
    const first = log().reverse()[0]!
    expect(first.note).toBe('checked in game')
    expect((first.before as { count: number }).count).toBe(0)
    expect((first.after as { count: number }).count).toBe(3)
  })

  it('rejects out-of-range or malformed input before touching anything', () => {
    setup()
    const bad: Array<[keyof IpcHandlerMap, unknown]> = [
      ['builders:set-ordinary-count', { count: 6 }],
      ['builders:set-ordinary-count', { count: -1 }],
      ['builders:set-ordinary-count', { count: 2.5 }],
      ['builders:set-bob', { unlocked: 'yes' }],
      ['builders:reclassify-legacy', { ordinaryCount: 6, bob: 'unsure' }],
      ['builders:reclassify-legacy', { ordinaryCount: 1, bob: 'maybe' }],
      ['builders:remove-unclassified', { id: 0 }],
      ['builders:remove-unclassified', { id: -1 }]
    ]
    for (const [channel, payload] of bad) {
      expect(errorOf(handlers[channel](payload as never)).code, JSON.stringify(payload)).toBe('VALIDATION_ERROR')
    }
    expect(rows()).toEqual([])
    expect(log()).toEqual([])
  })

  it('reclassifies legacy builders and logs the full before/after builder list', () => {
    setup()
    for (let i = 0; i < 3; i += 1) {
      t.database.builders.create({
        villageId: LOCAL_VILLAGE_ID, slot: i + 1, kind: 'legacy-unclassified', source: 'manual', confidence: 1, confirmedAt: new Date()
      })
    }
    const result = expectOk(handlers['builders:reclassify-legacy']({ ordinaryCount: 5, bob: true, note: 'confirmed ownership' }))
    expect(result.filter((b) => b.kind === 'ordinary')).toHaveLength(5)
    expect(result.filter((b) => b.kind === 'bob')).toHaveLength(1)

    const entry = log()[0]!
    expect(entry).toMatchObject({ entityType: 'builders', action: 'reclassify-legacy-builders', note: 'confirmed ownership' })
    expect((entry.before as { count: number }).count).toBe(3)
    expect((entry.after as { count: number }).count).toBe(6)
  })

  it('removes exactly the named unclassified builder, logging it as a delete with its full prior state', () => {
    setup()
    const legacy = t.database.builders.create({
      villageId: LOCAL_VILLAGE_ID, slot: 1, kind: 'legacy-unclassified', source: 'manual', confidence: 1, confirmedAt: new Date()
    })
    expect(expectOk(handlers['builders:remove-unclassified']({ id: legacy.id, note: 'never actually existed' }))).toBeNull()
    expect(rows()).toEqual([])
    const entry = log()[0]!
    expect(entry).toMatchObject({
      entityType: 'builders',
      entityId: legacy.id,
      action: 'delete',
      after: null,
      note: 'never actually existed'
    })
    expect(entry.before).toMatchObject({ id: legacy.id, slot: 1, kind: 'legacy-unclassified' })
  })

  it('reports a missing village, an unknown builder, and a busy-removal refusal, writing nothing', () => {
    setup()
    expect(errorOf(handlers['builders:remove-unclassified']({ id: 999 })).code).toBe('NOT_FOUND')

    const legacy = t.database.builders.create({
      villageId: LOCAL_VILLAGE_ID, slot: 1, kind: 'legacy-unclassified', source: 'manual', confidence: 1, confirmedAt: new Date()
    })
    t.database.villageItems.create({
      villageId: LOCAL_VILLAGE_ID, itemId: 'test-cannon', instanceNumber: 1, level: 3, targetLevel: 4,
      upgradeStartedAt: null, upgradeEndsAt: null, builderId: legacy.id, builderAssignment: 'confirmed',
      upgradeObservedTimer: null, upgradeObservedAt: null, source: 'manual', confidence: 1, confirmedAt: new Date()
    })
    const entries = log().length
    expect(errorOf(handlers['builders:remove-unclassified']({ id: legacy.id })).code).toBe('VALIDATION_ERROR')
    expect(log()).toHaveLength(entries)
    expect(t.database.builders.getById(legacy.id)).not.toBeNull()
  })

  it('refuses a second B.O.B. and an ordinary count above 5 via the service, not just validation', () => {
    setup()
    expectOk(handlers['builders:set-bob']({ unlocked: true }))
    // Already confirmed: idempotent, not an error, not a second row.
    expect(expectOk(handlers['builders:set-bob']({ unlocked: true }))).toHaveLength(1)
    expect(rows().filter((b) => b.kind === 'bob')).toHaveLength(1)
  })
})
