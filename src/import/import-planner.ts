import { createHash } from 'crypto'
import type { ObservationClassification, ExportObservation } from '../database/repositories/import-repository'
import type { CatalogueItem, GameCatalogue, ItemCategory } from '../domain/catalogue'
import {
  findRule,
  isUsableStatus,
  type ExportSemantics,
  type SemanticMeaning
} from '../domain/export-semantics'
import type { Village } from '../domain/village'
import type { ResearchState, StateSource, VillageItemInstance } from '../domain/village-state'
import type { TownHallService } from '../services/town-hall-service'
import type { CatalogueCoverage } from '../services/village-state-service'
import type { ParsedEntry, ParsedExport, UnknownName } from './export-parser'

/**
 * Turns a parsed export into a reviewable plan of changes. Pure: it reads the
 * current state and returns proposals; nothing is written here.
 *
 * Rules:
 * - Only catalogue items with a verified `gameDataId` are mapped; nothing is guessed.
 * - Levels and explicit counts are observations. A missing count counts as one
 *   instance only through the `missing-count-is-one` rule, and every change that
 *   relies on it is marked `basis: 'inferred'`.
 * - A timer becomes an upgrade only when the timer rule is `verified`.
 * - Any change that touches an instance or research with an active upgrade is
 *   a conflict that needs an explicit resolution, whatever its source.
 * - Resources, storage capacities and builder count are never touched.
 */

const INSTANCE_CATEGORIES: readonly ItemCategory[] = [
  'town-hall', 'resource', 'army', 'defense', 'trap', 'wall', 'hero', 'other'
]
const RESEARCH_CATEGORIES: readonly ItemCategory[] = ['troop', 'spell', 'siege-machine']

export const UNTOUCHED_BY_IMPORT = ['resources', 'storage capacities', 'builder count'] as const

export type ChangeBasis = 'observed' | 'inferred'

export type UpgradeConflict = {
  kind: 'item-upgrade' | 'research'
  /** Village item instance id, or research row id. */
  recordId: number
  itemId: string
  instanceNumber: number | null
  currentLevel: number
  targetLevel: number
  source: StateSource
  builderAssignment: string | null
  /** What the export would do to it. */
  exportEffect: string
}

export type ConflictResolution = 'keep-current' | 'apply-export'

type ChangeBase = {
  /** Stable id used to accept the change. */
  id: string
  itemId: string
  itemName: string
  basis: ChangeBasis
  /** Reliability of the observation and interpretation behind the change (0–1). */
  confidence: number
  /** Removals and conflicting changes are never included in "accept all". */
  requiresIndividualAcceptance: boolean
  conflicts: UpgradeConflict[]
  /** Why the change cannot be applied, or null. */
  blockedReason: string | null
  /** Another change that must be accepted too (e.g. the Town Hall level it was validated against). */
  dependsOn: string | null
}

export type ImportChange =
  | (ChangeBase & { kind: 'set-town-hall'; fromLevel: number; toLevel: number })
  | (ChangeBase & {
      kind: 'add-instances'
      instances: Array<{ instanceNumber: number; level: number }>
    })
  | (ChangeBase & {
      kind: 'change-levels'
      instances: Array<{ instanceId: number; instanceNumber: number; fromLevel: number; toLevel: number }>
    })
  | (ChangeBase & {
      kind: 'remove-instances'
      instances: Array<{ instanceId: number; instanceNumber: number; level: number }>
    })
  | (ChangeBase & {
      kind: 'imported-upgrades'
      instances: Array<{
        instanceId: number | null
        instanceNumber: number
        level: number
        observedTimer: number
      }>
    })
  | (ChangeBase & {
      kind: 'set-research'
      researchId: number | null
      fromLevel: number | null
      toLevel: number
    })

export type ImportPlan = {
  exportTimestamp: number
  coverage: CatalogueCoverage
  townHall:
    | { status: 'not-mapped'; currentLevel: number }
    | { status: 'detected'; currentLevel: number; exportedLevel: number }
  changes: ImportChange[]
  observations: ExportObservation[]
  /** Entries whose count was inferred (no explicit `cnt`). */
  inferredCounts: Array<{ section: string; position: number; dataId: number }>
  unverifiedTimers: Array<{ section: string; position: number; dataId: number; level: number | null; timer: number }>
  unmapped: Array<{ section: string; dataId: number; entries: number; note: string }>
  outOfScopeSections: Array<{ section: string; entries: number }>
  unknownFields: UnknownName[]
  unknownSections: UnknownName[]
  untouched: readonly string[]
  warnings: string[]
}

export type PlanState = {
  village: Village
  items: VillageItemInstance[]
  research: ResearchState[]
}

export type PlanInput = {
  parsed: ParsedExport
  catalogue: GameCatalogue
  semantics: ExportSemantics
  townHall: TownHallService
  coverage: CatalogueCoverage
  state: PlanState
}

export class UnsupportedSemanticsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsupportedSemanticsError'
  }
}

/** Fingerprint of the state a plan was computed against, to detect stale previews. */
export function fingerprintState(state: PlanState): string {
  const canonical = {
    townHall: state.village.townHallLevel,
    items: state.items
      .map((i) => [i.id, i.itemId, i.instanceNumber, i.level, i.targetLevel, i.builderId, i.builderAssignment])
      .sort((a, b) => (a[0] as number) - (b[0] as number)),
    research: state.research
      .map((r) => [r.id, r.itemId, r.level, r.targetLevel])
      .sort((a, b) => (a[0] as number) - (b[0] as number))
  }
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
}

type ExportedInstance = {
  level: number
  /** Raw timer when it is interpreted as an upgrade (verified rule only). */
  upgradeTimer: number | null
  basis: ChangeBasis
}

export function buildImportPlan(input: PlanInput): ImportPlan {
  const { parsed, catalogue, semantics, townHall, coverage, state } = input
  const warnings: string[] = []
  const byGameDataId = new Map<number, CatalogueItem>()
  for (const item of catalogue.items) {
    if (item.gameDataId !== null && item.gameMode === 'home-village') byGameDataId.set(item.gameDataId, item)
  }

  const rule = (section: string, meaning: SemanticMeaning) => {
    const r = findRule(semantics, section, meaning)
    return r && isUsableStatus(r.status) ? r : null
  }

  // ---------------------------------------------------------------- classify entries
  const observations: ExportObservation[] = []
  const inferredCounts: ImportPlan['inferredCounts'] = []
  const unverifiedTimers: ImportPlan['unverifiedTimers'] = []
  const unmappedMap = new Map<string, { section: string; dataId: number; entries: number; note: string }>()
  const outOfScope = new Map<string, number>()
  const instanceEntries = new Map<string, Array<{ entry: ParsedEntry; item: CatalogueItem }>>()
  const researchEntries = new Map<string, Array<{ entry: ParsedEntry; item: CatalogueItem }>>()

  for (const entry of parsed.entries) {
    const scope = semantics.sections[entry.section]
    const timerRule = entry.timer !== null ? rule(entry.section, 'upgrade-remaining-seconds') : null
    let classification: ObservationClassification
    let mappedItemId: string | null = null

    if (scope === undefined) {
      classification = 'unknown-section'
    } else if (scope === 'out-of-scope') {
      classification = 'out-of-scope'
      outOfScope.set(entry.section, (outOfScope.get(entry.section) ?? 0) + 1)
    } else {
      const item = byGameDataId.get(entry.dataId)
      const allowed = scope === 'research' ? RESEARCH_CATEGORIES : INSTANCE_CATEGORIES
      if (item && allowed.includes(item.category)) {
        classification = 'mapped'
        mappedItemId = item.id
        const target = scope === 'research' ? researchEntries : instanceEntries
        target.set(item.id, [...(target.get(item.id) ?? []), { entry, item }])
      } else {
        classification = 'unmapped'
        const key = `${entry.section}:${entry.dataId}`
        const note = item
          ? `Id maps to ${item.name}, which cannot appear in "${entry.section}"`
          : 'No catalogue item has this game data id yet'
        const existing = unmappedMap.get(key)
        unmappedMap.set(key, { section: entry.section, dataId: entry.dataId, entries: (existing?.entries ?? 0) + 1, note })
      }
    }

    if (entry.timer !== null && !timerRule) {
      unverifiedTimers.push({
        section: entry.section,
        position: entry.position,
        dataId: entry.dataId,
        level: entry.level,
        timer: entry.timer
      })
    }
    if (entry.timer !== null && timerRule && scope === 'research') {
      throw new UnsupportedSemanticsError(
        `A verified timer rule covers research section "${entry.section}", but research timers are not supported yet`
      )
    }

    observations.push({
      section: entry.section,
      position: entry.position,
      dataId: entry.dataId,
      level: entry.level,
      count: entry.count,
      timer: entry.timer,
      gearUp: entry.gearUp,
      helperCooldown: entry.helperCooldown,
      helperRecurrent: entry.helperRecurrent,
      mappedItemId,
      classification,
      timerDisposition:
        entry.timer === null ? null : timerRule && scope === 'item-instances' ? 'applied-as-upgrade' : 'ignored-unverified'
    })
  }

  // ---------------------------------------------------------------- Town Hall
  const currentTownHall = state.village.townHallLevel
  const townHallEntries = [...instanceEntries.values()]
    .flat()
    .filter(({ item }) => item.category === 'town-hall')
  let townHallInfo: ImportPlan['townHall'] = { status: 'not-mapped', currentLevel: currentTownHall }
  const changes: ImportChange[] = []
  let effectiveTownHall = currentTownHall
  let townHallChangeId: string | null = null

  if (townHallEntries.length === 1 && townHallEntries[0]!.entry.level !== null && rule(townHallEntries[0]!.entry.section, 'level')) {
    const { entry, item } = townHallEntries[0]!
    const exportedLevel = entry.level!
    townHallInfo = { status: 'detected', currentLevel: currentTownHall, exportedLevel }
    effectiveTownHall = exportedLevel
    if (exportedLevel !== currentTownHall) {
      townHallChangeId = 'town-hall'
      changes.push({
        id: townHallChangeId,
        kind: 'set-town-hall',
        itemId: item.id,
        itemName: item.name,
        fromLevel: currentTownHall,
        toLevel: exportedLevel,
        basis: 'observed',
        confidence: rule(entry.section, 'level')!.confidence,
        requiresIndividualAcceptance: exportedLevel < currentTownHall,
        conflicts: [],
        blockedReason:
          coverage.maxTownHall !== null && exportedLevel > coverage.maxTownHall
            ? `Town Hall ${exportedLevel} is newer than the bundled game data`
            : null,
        dependsOn: null
      })
    }
  } else if (townHallEntries.length > 1) {
    warnings.push('The export lists the Town Hall more than once; the Town Hall level was not changed.')
  }

  const coverageBlock = coverage.canRecordItems ? null : coverage.reason
  const limitsAt = (itemId: string) => {
    try {
      return townHall.getItemAt(itemId, effectiveTownHall)
    } catch {
      return null
    }
  }

  // ---------------------------------------------------------------- item instances
  for (const [itemId, group] of instanceEntries) {
    const item = group[0]!.item
    if (item.category === 'town-hall') continue // handled above
    const exported: ExportedInstance[] = []
    let basis: ChangeBasis = 'observed'
    const confidences: number[] = []
    let countable = true

    for (const { entry } of group) {
      const levelRule = rule(entry.section, 'level')
      if (entry.level === null || !levelRule) {
        countable = false
        warnings.push(`${item.name}: level is missing or not usable in "${entry.section}"; not imported.`)
        break
      }
      confidences.push(levelRule.confidence)
      let count: number
      if (entry.count !== null) {
        const countRule = rule(entry.section, 'instance-count')
        if (!countRule) {
          countable = false
          warnings.push(`${item.name}: counts in "${entry.section}" are not usable; not imported.`)
          break
        }
        confidences.push(countRule.confidence)
        count = entry.count
      } else {
        const inferRule = rule(entry.section, 'missing-count-is-one')
        if (!inferRule) {
          countable = false
          warnings.push(`${item.name}: an entry has no count and no usable rule says what that means; not imported.`)
          break
        }
        confidences.push(inferRule.confidence)
        basis = 'inferred'
        inferredCounts.push({ section: entry.section, position: entry.position, dataId: entry.dataId })
        count = 1
      }
      const timerRule = entry.timer !== null ? rule(entry.section, 'upgrade-remaining-seconds') : null
      if (timerRule) confidences.push(timerRule.confidence)
      for (let i = 0; i < count; i += 1) {
        exported.push({
          level: entry.level,
          upgradeTimer: timerRule && i === 0 ? entry.timer : null,
          basis: entry.count === null ? 'inferred' : 'observed'
        })
      }
    }
    if (!countable) continue

    const confidence = Math.min(...confidences)
    const current = state.items.filter((i) => i.itemId === itemId)
    changes.push(
      ...planInstances({
        item,
        exported,
        current,
        basis,
        confidence,
        limits: limitsAt(itemId),
        effectiveTownHall,
        coverageBlock,
        dependsOn: townHallChangeId
      })
    )
  }

  // ---------------------------------------------------------------- research
  for (const [itemId, group] of researchEntries) {
    const item = group[0]!.item
    if (group.length > 1) {
      warnings.push(`${item.name} appears more than once in the export; research level not imported.`)
      continue
    }
    const { entry } = group[0]!
    const levelRule = rule(entry.section, 'level')
    if (entry.level === null || !levelRule) {
      warnings.push(`${item.name}: research level is missing or not usable; not imported.`)
      continue
    }
    const existing = state.research.find((r) => r.itemId === itemId) ?? null
    if (existing && existing.level === entry.level) continue

    const conflicts: UpgradeConflict[] = []
    if (existing && existing.targetLevel !== null) {
      conflicts.push({
        kind: 'research',
        recordId: existing.id,
        itemId,
        instanceNumber: null,
        currentLevel: existing.level,
        targetLevel: existing.targetLevel,
        source: existing.source,
        builderAssignment: null,
        exportEffect: `set level to ${entry.level} and end the recorded research`
      })
    }
    const limits = limitsAt(itemId)
    changes.push({
      id: `research:${itemId}`,
      kind: 'set-research',
      itemId,
      itemName: item.name,
      researchId: existing?.id ?? null,
      fromLevel: existing?.level ?? null,
      toLevel: entry.level,
      basis: 'observed',
      confidence: levelRule.confidence,
      requiresIndividualAcceptance: conflicts.length > 0,
      conflicts,
      blockedReason:
        coverageBlock ??
        (limits === null
          ? `No Town Hall rules for ${item.name}`
          : !limits.available
            ? `${item.name} unlocks at Town Hall ${limits.unlocksAtTownHall}`
            : entry.level > limits.maxLevel
              ? `${item.name} cannot be above level ${limits.maxLevel} at Town Hall ${effectiveTownHall}`
              : null),
      dependsOn: townHallChangeId
    })
  }

  return {
    exportTimestamp: parsed.exportTimestamp,
    coverage,
    townHall: townHallInfo,
    changes,
    observations,
    inferredCounts,
    unverifiedTimers,
    unmapped: [...unmappedMap.values()],
    outOfScopeSections: [...outOfScope.entries()].map(([section, entries]) => ({ section, entries })),
    unknownFields: parsed.unknownFields,
    unknownSections: parsed.unknownSections,
    untouched: UNTOUCHED_BY_IMPORT,
    warnings: [...parsed.warnings, ...warnings]
  }
}

// ---------------------------------------------------------------------------
// Instance matching (instances have no identity; match by level)
// ---------------------------------------------------------------------------

function planInstances(args: {
  item: CatalogueItem
  exported: ExportedInstance[]
  current: VillageItemInstance[]
  basis: ChangeBasis
  confidence: number
  limits: ReturnType<TownHallService['getItemAt']>
  effectiveTownHall: number
  coverageBlock: string | null
  dependsOn: string | null
}): ImportChange[] {
  const { item, exported, current, basis, confidence, limits, effectiveTownHall, coverageBlock, dependsOn } = args
  const base = { itemId: item.id, itemName: item.name, basis, confidence, dependsOn }

  let blockedReason: string | null = coverageBlock
  if (!blockedReason) {
    if (limits === null) blockedReason = `No Town Hall rules for ${item.name}`
    else if (!limits.available) blockedReason = `${item.name} unlocks at Town Hall ${limits.unlocksAtTownHall}`
    else if (exported.length > limits.maxQuantity)
      blockedReason = `The export lists ${exported.length} ${item.name}, above the limit of ${limits.maxQuantity} at Town Hall ${effectiveTownHall}`
    else if (exported.some((e) => e.level > limits.maxLevel))
      blockedReason = `${item.name} cannot be above level ${limits.maxLevel} at Town Hall ${effectiveTownHall}`
  }

  // 1. Keep current instances whose level appears in the export.
  //    Prefer keeping upgrading instances so they are not disturbed.
  const remainingExported = [...exported].sort((a, b) => a.level - b.level)
  const order = [...current].sort(
    (a, b) => Number(b.targetLevel !== null) - Number(a.targetLevel !== null) || a.instanceNumber - b.instanceNumber
  )
  const kept: Array<{ instance: VillageItemInstance; exported: ExportedInstance }> = []
  const unmatched: VillageItemInstance[] = []
  for (const instance of order) {
    const index = remainingExported.findIndex((e) => e.level === instance.level)
    if (index >= 0) {
      kept.push({ instance, exported: remainingExported[index]! })
      remainingExported.splice(index, 1)
    } else {
      unmatched.push(instance)
    }
  }

  // 2. Pair leftovers by ascending level (idle instances first) -> level changes.
  unmatched.sort(
    (a, b) => Number(a.targetLevel !== null) - Number(b.targetLevel !== null) || a.level - b.level
  )
  const levelPairs: Array<{ instance: VillageItemInstance; exported: ExportedInstance }> = []
  while (unmatched.length > 0 && remainingExported.length > 0) {
    levelPairs.push({ instance: unmatched.shift()!, exported: remainingExported.shift()! })
  }

  const changes: ImportChange[] = []
  const conflictFor = (instance: VillageItemInstance, effect: string): UpgradeConflict[] =>
    instance.targetLevel === null
      ? []
      : [
          {
            kind: 'item-upgrade',
            recordId: instance.id,
            itemId: item.id,
            instanceNumber: instance.instanceNumber,
            currentLevel: instance.level,
            targetLevel: instance.targetLevel,
            source: instance.source,
            builderAssignment: instance.builderAssignment,
            exportEffect: effect
          }
        ]

  if (levelPairs.length > 0) {
    const conflicts = levelPairs.flatMap(({ instance, exported: e }) =>
      conflictFor(instance, `set level to ${e.level} and end the recorded upgrade`)
    )
    changes.push({
      ...base,
      id: `instances:${item.id}:levels`,
      kind: 'change-levels',
      instances: levelPairs.map(({ instance, exported: e }) => ({
        instanceId: instance.id,
        instanceNumber: instance.instanceNumber,
        fromLevel: instance.level,
        toLevel: e.level
      })),
      requiresIndividualAcceptance: conflicts.length > 0,
      conflicts,
      blockedReason
    })
  }

  // 3. Extra exported instances -> additions at the next free instance numbers.
  if (remainingExported.length > 0) {
    const used = new Set(current.map((i) => i.instanceNumber))
    let next = 1
    const additions = remainingExported.map((e) => {
      while (used.has(next)) next += 1
      used.add(next)
      return { instanceNumber: next, level: e.level, upgradeTimer: e.upgradeTimer }
    })
    changes.push({
      ...base,
      id: `instances:${item.id}:add`,
      kind: 'add-instances',
      instances: additions.map(({ instanceNumber, level }) => ({ instanceNumber, level })),
      requiresIndividualAcceptance: false,
      conflicts: [],
      blockedReason
    })
    const addedUpgrades = additions.filter((a) => a.upgradeTimer !== null)
    if (addedUpgrades.length > 0) {
      changes.push({
        ...base,
        id: `instances:${item.id}:upgrades-new`,
        kind: 'imported-upgrades',
        instances: addedUpgrades.map((a) => ({
          instanceId: null,
          instanceNumber: a.instanceNumber,
          level: a.level,
          observedTimer: a.upgradeTimer!
        })),
        requiresIndividualAcceptance: false,
        conflicts: [],
        blockedReason,
        dependsOn: `instances:${item.id}:add`
      })
    }
  }

  // 4. Current instances the export does not show -> removals (always individual).
  if (unmatched.length > 0) {
    const conflicts = unmatched.flatMap((instance) =>
      conflictFor(instance, 'remove the instance and its recorded upgrade')
    )
    changes.push({
      ...base,
      id: `instances:${item.id}:remove`,
      kind: 'remove-instances',
      instances: unmatched.map((i) => ({ instanceId: i.id, instanceNumber: i.instanceNumber, level: i.level })),
      requiresIndividualAcceptance: true,
      conflicts,
      blockedReason: coverageBlock
    })
  }

  // 5. Upgrades the export shows on instances that already exist.
  const existingUpgrades = [...kept, ...levelPairs].filter(({ exported: e }) => e.upgradeTimer !== null)
  if (existingUpgrades.length > 0) {
    const conflicts = existingUpgrades.flatMap(({ instance, exported: e }) =>
      conflictFor(instance, `replace the recorded upgrade with the export's (timer ${e.upgradeTimer}s)`)
    )
    changes.push({
      ...base,
      id: `instances:${item.id}:upgrades`,
      kind: 'imported-upgrades',
      instances: existingUpgrades.map(({ instance, exported: e }) => ({
        instanceId: instance.id,
        instanceNumber: instance.instanceNumber,
        level: e.level,
        observedTimer: e.upgradeTimer!
      })),
      requiresIndividualAcceptance: conflicts.length > 0,
      conflicts,
      blockedReason,
      dependsOn: levelPairs.length > 0 ? `instances:${item.id}:levels` : base.dependsOn
    })
  }

  return changes
}
