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
import { matchInstances, type InstanceOperations } from './instance-matching'

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
      /** Upgrades the export shows as finished. Always needs a decision. */
      kind: 'complete-upgrades'
      instances: Array<{ instanceId: number; instanceNumber: number; fromLevel: number; toLevel: number }>
    })
  | (ChangeBase & {
      /**
       * The export fits the recorded instances in more than one way. Applying
       * it needs an explicit choice of interpretation; nothing is chosen by
       * default. Empty `interpretations` (with a blockedReason) means the item
       * must be corrected manually.
       */
      kind: 'ambiguous-instances'
      interpretations: Array<{ id: string; summary: string[]; operations: InstanceOperations }>
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

/**
 * Everything in the given items and research that would break the limits of
 * `townHallLevel`: locked items, too many instances, or levels (current or
 * upgrade target) above the maximum. Used to keep imports from leaving the
 * village in a state its Town Hall does not allow.
 */
export function findTownHallViolations(
  items: Pick<VillageItemInstance, 'itemId' | 'level' | 'targetLevel'>[],
  research: Pick<ResearchState, 'itemId' | 'level' | 'targetLevel'>[],
  townHall: TownHallService,
  townHallLevel: number,
  nameOf: (itemId: string) => string
): string[] {
  const limitsAt = (itemId: string) => {
    try {
      return townHall.getItemAt(itemId, townHallLevel)
    } catch {
      return null
    }
  }
  const violations: string[] = []
  const byItem = new Map<string, Array<Pick<VillageItemInstance, 'level' | 'targetLevel'>>>()
  for (const item of items) byItem.set(item.itemId, [...(byItem.get(item.itemId) ?? []), item])

  const check = (itemId: string, count: number, levels: number[]) => {
    const name = nameOf(itemId)
    const limits = limitsAt(itemId)
    if (limits === null) {
      violations.push(`${name}: no Town Hall ${townHallLevel} rules`)
    } else if (!limits.available) {
      violations.push(`${name}: unlocks at Town Hall ${limits.unlocksAtTownHall}`)
    } else {
      if (count > limits.maxQuantity) {
        violations.push(`${name}: ${count} recorded, limit ${limits.maxQuantity}`)
      }
      const highest = Math.max(...levels)
      if (highest > limits.maxLevel) {
        violations.push(`${name}: level ${highest} recorded, limit ${limits.maxLevel}`)
      }
    }
  }
  for (const [itemId, instances] of [...byItem.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    check(
      itemId,
      instances.length,
      instances.flatMap((i) => (i.targetLevel === null ? [i.level] : [i.level, i.targetLevel]))
    )
  }
  for (const entry of [...research].sort((a, b) => a.itemId.localeCompare(b.itemId))) {
    check(entry.itemId, 1, entry.targetLevel === null ? [entry.level] : [entry.level, entry.targetLevel])
  }
  return violations
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
  /** Timers are only ever interpreted through a rule marked `verified`. */
  const verifiedTimerRule = (section: string) => {
    const r = findRule(semantics, section, 'upgrade-remaining-seconds')
    return r && r.status === 'verified' ? r : null
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
    const timerRule = entry.timer !== null ? verifiedTimerRule(entry.section) : null
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

  /**
   * A Town Hall change is only valid if everything the export does not cover
   * still fits the new limits; covered items are validated by their own changes.
   */
  const townHallBlock = (level: number): string | null => {
    const nameOf = (id: string) => catalogue.items.find((i) => i.id === id)?.name ?? id
    const violations = findTownHallViolations(
      state.items.filter((i) => !instanceEntries.has(i.itemId)),
      state.research.filter((r) => !researchEntries.has(r.itemId)),
      townHall,
      level,
      nameOf
    )
    return violations.length === 0
      ? null
      : `Town Hall ${level} would leave the village above its limits: ${violations.join('; ')}`
  }

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
            : townHallBlock(exportedLevel),
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
      const timerRule = entry.timer !== null ? verifiedTimerRule(entry.section) : null
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
// Instance matching (instances have no identity; see instance-matching.ts)
// ---------------------------------------------------------------------------

/** Plain-language lines describing one interpretation. */
export function describeOperations(itemName: string, ops: InstanceOperations): string[] {
  return [
    ...ops.completions.map((c) => `${itemName} #${c.instanceNumber}: upgrade to level ${c.toLevel} finished`),
    ...ops.stillUpgrading.map(
      (u) => `${itemName} #${u.instanceNumber}: still upgrading ${u.level} → ${u.targetLevel}`
    ),
    ...ops.levelChanges.map(
      (c) =>
        `${itemName} #${c.instanceNumber}: level ${c.fromLevel} → ${c.toLevel}` +
        (c.endsUpgrade ? ' (its recorded upgrade is dropped)' : '')
    ),
    ...ops.removals.map(
      (r) =>
        `${itemName} #${r.instanceNumber} (level ${r.level}): removed` +
        (r.endsUpgrade ? ' with its recorded upgrade' : '')
    ),
    ...ops.additions.map((a) => `${itemName} #${a.instanceNumber}: added at level ${a.level}`)
  ]
}

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

  const result = matchInstances(
    exported.map((e) => e.level),
    current
  )
  const ambiguousId = `instances:${item.id}:ambiguous`
  if (result.kind === 'too-many') {
    return [
      {
        ...base,
        id: ambiguousId,
        kind: 'ambiguous-instances',
        interpretations: [],
        requiresIndividualAcceptance: true,
        conflicts: [],
        blockedReason: blockedReason ?? result.reason
      }
    ]
  }

  const outcomes = result.outcomes
  if (outcomes.length > 1) {
    const hasTimers = exported.some((e) => e.upgradeTimer !== null)
    return [
      {
        ...base,
        id: ambiguousId,
        kind: 'ambiguous-instances',
        interpretations: outcomes.map((operations, index) => ({
          id: `i${index + 1}`,
          summary: describeOperations(item.name, operations),
          operations
        })),
        requiresIndividualAcceptance: true,
        conflicts: [],
        blockedReason:
          blockedReason ??
          (hasTimers
            ? `${item.name} matches the export in several ways and has imported upgrade timers; correct this item manually`
            : null)
      }
    ]
  }

  const ops = outcomes[0]!
  const byId = new Map(current.map((i) => [i.id, i]))
  const conflictFor = (instanceId: number, effect: string): UpgradeConflict[] => {
    const instance = byId.get(instanceId)
    return instance && instance.targetLevel !== null
      ? [
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
      : []
  }

  const changes: ImportChange[] = []
  const levelsId = `instances:${item.id}:levels`
  const completeId = `instances:${item.id}:complete`
  const addId = `instances:${item.id}:add`

  if (ops.levelChanges.length > 0) {
    const conflicts = ops.levelChanges.flatMap((c) =>
      conflictFor(c.instanceId, `set level to ${c.toLevel} and end the recorded upgrade`)
    )
    changes.push({
      ...base,
      id: levelsId,
      kind: 'change-levels',
      instances: ops.levelChanges.map(({ instanceId, instanceNumber, fromLevel, toLevel }) => ({
        instanceId,
        instanceNumber,
        fromLevel,
        toLevel
      })),
      requiresIndividualAcceptance: conflicts.length > 0,
      conflicts,
      blockedReason
    })
  }

  if (ops.completions.length > 0) {
    changes.push({
      ...base,
      id: completeId,
      kind: 'complete-upgrades',
      instances: ops.completions.map(({ instanceId, instanceNumber, fromLevel, toLevel }) => ({
        instanceId,
        instanceNumber,
        fromLevel,
        toLevel
      })),
      requiresIndividualAcceptance: true,
      conflicts: ops.completions.flatMap((c) =>
        conflictFor(c.instanceId, `mark the upgrade to level ${c.toLevel} as finished`)
      ),
      blockedReason
    })
  }

  if (ops.additions.length > 0) {
    changes.push({
      ...base,
      id: addId,
      kind: 'add-instances',
      instances: ops.additions.map(({ instanceNumber, level }) => ({ instanceNumber, level })),
      requiresIndividualAcceptance: false,
      conflicts: [],
      blockedReason
    })
  }

  if (ops.removals.length > 0) {
    changes.push({
      ...base,
      id: `instances:${item.id}:remove`,
      kind: 'remove-instances',
      instances: ops.removals.map(({ instanceId, instanceNumber, level }) => ({ instanceId, instanceNumber, level })),
      requiresIndividualAcceptance: true,
      conflicts: ops.removals.flatMap((r) => conflictFor(r.instanceId, 'remove the instance and its recorded upgrade')),
      blockedReason: coverageBlock
    })
  }

  // Imported upgrade timers (verified rule only): give each exported timer at a
  // level to an instance ending at that level. Idle kept or re-levelled
  // instances first, then additions, then instances already upgrading
  // (which needs a decision). Completed instances are never given a timer.
  const timersByLevel = new Map<number, number[]>()
  for (const e of exported) {
    if (e.upgradeTimer !== null) timersByLevel.set(e.level, [...(timersByLevel.get(e.level) ?? []), e.upgradeTimer])
  }
  if (timersByLevel.size > 0) {
    const completedIds = new Set(ops.completions.map((c) => c.instanceId))
    const changedIds = new Set(ops.levelChanges.map((c) => c.instanceId))
    const existing: Array<{ instanceId: number; instanceNumber: number; level: number; observedTimer: number; upgrading: boolean }> = []
    const added: Array<{ instanceId: null; instanceNumber: number; level: number; observedTimer: number }> = []
    for (const [level, timers] of timersByLevel) {
      const candidates = ops.finalLevels
        .filter((f) => f.level === level && !(f.instanceId !== null && completedIds.has(f.instanceId)))
        .sort(
          (a, b) =>
            Number(a.upgrading) - Number(b.upgrading) ||
            Number(a.instanceId === null) - Number(b.instanceId === null) ||
            a.instanceNumber - b.instanceNumber
        )
      if (candidates.length < timers.length) {
        return [
          {
            ...base,
            id: ambiguousId,
            kind: 'ambiguous-instances',
            interpretations: [],
            requiresIndividualAcceptance: true,
            conflicts: [],
            blockedReason: `${item.name}: imported upgrade timers could not be matched to instances; correct this item manually`
          }
        ]
      }
      timers.forEach((timer, i) => {
        const c = candidates[i]!
        if (c.instanceId === null) added.push({ instanceId: null, instanceNumber: c.instanceNumber, level, observedTimer: timer })
        else existing.push({ instanceId: c.instanceId, instanceNumber: c.instanceNumber, level, observedTimer: timer, upgrading: c.upgrading })
      })
    }
    if (added.length > 0) {
      changes.push({
        ...base,
        id: `instances:${item.id}:upgrades-new`,
        kind: 'imported-upgrades',
        instances: added.sort((a, b) => a.instanceNumber - b.instanceNumber),
        requiresIndividualAcceptance: false,
        conflicts: [],
        blockedReason,
        dependsOn: addId
      })
    }
    if (existing.length > 0) {
      const conflicts = existing.flatMap((e) =>
        conflictFor(e.instanceId, `replace the recorded upgrade with the export's (timer ${e.observedTimer}s)`)
      )
      changes.push({
        ...base,
        id: `instances:${item.id}:upgrades`,
        kind: 'imported-upgrades',
        instances: existing
          .sort((a, b) => a.instanceNumber - b.instanceNumber)
          .map(({ instanceId, instanceNumber, level, observedTimer }) => ({ instanceId, instanceNumber, level, observedTimer })),
        requiresIndividualAcceptance: conflicts.length > 0,
        conflicts,
        blockedReason,
        dependsOn: existing.some((e) => changedIds.has(e.instanceId)) ? levelsId : base.dependsOn
      })
    }
  }

  return changes
}
