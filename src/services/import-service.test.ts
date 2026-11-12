import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestDatabase, type TestDatabase } from '../database/repositories/test-helpers'
import { parseGameCatalogue } from '../domain/catalogue-validation'
import { parseExportSemantics, type ExportSemantics } from '../domain/export-semantics'
import { parseTownHallRules } from '../domain/town-hall-rules-validation'
import { LOCAL_VILLAGE_ID } from '../domain/village'
import { loadBundledGameData } from '../game-data'
import { SAMPLE_ITEMS, SAMPLE_MANIFEST } from '../game-data/fixtures/sample-catalogue'
import { SAMPLE_TOWN_HALL_RULES } from '../game-data/fixtures/sample-town-hall-rules'
import {
  conflictKey,
  createImportService,
  ImportApplyError,
  ImportInvalidError,
  StalePreviewError,
  type ImportService
} from './import-service'
import { createTownHallService } from './town-hall-service'
import {
  createVillageStateService,
  VillageNotInitialisedError,
  type VillageStateService
} from './village-state-service'

const SEMANTICS = loadBundledGameData().exportSemantics
const VERIFIED_TIMERS: ExportSemantics = parseExportSemantics({
  ...JSON.parse(JSON.stringify(SEMANTICS)),
  rules: SEMANTICS.rules.map((r) =>
    r.meaning === 'upgrade-remaining-seconds'
      ? { ...r, status: 'verified', sections: ['buildings', 'traps', 'heroes'], evidence: 'test' }
      : r
  )
})
const catalogue = parseGameCatalogue(SAMPLE_MANIFEST, SAMPLE_ITEMS)
const townHall = createTownHallService(catalogue, parseTownHallRules(SAMPLE_TOWN_HALL_RULES, catalogue))
const ID = { hall: 900000001, cannon: 900000003, spikeTrap: 900000005, archer: 900000007 }
const EXPORT_TIME = 1704067200

function exportText(sections: Record<string, unknown>): string {
  return JSON.stringify({ tag: '#REDACTED', timestamp: EXPORT_TIME, buildings: [], ...sections })
}

describe('ImportService', () => {
  let t: TestDatabase
  let villageState: VillageStateService
  let imports: ImportService

  function setup(semantics: ExportSemantics = SEMANTICS, withVillage = true) {
    t = createTestDatabase({ withVillage }) // Town Hall 5
    villageState = createVillageStateService({ database: t.database, catalogue, townHall })
    imports = createImportService({ database: t.database, catalogue, semantics, townHall, villageState })
  }

  afterEach(() => t.cleanup())

  function cannons() {
    return t.database.villageItems.listByItem(LOCAL_VILLAGE_ID, 'test-cannon')
  }

  function addCannons(levels: number[], upgradingIndex?: number) {
    const builders = villageState.setBuilderCount(2)
    levels.forEach((level, i) =>
      villageState.saveItemInstance({
        itemId: 'test-cannon',
        instanceNumber: i + 1,
        level,
        targetLevel: i === upgradingIndex ? level + 1 : null,
        upgradeStartedAt: null,
        upgradeEndsAt: null,
        builderId: i === upgradingIndex ? builders[0]!.id : null
      })
    )
  }

  describe('preview', () => {
    beforeEach(() => setup())

    it('stores the import, its original timestamp and every observation', () => {
      const { importId, plan } = imports.previewText(
        exportText({ buildings: [{ data: ID.cannon, lvl: 3, cnt: 2 }, { data: 1000008, lvl: 2, cnt: 1 }] })
      )
      expect(plan.observationCount).toBe(2)
      expect('observations' in plan).toBe(false)
      const record = t.database.imports.getById(importId)!
      expect(record).toMatchObject({ status: 'previewed', exportTimestamp: EXPORT_TIME, semanticsVersion: '0.1.0' })
      expect(imports.getObservations(importId).map((o) => o.classification)).toEqual(['mapped', 'unmapped'])
    })

    it('rejects unreadable exports and requires a village', () => {
      expect(() => imports.previewText('{oops')).toThrow(ImportInvalidError)
      t.cleanup()
      setup(SEMANTICS, false)
      expect(() => imports.previewText(exportText({}))).toThrow(VillageNotInitialisedError)
    })
  })

  describe('apply', () => {
    beforeEach(() => setup())

    it('applies accepted changes with data-export provenance and snapshots before and after', () => {
      const { importId } = imports.previewText(exportText({ buildings: [{ data: ID.cannon, lvl: 3, cnt: 2 }] }))
      const applied = imports.apply({
        importId,
        acceptedChangeIds: ['instances:test-cannon:add'],
        conflictResolutions: {}
      })
      expect(applied.status).toBe('applied')
      const result = applied.applyResult as { beforeSnapshotId: number; afterSnapshotId: number; appliedChangeIds: string[] }
      expect(result.appliedChangeIds).toEqual(['instances:test-cannon:add'])
      expect(t.database.snapshots.getById(result.beforeSnapshotId)!.payload.items).toEqual([])
      expect(t.database.snapshots.getById(result.afterSnapshotId)!.payload.items).toHaveLength(2)

      const [first] = cannons()
      expect(first).toMatchObject({ level: 3, source: 'data-export', confidence: 0.95 })
      expect(first!.confirmedAt).toBeInstanceOf(Date)
    })

    it('keeps the lower confidence of inferred counts after acceptance', () => {
      const { importId } = imports.previewText(exportText({ traps: [{ data: ID.spikeTrap, lvl: 2 }] }))
      imports.apply({ importId, acceptedChangeIds: ['instances:test-spike-trap:add'], conflictResolutions: {} })
      const [trap] = t.database.villageItems.listByItem(LOCAL_VILLAGE_ID, 'test-spike-trap')
      expect(trap).toMatchObject({ confidence: 0.8, source: 'data-export' })
      expect(trap!.confirmedAt).toBeInstanceOf(Date)
    })

    it('refuses a preview made against a different village state', () => {
      const { importId } = imports.previewText(exportText({ buildings: [{ data: ID.cannon, lvl: 3, cnt: 1 }] }))
      addCannons([2])
      expect(() =>
        imports.apply({ importId, acceptedChangeIds: ['instances:test-cannon:add'], conflictResolutions: {} })
      ).toThrow(StalePreviewError)
      expect(t.database.imports.getById(importId)!.status).toBe('previewed')
    })

    it('requires a resolution for every conflict, and honours keep-current', () => {
      addCannons([3, 3], 0)
      const { importId, plan } = imports.previewText(exportText({ buildings: [{ data: ID.cannon, lvl: 5, cnt: 2 }] }))
      const levels = plan.changes.find((c) => c.id === 'instances:test-cannon:levels')!
      const key = conflictKey(levels.conflicts[0]!)

      expect(() =>
        imports.apply({ importId, acceptedChangeIds: [levels.id], conflictResolutions: {} })
      ).toThrow(`Conflict "${key}" needs a resolution`)

      imports.apply({ importId, acceptedChangeIds: [levels.id], conflictResolutions: { [key]: 'keep-current' } })
      expect(cannons().map((c) => [c.instanceNumber, c.level, c.targetLevel, c.source])).toEqual([
        [1, 3, 4, 'manual'],
        [2, 5, null, 'data-export']
      ])
    })

    it('ends an active upgrade only when told to apply the export', () => {
      addCannons([3], 0)
      const { importId, plan } = imports.previewText(exportText({ buildings: [{ data: ID.cannon, lvl: 4, cnt: 1 }] }))
      const levels = plan.changes.find((c) => c.id === 'instances:test-cannon:levels')!
      imports.apply({
        importId,
        acceptedChangeIds: [levels.id],
        conflictResolutions: { [conflictKey(levels.conflicts[0]!)]: 'apply-export' }
      })
      expect(cannons()[0]).toMatchObject({ level: 4, targetLevel: null, builderId: null, builderAssignment: null })
    })

    it('removes instances only when that change is accepted', () => {
      addCannons([3, 4])
      const preview = () => imports.previewText(exportText({ buildings: [{ data: ID.cannon, lvl: 3, cnt: 1 }] }))
      const first = preview()
      imports.apply({ importId: first.importId, acceptedChangeIds: [], conflictResolutions: {} })
      expect(cannons()).toHaveLength(2)

      const second = preview()
      imports.apply({
        importId: second.importId,
        acceptedChangeIds: ['instances:test-cannon:remove'],
        conflictResolutions: {}
      })
      expect(cannons().map((c) => c.level)).toEqual([3])
    })

    it('rejects unknown, blocked or incomplete selections and stray resolutions', () => {
      const { importId } = imports.previewText(
        exportText({ buildings: [{ data: ID.hall, lvl: 6, cnt: 1 }, { data: ID.cannon, lvl: 9, cnt: 1 }] })
      )
      const apply = (acceptedChangeIds: string[], conflictResolutions = {}) =>
        imports.apply({ importId, acceptedChangeIds, conflictResolutions })
      expect(() => apply(['nope'])).toThrow('Change "nope" is not part of this preview')
      expect(() => apply(['instances:test-cannon:add'])).toThrow(/is blocked/)
      expect(() => apply([], { 'item-upgrade:1': 'keep-current' })).toThrow(/not part of the accepted changes/)
      expect(t.database.imports.getById(importId)!.status).toBe('previewed')
    })

    it('requires the changes a change depends on', () => {
      const village = t.database.villages.getVillage()!
      t.database.villages.updateVillage({ ...village, townHallLevel: 6 })
      const { importId } = imports.previewText(
        exportText({ buildings: [{ data: ID.hall, lvl: 7, cnt: 1 }, { data: ID.cannon, lvl: 6, cnt: 1 }] })
      )
      expect(() =>
        imports.apply({ importId, acceptedChangeIds: ['instances:test-cannon:add'], conflictResolutions: {} })
      ).toThrow('Change "instances:test-cannon:add" also needs "town-hall"')
      imports.apply({ importId, acceptedChangeIds: ['town-hall', 'instances:test-cannon:add'], conflictResolutions: {} })
      expect(t.database.villages.getVillage()!.townHallLevel).toBe(7)
    })

    it('protects active research and applies research levels', () => {
      const village = t.database.villages.getVillage()!
      t.database.villages.updateVillage({ ...village, townHallLevel: 6 })
      villageState.saveResearch({ itemId: 'test-archer', level: 2, targetLevel: 3, researchStartedAt: null, researchEndsAt: null })
      const { importId, plan } = imports.previewText(exportText({ units: [{ data: ID.archer, lvl: 3 }] }))
      const change = plan.changes.find((c) => c.id === 'research:test-archer')!
      imports.apply({
        importId,
        acceptedChangeIds: [change.id],
        conflictResolutions: { [conflictKey(change.conflicts[0]!)]: 'keep-current' }
      })
      expect(t.database.researchStates.getByItem(LOCAL_VILLAGE_ID, 'test-archer')).toMatchObject({
        level: 2,
        targetLevel: 3,
        source: 'manual'
      })
    })

    it('discards a preview and refuses to apply it afterwards', () => {
      const { importId } = imports.previewText(exportText({ buildings: [{ data: ID.cannon, lvl: 3, cnt: 1 }] }))
      expect(imports.discard(importId).status).toBe('discarded')
      expect(() => imports.apply({ importId, acceptedChangeIds: [], conflictResolutions: {} })).toThrow(ImportApplyError)
      expect(imports.list().map((i) => i.status)).toEqual(['discarded'])
    })
  })

  describe('with verified timers (test semantics)', () => {
    beforeEach(() => setup(VERIFIED_TIMERS))

    it('records imported upgrades with an unknown builder and the raw timer', () => {
      villageState.setBuilderCount(2)
      const { importId } = imports.previewText(exportText({ traps: [{ data: ID.spikeTrap, lvl: 1, timer: 600 }] }))
      imports.apply({
        importId,
        acceptedChangeIds: ['instances:test-spike-trap:add', 'instances:test-spike-trap:upgrades-new'],
        conflictResolutions: {}
      })
      const [trap] = t.database.villageItems.listByItem(LOCAL_VILLAGE_ID, 'test-spike-trap')
      expect(trap).toMatchObject({
        level: 1,
        targetLevel: 2,
        builderId: null,
        builderAssignment: 'unknown',
        upgradeObservedTimer: 600,
        source: 'data-export'
      })
      expect(trap!.upgradeObservedAt?.toISOString()).toBe('2024-01-01T00:00:00.000Z')
      expect(trap!.upgradeEndsAt?.toISOString()).toBe('2024-01-01T00:10:00.000Z')

      const state = villageState.getState()!
      expect(state.builders.map((b) => b.status)).toEqual(['possibly-busy', 'possibly-busy'])
      expect(state.builderAvailability).toMatchObject({ freeMin: 1, freeMax: 2, isConfirmed: false })
    })

    it('rolls everything back when a change fails part-way', () => {
      // Spike trap max level is 2 at Town Hall 5: adding it at level 2 works, upgrading it cannot.
      const { importId } = imports.previewText(exportText({ traps: [{ data: ID.spikeTrap, lvl: 2, timer: 600 }] }))
      expect(() =>
        imports.apply({
          importId,
          acceptedChangeIds: ['instances:test-spike-trap:add', 'instances:test-spike-trap:upgrades-new'],
          conflictResolutions: {}
        })
      ).toThrow(/cannot be upgraded past level 2/)
      expect(t.database.villageItems.listByItem(LOCAL_VILLAGE_ID, 'test-spike-trap')).toEqual([])
      expect(t.database.snapshots.list(LOCAL_VILLAGE_ID)).toEqual([])
      expect(t.database.imports.getById(importId)!.status).toBe('previewed')
    })
  })
})
