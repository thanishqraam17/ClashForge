import type { ClashForgeDatabase } from '../database/client/database'
import type { ExportImport, ExportObservation } from '../database/repositories/import-repository'
import type { GameCatalogue } from '../domain/catalogue'
import type { ExportSemantics } from '../domain/export-semantics'
import { LOCAL_VILLAGE_ID } from '../domain/village'
import type { Provenance } from '../domain/village-state'
import { parseExport, type ExportParseIssue } from '../import/export-parser'
import {
  buildImportPlan,
  fingerprintState,
  type ConflictResolution,
  type ImportChange,
  type ImportPlan,
  type UpgradeConflict
} from '../import/import-planner'
import type { TownHallService } from './town-hall-service'
import { VillageNotInitialisedError, VillageStateNotFoundError, type VillageStateService } from './village-state-service'

export class ImportInvalidError extends Error {
  constructor(readonly issues: ExportParseIssue[]) {
    super(`The export could not be read: ${issues.map((i) => `${i.path} ${i.message}`).join('; ')}`)
    this.name = 'ImportInvalidError'
  }
}

export class StalePreviewError extends Error {
  constructor() {
    super('The village changed after this preview was made. Preview the export again.')
    this.name = 'StalePreviewError'
  }
}

export class ImportApplyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImportApplyError'
  }
}

/** What a preview stores and returns: the plan without the per-entry observations. */
export type ImportPlanSummary = Omit<ImportPlan, 'observations'> & { observationCount: number }

export type ImportPreview = {
  importId: number
  plan: ImportPlanSummary
}

export type ApplyImportInput = {
  importId: number
  acceptedChangeIds: string[]
  /** One entry per conflict on an accepted change, keyed by `conflictKey()`. */
  conflictResolutions: Record<string, ConflictResolution>
}

export type ApplyResult = {
  appliedChangeIds: string[]
  keptCurrent: string[]
  beforeSnapshotId: number
  afterSnapshotId: number
}

export function conflictKey(conflict: Pick<UpgradeConflict, 'kind' | 'recordId'>): string {
  return `${conflict.kind}:${conflict.recordId}`
}

export type ImportService = {
  previewText: (text: string) => ImportPreview
  apply: (input: ApplyImportInput) => ExportImport
  discard: (importId: number) => ExportImport
  list: (limit?: number) => ExportImport[]
  getObservations: (importId: number) => ExportObservation[]
}

export type ImportServiceDependencies = {
  database: ClashForgeDatabase
  catalogue: GameCatalogue
  semantics: ExportSemantics
  townHall: TownHallService
  villageState: VillageStateService
}

/** Order in which accepted changes are applied. */
const APPLY_ORDER: Record<ImportChange['kind'], number> = {
  'set-town-hall': 0,
  'remove-instances': 1,
  'change-levels': 2,
  'add-instances': 3,
  'imported-upgrades': 4,
  'set-research': 5
}

export function createImportService(deps: ImportServiceDependencies): ImportService {
  const { database, catalogue, semantics, townHall, villageState } = deps
  const villageId = LOCAL_VILLAGE_ID

  function currentPlanState() {
    const state = villageState.getState()
    if (state === null) throw new VillageNotInitialisedError()
    return { village: state.village, items: state.items, research: state.research }
  }

  function requireImport(importId: number): ExportImport {
    const record = database.imports.getById(importId)
    if (record === null || record.villageId !== villageId) {
      throw new VillageStateNotFoundError(`Import ${importId} does not exist`)
    }
    return record
  }

  function requirePending(importId: number): ExportImport {
    const record = requireImport(importId)
    if (record.status !== 'previewed') {
      throw new ImportApplyError(`Import ${importId} was already ${record.status}`)
    }
    return record
  }

  return {
    previewText(text) {
      const parsed = parseExport(text, Object.keys(semantics.sections))
      if (!parsed.ok) throw new ImportInvalidError(parsed.issues)
      return database.transaction(() => {
        const state = currentPlanState()
        const plan = buildImportPlan({
          parsed: parsed.export,
          catalogue,
          semantics,
          townHall,
          coverage: villageState.getCoverage(),
          state
        })
        const { observations, ...rest } = plan
        const summary: ImportPlanSummary = { ...rest, observationCount: observations.length }
        const record = database.imports.create({
          villageId,
          exportTimestamp: parsed.export.exportTimestamp,
          contentSha256: parsed.export.contentSha256,
          dataVersion: catalogue.manifest.datasetVersion,
          semanticsVersion: semantics.semanticsVersion,
          stateFingerprint: fingerprintState(state),
          summary
        })
        database.imports.addObservations(record.id, observations)
        return { importId: record.id, plan: summary }
      })
    },

    apply({ importId, acceptedChangeIds, conflictResolutions }) {
      return database.transaction(() => {
        const record = requirePending(importId)
        const state = currentPlanState()
        if (fingerprintState(state) !== record.stateFingerprint) throw new StalePreviewError()

        const plan = record.summary as ImportPlanSummary
        const byId = new Map(plan.changes.map((c) => [c.id, c]))
        const accepted = [...new Set(acceptedChangeIds)].map((id) => {
          const change = byId.get(id)
          if (!change) throw new ImportApplyError(`Change "${id}" is not part of this preview`)
          if (change.blockedReason) throw new ImportApplyError(`Change "${id}" is blocked: ${change.blockedReason}`)
          return change
        })
        const acceptedIds = new Set(accepted.map((c) => c.id))
        for (const change of accepted) {
          if (change.dependsOn && !acceptedIds.has(change.dependsOn)) {
            throw new ImportApplyError(`Change "${change.id}" also needs "${change.dependsOn}"`)
          }
        }

        // Every conflict on an accepted change needs an explicit decision; nothing else may be resolved.
        const expected = new Set(accepted.flatMap((c) => c.conflicts.map(conflictKey)))
        for (const key of expected) {
          if (!(key in conflictResolutions)) {
            throw new ImportApplyError(`Conflict "${key}" needs a resolution (keep-current or apply-export)`)
          }
        }
        for (const [key, value] of Object.entries(conflictResolutions)) {
          if (!expected.has(key)) throw new ImportApplyError(`Conflict "${key}" is not part of the accepted changes`)
          if (value !== 'keep-current' && value !== 'apply-export') {
            throw new ImportApplyError(`Conflict "${key}" has an invalid resolution`)
          }
        }
        const keepCurrent = (kind: UpgradeConflict['kind'], recordId: number | null): boolean =>
          recordId !== null && conflictResolutions[`${kind}:${recordId}`] === 'keep-current'

        const before = database.snapshots.capture({
          villageId,
          source: 'data-export',
          dataVersion: catalogue.manifest.datasetVersion
        })

        const now = new Date()
        const exportedAt = new Date(record.exportTimestamp * 1000)
        const provenanceFor = (change: ImportChange): Provenance => ({
          source: 'data-export',
          confidence: change.confidence,
          confirmedAt: now
        })
        const keptCurrent: string[] = []

        for (const change of [...accepted].sort((a, b) => APPLY_ORDER[a.kind] - APPLY_ORDER[b.kind])) {
          const provenance = provenanceFor(change)
          switch (change.kind) {
            case 'set-town-hall': {
              const village = database.villages.getVillage()!
              database.villages.updateVillage({ ...village, townHallLevel: change.toLevel })
              break
            }
            case 'remove-instances':
              for (const instance of change.instances) {
                if (keepCurrent('item-upgrade', instance.instanceId)) {
                  keptCurrent.push(`item-upgrade:${instance.instanceId}`)
                  continue
                }
                database.villageItems.delete(instance.instanceId)
              }
              break
            case 'change-levels':
              for (const target of change.instances) {
                if (keepCurrent('item-upgrade', target.instanceId)) {
                  keptCurrent.push(`item-upgrade:${target.instanceId}`)
                  continue
                }
                const instance = database.villageItems.getById(target.instanceId)!
                database.villageItems.update({
                  ...instance,
                  level: target.toLevel,
                  targetLevel: null,
                  upgradeStartedAt: null,
                  upgradeEndsAt: null,
                  builderId: null,
                  builderAssignment: null,
                  upgradeObservedTimer: null,
                  upgradeObservedAt: null,
                  ...provenance
                })
              }
              break
            case 'add-instances':
              for (const addition of change.instances) {
                villageState.saveItemInstance(
                  {
                    itemId: change.itemId,
                    instanceNumber: addition.instanceNumber,
                    level: addition.level,
                    targetLevel: null,
                    upgradeStartedAt: null,
                    upgradeEndsAt: null,
                    builderId: null
                  },
                  provenance
                )
              }
              break
            case 'imported-upgrades': {
              const village = database.villages.getVillage()!
              const limits = townHall.getItemAt(change.itemId, village.townHallLevel)
              for (const upgrade of change.instances) {
                if (keepCurrent('item-upgrade', upgrade.instanceId)) {
                  keptCurrent.push(`item-upgrade:${upgrade.instanceId}`)
                  continue
                }
                const instance =
                  upgrade.instanceId !== null
                    ? database.villageItems.getById(upgrade.instanceId)
                    : (database.villageItems
                        .listByItem(villageId, change.itemId)
                        .find((i) => i.instanceNumber === upgrade.instanceNumber) ?? null)
                if (instance === null) throw new ImportApplyError(`${change.itemName} #${upgrade.instanceNumber} is missing`)
                if (!limits || !limits.available || upgrade.level + 1 > limits.maxLevel) {
                  throw new ImportApplyError(`${change.itemName} cannot be upgraded past level ${upgrade.level} at this Town Hall`)
                }
                database.villageItems.update({
                  ...instance,
                  level: upgrade.level,
                  targetLevel: upgrade.level + 1,
                  upgradeStartedAt: null,
                  // Imported upgrades only exist under a verified "remaining seconds" rule.
                  upgradeEndsAt: new Date(exportedAt.getTime() + upgrade.observedTimer * 1000),
                  builderId: null,
                  builderAssignment: 'unknown',
                  upgradeObservedTimer: upgrade.observedTimer,
                  upgradeObservedAt: exportedAt,
                  ...provenance
                })
              }
              break
            }
            case 'set-research': {
              const research = change.researchId !== null ? database.researchStates.getById(change.researchId) : null
              if (research && research.targetLevel !== null && keepCurrent('research', research.id)) {
                keptCurrent.push(`research:${research.id}`)
                break
              }
              villageState.saveResearch(
                {
                  itemId: change.itemId,
                  level: change.toLevel,
                  targetLevel: null,
                  researchStartedAt: null,
                  researchEndsAt: null
                },
                provenance
              )
              break
            }
          }
        }

        const after = database.snapshots.capture({
          villageId,
          source: 'data-export',
          dataVersion: catalogue.manifest.datasetVersion
        })
        const result: ApplyResult = {
          appliedChangeIds: accepted.map((c) => c.id),
          keptCurrent,
          beforeSnapshotId: before.id,
          afterSnapshotId: after.id
        }
        return database.imports.markApplied(importId, result)
      })
    },

    discard(importId) {
      requirePending(importId)
      return database.imports.markDiscarded(importId)
    },

    list(limit = 50) {
      return database.imports.list(villageId, limit)
    },

    getObservations(importId) {
      requireImport(importId)
      return database.imports.listObservations(importId)
    }
  }
}
