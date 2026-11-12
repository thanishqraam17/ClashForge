import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ClashForgeDatabase } from '../../../database/client/database'
import { loadBundledGameData } from '../../../game-data'
import { createIpcHandlers, type IpcHandlerMap } from '../../../main/ipc/handlers'
import { openSampleVillage } from '../../../main/sample-data/sample-seed'
import { createAssetService } from '../../../services/asset-service'
import { createCatalogueService } from '../../../services/catalogue-service'
import { createEditService } from '../../../services/edit-service'
import { createImportService } from '../../../services/import-service'
import { createTownHallService } from '../../../services/town-hall-service'
import { createVillageStateService } from '../../../services/village-state-service'
import type { IpcResult, VillageItemDto, VillageStateDto } from '../../../shared/ipc/contracts'
import { summariseBulkCount, summariseBulkLevels } from './bulk-summary'
import {
  addInstanceRequest,
  assignBuilderRequest,
  bulkSetCountRequest,
  bulkSetLevelsRequest,
  cancelUpgradeRequest,
  finishUpgradeRequest,
  removeInstanceRequest,
  setLevelRequest,
  startUpgradeRequest
} from './edit-requests'
import { readVillageForm, villageFormFrom } from './village-form'
import { certainlyFreeBuilders, unknownBuilderUpgrades } from './village-view-model'

/**
 * Sends the renderer's payloads through the real IPC handlers and edit
 * service (sample village: Town Hall 6, 2 builders, cannon #2 upgrading on
 * builder 1, cannon #3 upgrading with an unknown builder).
 */

function ok<T>(result: IpcResult<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
  return result.data
}

describe('renderer payloads against the real IPC contract', () => {
  let userData: string
  let database: ClashForgeDatabase
  let handlers: IpcHandlerMap

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'clashforge-contract-'))
    const bundled = loadBundledGameData()
    const opened = openSampleVillage(userData, bundled)
    database = opened.database
    const { catalogue, townHallRules } = opened.gameData
    const townHall = createTownHallService(catalogue, townHallRules)
    const villageState = createVillageStateService({ database, catalogue, townHall })
    handlers = createIpcHandlers({
      database,
      catalogue: createCatalogueService(catalogue),
      townHall,
      assets: createAssetService({ assets: [] }),
      villageState,
      edits: createEditService({ database, villageState, catalogue, townHall }),
      imports: createImportService({ database, catalogue, townHallRules, semantics: bundled.exportSemantics, townHall, villageState }),
      readClipboardText: () => '',
      pickExportFile: () => null,
      logger: { error: () => undefined }
    })
  })

  afterEach(() => {
    database.close()
    rmSync(userData, { recursive: true, force: true })
  })

  const state = (): VillageStateDto => ok(handlers['village-state:get'](undefined))!
  const cannon = (n: number): VillageItemDto => state().items.find((i) => i.itemId === 'test-cannon' && i.instanceNumber === n)!
  const cannons = () => state().items.filter((i) => i.itemId === 'test-cannon')

  it('saves the village form payload', () => {
    const form = readVillageForm({ ...villageFormFrom(state().village), gold: '5000', note: 'counted' }, state().village)
    expect(form.ok).toBe(true)
    if (form.ok) expect(ok(handlers['village:save'](form.input)).gold).toBe(5000)
    expect(database.editLog.list(1)[0]!.note).toBe('counted')
  })

  it('finishes at the target level and cancels keeping the level, both freeing the builder', () => {
    const before = cannon(2)
    const finished = ok(handlers['village-items:save'](finishUpgradeRequest(before)))
    expect(finished).toMatchObject({ level: 4, targetLevel: null, upgradeEndsAt: null, builderId: null, builderAssignment: null })

    const unknown = cannon(3)
    const cancelled = ok(handlers['village-items:save'](cancelUpgradeRequest(unknown)))
    expect(cancelled).toMatchObject({ level: unknown.level, targetLevel: null, upgradeEndsAt: null, builderId: null, upgradeObservedTimer: null })
    expect(state().builders.every((b) => b.status === 'free')).toBe(true)
  })

  it('offers no builder while one may be busy, and the service rejects a possibly busy one', () => {
    // Builder 2 is idle on record, but the unknown-builder upgrade may be using it.
    expect(certainlyFreeBuilders(state())).toEqual([])
    const possiblyBusy = state().builders.find((b) => b.status === 'possibly-busy')!
    const rejected = handlers['village-items:save'](
      startUpgradeRequest(cannon(1), { targetLevel: 4, builderId: possiblyBusy.id, upgradeEndsAt: null })
    )
    expect(rejected.ok ? 'ok' : rejected.error.code).toBe('VALIDATION_ERROR')

    // Assigning the unknown upgrade to that builder resolves the uncertainty.
    const [unknown] = unknownBuilderUpgrades(state())
    ok(handlers['village-items:save'](assignBuilderRequest(unknown!, possiblyBusy.id)))
    expect(unknownBuilderUpgrades(state())).toEqual([])
    expect(certainlyFreeBuilders(state())).toEqual([])

    ok(handlers['builders:set-count']({ count: 3 }))
    const [free] = certainlyFreeBuilders(state())
    const started = ok(handlers['village-items:save'](
      startUpgradeRequest(cannon(1), { targetLevel: 4, builderId: free!.id, upgradeEndsAt: '2026-12-01T00:00:00.000Z', note: 'started' })
    ))
    expect(started).toMatchObject({ level: 3, targetLevel: 4, builderId: free!.id, upgradeEndsAt: '2026-12-01T00:00:00.000Z' })
  })

  it('sets levels, adds and removes single instances', () => {
    expect(ok(handlers['village-items:save'](setLevelRequest(cannon(1), 5))).level).toBe(5)
    ok(handlers['village-items:save'](finishUpgradeRequest(cannon(2))))
    ok(handlers['village-items:save'](cancelUpgradeRequest(cannon(3))))
    const added = ok(handlers['village-items:save'](addInstanceRequest('test-mortar', 2, 1, 'new')))
    expect(added).toMatchObject({ itemId: 'test-mortar', instanceNumber: 2, level: 1 })
    expect(ok(handlers['village-items:remove'](removeInstanceRequest(added, 'mistake')))).toBeNull()
  })

  it('bulk level summaries name exactly the instances the service updates', () => {
    const before = cannons()
    const unticked = summariseBulkLevels(before, { level: 2, selection: 'all', endUpgrades: new Set() })
    expect(unticked.canConfirm).toBe(false)
    expect(unticked.needsUpgradeChoice).toEqual([2, 3])
    const refused = handlers['village-items:set-levels'](bulkSetLevelsRequest(before, { itemId: 'test-cannon', level: 2, selection: 'all', endUpgrades: new Set() }))
    expect(refused.ok).toBe(false)

    const tick = new Set([cannon(2).id, cannon(3).id])
    const summary = summariseBulkLevels(before, { level: 2, selection: 'all', endUpgrades: tick })
    const result = ok(handlers['village-items:set-levels'](bulkSetLevelsRequest(before, { itemId: 'test-cannon', level: 2, selection: 'all', endUpgrades: tick })))
    expect([...result.updated].sort()).toEqual(summary.changes.map((c) => c.id).sort())
    expect(summary.changes.filter((c) => c.endsUpgradeTo !== null).map((c) => c.instanceNumber)).toEqual([2, 3])
    expect(cannons().every((c) => c.level === 2 && c.targetLevel === null)).toBe(true)
  })

  it('bulk count summaries predict the default removals and additions', () => {
    ok(handlers['village-items:save'](cancelUpgradeRequest(cannon(2))))
    ok(handlers['village-items:save'](cancelUpgradeRequest(cannon(3))))
    // Levels now: #1 3, #2 3, #3 2.
    const before = cannons()
    const remove = summariseBulkCount(before, { count: 1, endUpgrades: new Set() })
    const removed = ok(handlers['village-items:set-count'](bulkSetCountRequest(before, { itemId: 'test-cannon', count: 1, endUpgrades: new Set() })))
    expect(remove.kind === 'remove' && remove.removals.map((r) => r.id)).toEqual(removed.removed)

    const after = cannons()
    const add = summariseBulkCount(after, { count: 3, levelForAdditions: 1, endUpgrades: new Set() })
    const added = ok(handlers['village-items:set-count'](bulkSetCountRequest(after, { itemId: 'test-cannon', count: 3, levelForAdditions: 1, endUpgrades: new Set() })))
    const numbers = cannons().filter((c) => added.created.includes(c.id)).map((c) => c.instanceNumber).sort()
    expect(add.kind === 'add' && add.additions).toEqual(numbers)
  })

  it('removes an upgrading instance only when it is explicitly ticked', () => {
    const before = cannons()
    const target = cannon(2)
    const unticked = handlers['village-items:set-count'](
      bulkSetCountRequest(before, { itemId: 'test-cannon', count: 2, removeInstances: [target.id], endUpgrades: new Set() })
    )
    expect(unticked.ok).toBe(false)
    expect(cannons()).toHaveLength(3)
    const summary = summariseBulkCount(before, { count: 2, removeInstances: [target.id], endUpgrades: new Set([target.id]) })
    expect(summary).toMatchObject({ canConfirm: true, removals: [{ instanceNumber: 2, endsUpgradeTo: 4 }] })
    ok(handlers['village-items:set-count'](
      bulkSetCountRequest(before, { itemId: 'test-cannon', count: 2, removeInstances: [target.id], endUpgrades: new Set([target.id]) })
    ))
    expect(cannons().map((c) => c.instanceNumber)).toEqual([1, 3])
  })
})
