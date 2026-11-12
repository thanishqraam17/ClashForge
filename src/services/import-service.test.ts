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
const townHallRules = parseTownHallRules(SAMPLE_TOWN_HALL_RULES, catalogue)
const townHall = createTownHallService(catalogue, townHallRules)
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
    imports = createImportService({ database: t.database, catalogue, townHallRules, semantics, townHall, villageState })
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

    it('marks an upgrade finished only when told to, when the export shows its target level', () => {
      addCannons([3], 0)
      const { importId, plan } = imports.previewText(exportText({ buildings: [{ data: ID.cannon, lvl: 4, cnt: 1 }] }))
      const complete = plan.changes.find((c) => c.id === 'instances:test-cannon:complete')!
      expect(complete).toMatchObject({ kind: 'complete-upgrades', requiresIndividualAcceptance: true })
      expect(() =>
        imports.apply({ importId, acceptedChangeIds: [complete.id], conflictResolutions: {} })
      ).toThrow(/needs a resolution/)
      imports.apply({
        importId,
        acceptedChangeIds: [complete.id],
        conflictResolutions: { [conflictKey(complete.conflicts[0]!)]: 'apply-export' }
      })
      expect(cannons()[0]).toMatchObject({ level: 4, targetLevel: null, builderId: null, builderAssignment: null })
    })

    it('ends an active upgrade only when told to, when the export shows another level', () => {
      addCannons([3], 0)
      const { importId, plan } = imports.previewText(exportText({ buildings: [{ data: ID.cannon, lvl: 5, cnt: 1 }] }))
      const levels = plan.changes.find((c) => c.id === 'instances:test-cannon:levels')!
      imports.apply({
        importId,
        acceptedChangeIds: [levels.id],
        conflictResolutions: { [conflictKey(levels.conflicts[0]!)]: 'apply-export' }
      })
      expect(cannons()[0]).toMatchObject({ level: 5, targetLevel: null, builderId: null })
    })

    describe('ambiguous matches (audit F1/F2)', () => {
      const AMBIGUOUS = 'instances:test-cannon:ambiguous'

      function previewAuditCase() {
        addCannons([3, 3], 0) // #1 upgrading 3 -> 4, #2 idle at 3
        return imports.previewText(exportText({ buildings: [{ data: ID.cannon, lvl: 3, cnt: 1 }, { data: ID.cannon, lvl: 4, cnt: 1 }] }))
      }

      it('surfaces the audit case as an explicit choice and changes nothing by default', () => {
        const { importId, plan } = previewAuditCase()
        expect(plan.changes.map((c) => c.id)).toEqual([AMBIGUOUS])
        const change = plan.changes[0]!
        expect(change).toMatchObject({ kind: 'ambiguous-instances', requiresIndividualAcceptance: true, conflicts: [] })
        expect((change as Extract<typeof change, { kind: 'ambiguous-instances' }>).interpretations.map((i) => i.summary)).toEqual([
          ['Test Cannon #1: still upgrading 3 → 4', 'Test Cannon #2: level 3 → 4'],
          ['Test Cannon #1: upgrade to level 4 finished']
        ])
        imports.apply({ importId, acceptedChangeIds: [], conflictResolutions: {} })
        expect(cannons().map((c) => [c.level, c.targetLevel])).toEqual([[3, 4], [3, null]])
      })

      it('applies the "completed" interpretation exactly', () => {
        const { importId } = previewAuditCase()
        imports.apply({ importId, acceptedChangeIds: [AMBIGUOUS], conflictResolutions: {}, ambiguityChoices: { [AMBIGUOUS]: 'i2' } })
        expect(cannons().map((c) => [c.instanceNumber, c.level, c.targetLevel, c.source])).toEqual([
          [1, 4, null, 'data-export'],
          [2, 3, null, 'manual']
        ])
      })

      it('applies the "still upgrading" interpretation exactly', () => {
        const { importId } = previewAuditCase()
        const applied = imports.apply({
          importId,
          acceptedChangeIds: [AMBIGUOUS],
          conflictResolutions: {},
          ambiguityChoices: { [AMBIGUOUS]: 'i1' }
        })
        expect(cannons().map((c) => [c.instanceNumber, c.level, c.targetLevel, c.source])).toEqual([
          [1, 3, 4, 'manual'],
          [2, 4, null, 'data-export']
        ])
        expect((applied.applyResult as { ambiguityChoices: Record<string, string> }).ambiguityChoices).toEqual({
          [AMBIGUOUS]: 'i1'
        })
      })

      it('rejects missing, unknown, invalid and extra choices, and contradicting resolutions', () => {
        const { importId } = previewAuditCase()
        const apply = (ambiguityChoices: Record<string, string>, conflictResolutions = {}, acceptedChangeIds = [AMBIGUOUS]) =>
          imports.apply({ importId, acceptedChangeIds, conflictResolutions, ambiguityChoices })
        expect(() => apply({})).toThrow(`Change "${AMBIGUOUS}" needs a chosen interpretation`)
        expect(() => apply({ [AMBIGUOUS]: 'i9' })).toThrow(`"i9" is not an interpretation of "${AMBIGUOUS}"`)
        expect(() => apply({ [AMBIGUOUS]: 'i1', other: 'i1' })).toThrow('"other" is not an accepted ambiguous change')
        expect(() => apply({ [AMBIGUOUS]: 'i1' }, {}, [])).toThrow(`"${AMBIGUOUS}" is not an accepted ambiguous change`)
        const upgradingId = t.database.villageItems.listByItem(LOCAL_VILLAGE_ID, 'test-cannon')[0]!.id
        expect(() => apply({ [AMBIGUOUS]: 'i2' }, { [`item-upgrade:${upgradingId}`]: 'keep-current' })).toThrow(
          `Conflict "item-upgrade:${upgradingId}" contradicts the chosen interpretation, which already decides it`
        )
        expect(t.database.imports.getById(importId)!.status).toBe('previewed')
        expect(cannons().map((c) => [c.level, c.targetLevel])).toEqual([[3, 4], [3, null]])
      })

      it('surfaces same-level instances with different provenance (F2)', () => {
        villageState.saveItemInstance({ itemId: 'test-cannon', instanceNumber: 1, level: 3, targetLevel: null, upgradeStartedAt: null, upgradeEndsAt: null, builderId: null })
        villageState.saveItemInstance(
          { itemId: 'test-cannon', instanceNumber: 2, level: 3, targetLevel: null, upgradeStartedAt: null, upgradeEndsAt: null, builderId: null },
          { source: 'timer-estimate', confidence: 0.3, confirmedAt: null }
        )
        const { importId, plan } = imports.previewText(exportText({ buildings: [{ data: ID.cannon, lvl: 3, cnt: 1 }, { data: ID.cannon, lvl: 5, cnt: 1 }] }))
        const change = plan.changes.find((c) => c.id === AMBIGUOUS) as Extract<(typeof plan.changes)[number], { kind: 'ambiguous-instances' }>
        expect(change.interpretations.map((i) => i.summary)).toEqual([
          ['Test Cannon #2: level 3 → 5'],
          ['Test Cannon #1: level 3 → 5']
        ])
        imports.apply({ importId, acceptedChangeIds: [AMBIGUOUS], conflictResolutions: {}, ambiguityChoices: { [AMBIGUOUS]: 'i2' } })
        expect(cannons().map((c) => [c.instanceNumber, c.level, c.source])).toEqual([
          [1, 5, 'data-export'],
          [2, 3, 'timer-estimate']
        ])
      })

      it('rolls back an ambiguous apply that fails after some operations were written', () => {
        addCannons([3, 3], 0)
        // Export {3, 4, 4}: both interpretations add a third cannon after the completion/level change.
        const failing = createImportService({
          database: t.database,
          catalogue,
          townHallRules,
          semantics: SEMANTICS,
          townHall,
          villageState: {
            ...villageState,
            saveItemInstance: () => {
              throw new Error('simulated failure while adding an instance')
            }
          }
        })
        const { importId } = failing.previewText(
          exportText({ buildings: [{ data: ID.cannon, lvl: 3, cnt: 1 }, { data: ID.cannon, lvl: 4, cnt: 2 }] })
        )
        expect(() =>
          failing.apply({ importId, acceptedChangeIds: [AMBIGUOUS], conflictResolutions: {}, ambiguityChoices: { [AMBIGUOUS]: 'i2' } })
        ).toThrow('simulated failure while adding an instance')
        // The completion written before the failure is rolled back with everything else.
        expect(cannons().map((c) => [c.instanceNumber, c.level, c.targetLevel, c.source])).toEqual([
          [1, 3, 4, 'manual'],
          [2, 3, null, 'manual']
        ])
        expect(t.database.snapshots.list(LOCAL_VILLAGE_ID)).toEqual([])
        expect(t.database.imports.getById(importId)!.status).toBe('previewed')
      })
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

    describe('Town Hall downgrade', () => {
      beforeEach(() => {
        for (const n of [1, 2, 3]) {
          villageState.saveItemInstance({
            itemId: 'test-cannon', instanceNumber: n, level: 6, targetLevel: null,
            upgradeStartedAt: null, upgradeEndsAt: null, builderId: null
          })
        }
      })

      it('refuses the audit case: three level-6 cannons and an export saying Town Hall 2', () => {
        const { importId, plan } = imports.previewText(exportText({ buildings: [{ data: ID.hall, lvl: 2, cnt: 1 }] }))
        expect(plan.changes.find((c) => c.id === 'town-hall')!.blockedReason).toMatch(/above its limits/)
        expect(() => imports.apply({ importId, acceptedChangeIds: ['town-hall'], conflictResolutions: {} })).toThrow(
          /is blocked/
        )
        expect(t.database.villages.getVillage()!.townHallLevel).toBe(5)
      })

      it('rolls back when the fixing changes are declined', () => {
        const { importId } = imports.previewText(
          exportText({ buildings: [{ data: ID.hall, lvl: 2, cnt: 1 }, { data: ID.cannon, lvl: 2, cnt: 2 }] })
        )
        expect(() => imports.apply({ importId, acceptedChangeIds: ['town-hall'], conflictResolutions: {} })).toThrow(
          'Town Hall 2 would leave the village above its limits: Test Cannon: 3 recorded, limit 2; Test Cannon: level 6 recorded, limit 2'
        )
        expect(t.database.villages.getVillage()!.townHallLevel).toBe(5)
        expect(cannons().map((c) => c.level)).toEqual([6, 6, 6])
        expect(t.database.snapshots.list(LOCAL_VILLAGE_ID)).toEqual([])
        expect(t.database.imports.getById(importId)!.status).toBe('previewed')
      })

      it('applies when the village fits the new Town Hall', () => {
        const { importId } = imports.previewText(
          exportText({ buildings: [{ data: ID.hall, lvl: 2, cnt: 1 }, { data: ID.cannon, lvl: 2, cnt: 2 }] })
        )
        imports.apply({
          importId,
          acceptedChangeIds: ['town-hall', 'instances:test-cannon:levels', 'instances:test-cannon:remove'],
          conflictResolutions: {}
        })
        expect(t.database.villages.getVillage()!.townHallLevel).toBe(2)
        expect(cannons().map((c) => c.level)).toEqual([2, 2])
      })
    })

    it('still applies a Town Hall increase', () => {
      const { importId } = imports.previewText(exportText({ buildings: [{ data: ID.hall, lvl: 6, cnt: 1 }] }))
      imports.apply({ importId, acceptedChangeIds: ['town-hall'], conflictResolutions: {} })
      expect(t.database.villages.getVillage()!.townHallLevel).toBe(6)
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

    describe('stale game data or rules', () => {
      function previewThenApplyWith(overrides: Partial<Parameters<typeof createImportService>[0]>) {
        const { importId } = imports.previewText(exportText({ buildings: [{ data: ID.cannon, lvl: 3, cnt: 1 }] }))
        const later = createImportService({
          database: t.database,
          catalogue,
          townHallRules,
          semantics: SEMANTICS,
          townHall,
          villageState,
          ...overrides
        })
        const run = () =>
          later.apply({ importId, acceptedChangeIds: ['instances:test-cannon:add'], conflictResolutions: {} })
        return { importId, run }
      }

      it('rejects apply when the dataset version changed', () => {
        const { importId, run } = previewThenApplyWith({
          catalogue: { ...catalogue, manifest: { ...catalogue.manifest, datasetVersion: '9.9.9' } }
        })
        expect(run).toThrow(StalePreviewError)
        expect(run).toThrow(/game data or import rules changed/)
        expect(t.database.imports.getById(importId)!.status).toBe('previewed')
        expect(cannons()).toEqual([])
      })

      it('rejects apply when the export rules version changed', () => {
        const { importId, run } = previewThenApplyWith({ semantics: { ...SEMANTICS, semanticsVersion: '9.9.9' } })
        expect(run).toThrow(StalePreviewError)
        expect(t.database.imports.getById(importId)!.status).toBe('previewed')
      })

      it('rejects apply when the data changed without a version bump', () => {
        const editedRules = {
          ...townHallRules,
          items: townHallRules.items.map((r) =>
            r.itemId === 'test-cannon' ? { ...r, steps: r.steps.map((s) => ({ ...s, maxLevel: s.maxLevel + 1 })) } : r
          )
        }
        const { run } = previewThenApplyWith({ townHallRules: editedRules })
        expect(run).toThrow(StalePreviewError)
      })

      it('still applies when nothing changed', () => {
        const { run } = previewThenApplyWith({})
        expect(run).not.toThrow()
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
