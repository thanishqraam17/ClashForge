import { createHash } from 'crypto'
import type { ClashForgeDatabase } from '../database/client/database'
import type { ExportImport, ExportObservation } from '../database/repositories/import-repository'
import type { GameCatalogue } from '../domain/catalogue'
import type { ExportSemantics } from '../domain/export-semantics'
import type { TownHallRuleSet } from '../domain/town-hall-rules'
import { LOCAL_VILLAGE_ID } from '../domain/village'
import type { Provenance } from '../domain/village-state'
import { parseExport, type ExportParseIssue } from '../import/export-parser'
import {
  buildImportPlan,
  findTownHallViolations,
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
  constructor(message = 'The village changed after this preview was made. Preview the export again.') {
    super(message)
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
export type ImportPlanSummary = Omit<ImportPlan, 'observations'> & {
  observationCount: number
  /**
   * Hash of the catalogue, Town Hall rules and export semantics the plan was
   * built from. Catches data edits made without a version bump.
   */
  gameDataHash: string
}

export type ImportPreview = {
  importId: number
  plan: ImportPlanSummary
}

export type ApplyImportInput = {
  importId: number
  acceptedChangeIds: string[]
  /** One entry per conflict on an accepted change, keyed by `conflictKey()`. */
  conflictResolutions: Record<string, ConflictResolution>
  /**
   * The chosen interpretation for every accepted `ambiguous-instances` change,
   * keyed by change id. Required for those changes; nothing else may appear.
   */
  ambiguityChoices?: Record<string, string>
}

export type ApplyResult = {
  appliedChangeIds: string[]
  ambiguityChoices: Record<string, string>
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
  townHallRules: TownHallRuleSet
  semantics: ExportSemantics
  townHall: TownHallService
  villageState: VillageStateService
}

/** Order in which accepted changes are applied. */
const APPLY_ORDER: Record<ImportChange['kind'], number> = {
  'set-town-hall': 0,
  'remove-instances': 1,
  'ambiguous-instances': 2,
  'change-levels': 3,
  'complete-upgrades': 4,
  'add-instances': 5,
  'imported-upgrades': 6,
  'set-research': 7
}

/** Content hash of everything a plan depends on besides the village state. */
export function hashGameData(
  catalogue: GameCatalogue,
  townHallRules: TownHallRuleSet,
  semantics: ExportSemantics
): string {
  return createHash('sha256')
    .update(JSON.stringify({ catalogue, townHallRules, semantics }))
    .digest('hex')
}

export function createImportService(deps: ImportServiceDependencies): ImportService {
  const { database, catalogue, townHallRules, semantics, townHall, villageState } = deps
  const villageId = LOCAL_VILLAGE_ID
  const gameDataHash = hashGameData(catalogue, townHallRules, semantics)

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
        const summary: ImportPlanSummary = {
          ...rest,
          observationCount: observations.length,
          gameDataHash
        }
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

    apply({ importId, acceptedChangeIds, conflictResolutions, ambiguityChoices = {} }) {
      return database.transaction(() => {
        const record = requirePending(importId)
        const state = currentPlanState()
        if (fingerprintState(state) !== record.stateFingerprint) throw new StalePreviewError()

        // The preview must have been built from the same game data and export rules.
        const plan = record.summary as ImportPlanSummary
        if (
          record.dataVersion !== catalogue.manifest.datasetVersion ||
          record.semanticsVersion !== semantics.semanticsVersion ||
          plan.gameDataHash !== gameDataHash
        ) {
          throw new StalePreviewError(
            'The game data or import rules changed after this preview was made. Preview the export again.'
          )
        }

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

        // Every accepted ambiguous change needs exactly one valid interpretation;
        // no other choices are allowed.
        const chosen = new Map<string, Extract<ImportChange, { kind: 'ambiguous-instances' }>['interpretations'][number]>()
        for (const change of accepted) {
          if (change.kind !== 'ambiguous-instances') continue
          if (!(change.id in ambiguityChoices)) {
            throw new ImportApplyError(`Change "${change.id}" needs a chosen interpretation`)
          }
          const interpretation = change.interpretations.find((i) => i.id === ambiguityChoices[change.id])
          if (!interpretation) {
            throw new ImportApplyError(`"${String(ambiguityChoices[change.id])}" is not an interpretation of "${change.id}"`)
          }
          chosen.set(change.id, interpretation)
        }
        for (const key of Object.keys(ambiguityChoices)) {
          if (!chosen.has(key)) {
            throw new ImportApplyError(`"${key}" is not an accepted ambiguous change`)
          }
        }
        // A chosen interpretation already decides every instance it touches;
        // a conflict resolution for one of them would contradict it.
        for (const interpretation of chosen.values()) {
          const ops = interpretation.operations
          const touched = [
            ...ops.completions.map((o) => o.instanceId),
            ...ops.levelChanges.map((o) => o.instanceId),
            ...ops.removals.map((o) => o.instanceId),
            ...ops.stillUpgrading.map((o) => o.instanceId)
          ]
          for (const id of touched) {
            for (const kind of ['item-upgrade', 'item-decrease']) {
              if (`${kind}:${id}` in conflictResolutions) {
                throw new ImportApplyError(
                  `Conflict "${kind}:${id}" contradicts the chosen interpretation, which already decides it`
                )
              }
            }
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

        /** Sets an instance to `level` and clears any recorded upgrade. */
        const settleInstance = (instanceId: number, level: number, provenance: Provenance) => {
          const instance = database.villageItems.getById(instanceId)
          if (instance === null) throw new ImportApplyError(`Item instance ${instanceId} is missing`)
          database.villageItems.update({
            ...instance,
            level,
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
                if (keepCurrent('item-upgrade', target.instanceId) || keepCurrent('item-decrease', target.instanceId)) {
                  keptCurrent.push(`item:${target.instanceId}`)
                  continue
                }
                settleInstance(target.instanceId, target.toLevel, provenance)
              }
              break
            case 'complete-upgrades':
              for (const target of change.instances) {
                if (keepCurrent('item-upgrade', target.instanceId)) {
                  keptCurrent.push(`item-upgrade:${target.instanceId}`)
                  continue
                }
                settleInstance(target.instanceId, target.toLevel, provenance)
              }
              break
            case 'ambiguous-instances': {
              const ops = chosen.get(change.id)!.operations
              for (const removal of ops.removals) database.villageItems.delete(removal.instanceId)
              for (const levelChange of ops.levelChanges) settleInstance(levelChange.instanceId, levelChange.toLevel, provenance)
              for (const completion of ops.completions) settleInstance(completion.instanceId, completion.toLevel, provenance)
              for (const addition of ops.additions) {
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
            }
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
              if (
                research &&
                ((research.targetLevel !== null && keepCurrent('research', research.id)) ||
                  keepCurrent('research-decrease', research.id))
              ) {
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

        // A Town Hall change must leave the whole village within the new limits,
        // including items whose export changes were not accepted.
        if (acceptedIds.has('town-hall')) {
          const village = database.villages.getVillage()!
          const violations = findTownHallViolations(
            database.villageItems.listByVillage(villageId),
            database.researchStates.listByVillage(villageId),
            townHall,
            village.townHallLevel,
            (id) => catalogue.items.find((i) => i.id === id)?.name ?? id
          )
          if (violations.length > 0) {
            throw new ImportApplyError(
              `Town Hall ${village.townHallLevel} would leave the village above its limits: ${violations.join('; ')}`
            )
          }
        }

        const after = database.snapshots.capture({
          villageId,
          source: 'data-export',
          dataVersion: catalogue.manifest.datasetVersion
        })
        const result: ApplyResult = {
          appliedChangeIds: accepted.map((c) => c.id),
          ambiguityChoices: Object.fromEntries([...chosen].map(([id, i]) => [id, i.id])),
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
