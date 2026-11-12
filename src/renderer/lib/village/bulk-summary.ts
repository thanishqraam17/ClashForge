import type { VillageItemDto } from '../../../shared/ipc/contracts'

/**
 * What a bulk edit will do, computed with the same rules as the edit service
 * (setItemLevels / setItemCount) so the confirmation lists exactly the
 * instances the service will change. An upgrade is shown as ended only when
 * the player ticked it; an unticked upgrading instance blocks confirmation.
 * The service re-checks everything when the edit is sent.
 */

export type LevelChange = {
  id: number
  instanceNumber: number
  fromLevel: number
  toLevel: number
  /** Set when this edit ends the instance's upgrade (explicitly ticked). */
  endsUpgradeTo: number | null
}

export type BulkLevelSummary = {
  changes: LevelChange[]
  /** Selected instances already at the level, with no upgrade: not touched. */
  unchanged: number[]
  /** Upgrading instances that are selected but not ticked. */
  needsUpgradeChoice: number[]
  /** Ticked instances whose target equals the new level: a bulk edit never finishes an upgrade. */
  wouldFinish: number[]
  canConfirm: boolean
}

export function summariseBulkLevels(
  instances: readonly VillageItemDto[],
  options: { level: number; selection: readonly number[] | 'all'; endUpgrades: ReadonlySet<number> }
): BulkLevelSummary {
  const ids = options.selection === 'all' ? null : options.selection
  const selected = (ids === null ? [...instances] : instances.filter((i) => ids.includes(i.id)))
    .sort((a, b) => a.instanceNumber - b.instanceNumber)
  const summary: BulkLevelSummary = { changes: [], unchanged: [], needsUpgradeChoice: [], wouldFinish: [], canConfirm: false }
  for (const instance of selected) {
    const base = { id: instance.id, instanceNumber: instance.instanceNumber, fromLevel: instance.level, toLevel: options.level }
    if (instance.targetLevel === null) {
      if (instance.level === options.level) summary.unchanged.push(instance.instanceNumber)
      else summary.changes.push({ ...base, endsUpgradeTo: null })
    } else if (!options.endUpgrades.has(instance.id)) {
      summary.needsUpgradeChoice.push(instance.instanceNumber)
    } else if (instance.targetLevel === options.level) {
      summary.wouldFinish.push(instance.instanceNumber)
    } else {
      summary.changes.push({ ...base, endsUpgradeTo: instance.targetLevel })
    }
  }
  summary.canConfirm =
    summary.changes.length > 0 && summary.needsUpgradeChoice.length === 0 && summary.wouldFinish.length === 0
  return summary
}

export type Removal = {
  id: number
  instanceNumber: number
  level: number
  /** Set when the instance is upgrading (only possible when ticked). */
  endsUpgradeTo: number | null
}

export type BulkCountSummary =
  | { kind: 'none'; canConfirm: false }
  | { kind: 'add'; additions: number[]; level: number | null; canConfirm: boolean; problem: string | null }
  | { kind: 'remove'; removals: Removal[]; needsUpgradeChoice: number[]; canConfirm: boolean; problem: string | null }

/** The service's default choice: idle instances, lowest level first, then highest instance number. */
export function defaultRemovals(instances: readonly VillageItemDto[], toRemove: number): VillageItemDto[] | null {
  const idle = instances
    .filter((i) => i.targetLevel === null)
    .sort((a, b) => a.level - b.level || b.instanceNumber - a.instanceNumber)
  return idle.length < toRemove ? null : idle.slice(0, toRemove)
}

export function summariseBulkCount(
  instances: readonly VillageItemDto[],
  options: {
    count: number
    levelForAdditions?: number
    /** Instance ids to remove; omit to use the default choice. */
    removeInstances?: readonly number[]
    endUpgrades: ReadonlySet<number>
  }
): BulkCountSummary {
  const current = instances.length
  if (options.count === current) return { kind: 'none', canConfirm: false }

  if (options.count > current) {
    const used = new Set(instances.map((i) => i.instanceNumber))
    const additions: number[] = []
    for (let n = 1; additions.length < options.count - current; n += 1) if (!used.has(n)) additions.push(n)
    const problem =
      options.removeInstances !== undefined
        ? 'Instances can only be chosen for removal when the count decreases'
        : options.levelForAdditions === undefined
          ? 'Choose a level for the new instances'
          : null
    return { kind: 'add', additions, level: options.levelForAdditions ?? null, canConfirm: problem === null, problem }
  }

  const toRemove = current - options.count
  const plural = (n: number) => `${n} instance${n === 1 ? '' : 's'}`
  let chosen: VillageItemDto[]
  if (options.removeInstances === undefined) {
    const defaults = defaultRemovals(instances, toRemove)
    if (defaults === null) {
      return {
        kind: 'remove',
        removals: [],
        needsUpgradeChoice: [],
        canConfirm: false,
        problem: `Not enough idle instances to remove ${plural(toRemove)}; choose the instances explicitly`
      }
    }
    chosen = defaults
  } else {
    chosen = instances.filter((i) => options.removeInstances!.includes(i.id))
    if (chosen.length !== toRemove) {
      return {
        kind: 'remove',
        removals: chosen.map(toRemoval(options.endUpgrades)),
        needsUpgradeChoice: [],
        canConfirm: false,
        problem: `Choose exactly ${plural(toRemove)} to remove`
      }
    }
  }
  const needsUpgradeChoice = chosen
    .filter((i) => i.targetLevel !== null && !options.endUpgrades.has(i.id))
    .map((i) => i.instanceNumber)
    .sort((a, b) => a - b)
  return {
    kind: 'remove',
    removals: chosen.map(toRemoval(options.endUpgrades)),
    needsUpgradeChoice,
    canConfirm: needsUpgradeChoice.length === 0,
    problem: needsUpgradeChoice.length > 0 ? 'Tick "End the upgrade" for each upgrading instance to remove it' : null
  }
}

const toRemoval =
  (endUpgrades: ReadonlySet<number>) =>
  (i: VillageItemDto): Removal => ({
    id: i.id,
    instanceNumber: i.instanceNumber,
    level: i.level,
    endsUpgradeTo: i.targetLevel !== null && endUpgrades.has(i.id) ? i.targetLevel : null
  })
