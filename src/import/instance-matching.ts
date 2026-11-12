import type { VillageItemInstance } from '../domain/village-state'

/**
 * Matches exported instances of one item against the recorded instances.
 *
 * Instances have no identity in the export, so several matchings can fit the
 * same data. This module enumerates the distinct, plausible ones:
 *
 * - The exported counts are a multiset (grouped `cnt` and inferred counts
 *   included). Every interpretation uses exactly that multiset.
 * - Each upgrading instance (L -> T) is either still upgrading (uses one
 *   exported L), completed (uses one exported T), or released (its upgrade
 *   ended; it is re-levelled or removed like an idle instance). The smallest
 *   number of releases that fits the counts is always considered; larger
 *   numbers only where every released upgrade is removed.
 * - Idle instances keep their level where the export allows, and the rest are
 *   paired with the remaining exported levels in ascending order. Where idle
 *   instances of one level belong to materially different provenance groups
 *   and get different fates, every distinct distribution is an interpretation.
 *
 * Generation is lazy and stops as soon as more than `maxInterpretations`
 * distinct outcomes exist, so it never builds the full combination space.
 */

export const MAX_INTERPRETATIONS = 8
/** Upgrading instances of one item beyond which matching is not attempted. */
export const MAX_UPGRADING_FOR_MATCHING = 8

export type InstanceOperations = {
  /** Upgrades the export shows as finished: level becomes the target, upgrade cleared. */
  completions: Array<{ instanceId: number; instanceNumber: number; fromLevel: number; toLevel: number }>
  /** `endsUpgrade`: the instance was upgrading and its recorded upgrade is dropped. */
  levelChanges: Array<{ instanceId: number; instanceNumber: number; fromLevel: number; toLevel: number; endsUpgrade: boolean }>
  removals: Array<{ instanceId: number; instanceNumber: number; level: number; endsUpgrade: boolean }>
  additions: Array<{ instanceNumber: number; level: number }>
  /** Upgrading instances the interpretation leaves as they are. */
  stillUpgrading: Array<{ instanceId: number; instanceNumber: number; level: number; targetLevel: number }>
  /** Final level of every instance that is kept, changed or added, by instance number. */
  finalLevels: Array<{ instanceId: number | null; instanceNumber: number; level: number; upgrading: boolean }>
}

export type MatchingResult =
  | { kind: 'outcomes'; outcomes: InstanceOperations[] }
  | { kind: 'too-many'; reason: string }

/** Decision A: source, confirmation and a 0.2-wide confidence band. */
export function provenanceClass(instance: Pick<VillageItemInstance, 'source' | 'confirmedAt' | 'confidence'>): string {
  return `${instance.source}|${instance.confirmedAt !== null ? 'confirmed' : 'unconfirmed'}|${Math.min(4, Math.floor(instance.confidence * 5))}`
}

type Fate = { kind: 'keep' } | { kind: 'change'; to: number } | { kind: 'remove' }
type UpgradeFate = 'keep' | 'complete' | 'release'

const fateKey = (f: Fate): string => (f.kind === 'change' ? `change:${f.to}` : f.kind)
/** Canonical order for handing fates to instances: keep, then changes ascending, then removals. */
const fateRank = (f: Fate): number => (f.kind === 'keep' ? -1 : f.kind === 'change' ? f.to : Number.MAX_SAFE_INTEGER)

export function matchInstances(
  exportedLevels: number[],
  current: VillageItemInstance[],
  maxInterpretations = MAX_INTERPRETATIONS
): MatchingResult {
  const upgrading = current.filter((i) => i.targetLevel !== null).sort((a, b) => a.instanceNumber - b.instanceNumber)
  const idle = current.filter((i) => i.targetLevel === null).sort((a, b) => a.instanceNumber - b.instanceNumber)
  if (upgrading.length > MAX_UPGRADING_FOR_MATCHING) {
    return { kind: 'too-many', reason: `More than ${MAX_UPGRADING_FOR_MATCHING} upgrades in progress; correct this item manually` }
  }

  const exported = new Map<number, number>()
  for (const level of exportedLevels) exported.set(level, (exported.get(level) ?? 0) + 1)

  const outcomes: InstanceOperations[] = []
  const seen = new Set<string>()
  let overflow = false
  const usedNumbers = new Set(current.map((i) => i.instanceNumber))

  const record = (ops: InstanceOperations): boolean => {
    const key = JSON.stringify(ops)
    if (seen.has(key)) return true
    if (outcomes.length >= maxInterpretations) {
      overflow = true
      return false
    }
    seen.add(key)
    outcomes.push(ops)
    return true
  }

  // Upgrade fate combinations, fewest releases first. Up to the smallest
  // release count that fits, a released upgrade may take any fate (fallback).
  // Beyond it, a combination is kept only if every released upgrade is
  // removed: when the export shows fewer instances than recorded, "the
  // upgrading one is gone" fits the counts as well as "an idle one is gone".
  const combos = upgradeCombos(upgrading.length)
  let minimalReleases = -1
  for (let releases = 0; releases <= upgrading.length && !overflow; releases += 1) {
    const releasedMustBeRemoved = minimalReleases >= 0
    for (const combo of combos) {
      if (combo.filter((f) => f === 'release').length !== releases) continue
      const remaining = new Map(exported)
      let feasible = true
      upgrading.forEach((u, i) => {
        const use = combo[i] === 'keep' ? u.level : combo[i] === 'complete' ? u.targetLevel! : null
        if (use === null) return
        const left = (remaining.get(use) ?? 0) - 1
        if (left < 0) feasible = false
        remaining.set(use, left)
      })
      if (!feasible) continue
      if (
        !expandIdle(upgrading, combo, idle, remaining, usedNumbers, record, () => (overflow = true), releasedMustBeRemoved)
      ) {
        break
      }
    }
    if (minimalReleases < 0 && outcomes.length > 0) minimalReleases = releases
  }

  if (overflow) {
    return {
      kind: 'too-many',
      reason: `More than ${maxInterpretations} possible interpretations; correct this item manually`
    }
  }
  return { kind: 'outcomes', outcomes }
}

/** All fate combinations for `n` upgrading instances, in a fixed order. */
function upgradeCombos(n: number): UpgradeFate[][] {
  const fates: UpgradeFate[] = ['keep', 'complete', 'release']
  let combos: UpgradeFate[][] = [[]]
  for (let i = 0; i < n; i += 1) {
    combos = combos.flatMap((c) => fates.map((f) => [...c, f]))
  }
  return combos
}

/**
 * For one upgrade-fate combination, derives idle fates from the remaining
 * counts and enumerates the provenance distributions. Returns false once the
 * interpretation limit is exceeded.
 */
function expandIdle(
  upgrading: VillageItemInstance[],
  combo: UpgradeFate[],
  idle: VillageItemInstance[],
  remaining: Map<number, number>,
  usedNumbers: Set<number>,
  record: (ops: InstanceOperations) => boolean,
  markOverflow: () => void,
  releasedMustBeRemoved: boolean
): boolean {
  const left = new Map(remaining)
  const idleByLevel = new Map<number, VillageItemInstance[]>()
  for (const i of idle) idleByLevel.set(i.level, [...(idleByLevel.get(i.level) ?? []), i])

  // Keep exact matches; collect the freed idle slots (one per instance not kept).
  const keepsByLevel = new Map<number, number>()
  const idleSlots: number[] = []
  for (const [level, instances] of [...idleByLevel.entries()].sort(([a], [b]) => a - b)) {
    const keep = Math.min(instances.length, left.get(level) ?? 0)
    left.set(level, (left.get(level) ?? 0) - keep)
    keepsByLevel.set(level, keep)
    for (let i = keep; i < instances.length; i += 1) idleSlots.push(level)
  }
  const released = upgrading
    .filter((_, i) => combo[i] === 'release')
    .sort((a, b) => a.level - b.level || a.instanceNumber - b.instanceNumber)

  const remainingLevels: number[] = []
  for (const [level, count] of [...left.entries()].sort(([a], [b]) => a - b)) {
    for (let i = 0; i < count; i += 1) remainingLevels.push(level)
  }

  // How many freed instances have no exported level left: they are removed.
  // Released upgrades are removed first (latest in order first), then idle slots.
  const removals = Math.max(0, idleSlots.length + released.length - remainingLevels.length)
  const releasedRemoved = Math.min(removals, released.length)
  const idleRemovals = removals - releasedRemoved
  const releasedKept = released.slice(0, released.length - releasedRemoved)
  if (releasedMustBeRemoved && releasedKept.length > 0) {
    return true // not a plausible alternative; keep searching
  }

  // Which idle slots are removed. Levels with the same provenance signature
  // are interchangeable: within a signature the lowest levels go first. Each
  // distinct split of the removals across signatures is an interpretation.
  const signatureOf = (level: number) =>
    [...new Set(idleByLevel.get(level)!.map(provenanceClass))].sort().join('+')
  const buckets: Array<{ signature: string; levels: number[] }> = []
  for (const level of idleSlots) {
    const signature = signatureOf(level)
    const bucket = buckets.find((b) => b.signature === signature)
    if (bucket) bucket.levels.push(level)
    else buckets.push({ signature, levels: [level] })
  }
  const removalChoices = splitRemovals(
    buckets.map((b) => b.levels.length),
    idleRemovals,
    MAX_INTERPRETATIONS + 1
  )
  if (removalChoices.length > MAX_INTERPRETATIONS) {
    markOverflow()
    return false
  }

  for (const split of removalChoices) {
    const removed: number[] = []
    buckets.forEach((bucket, i) => removed.push(...bucket.levels.slice(0, split[i]!)))
    const kept = [...idleSlots]
    for (const level of removed) kept.splice(kept.indexOf(level), 1)

    // Remaining freed instances (idle first, then released) take the
    // remaining exported levels in ascending order; extras become additions.
    const fatesByLevel = new Map<number, Fate[]>()
    for (const [level, keep] of keepsByLevel) {
      fatesByLevel.set(level, Array.from({ length: keep }, () => ({ kind: 'keep' }) as Fate))
    }
    for (const level of removed) fatesByLevel.get(level)!.push({ kind: 'remove' })
    const releasedFates = new Map<number, Fate>()
    const pairing: Array<{ level: number; released: VillageItemInstance | null }> = [
      ...kept.map((level) => ({ level, released: null })),
      ...releasedKept.map((u) => ({ level: u.level, released: u }))
    ]
    pairing.forEach((slot, index) => {
      const fate: Fate = { kind: 'change', to: remainingLevels[index]! }
      if (slot.released) releasedFates.set(slot.released.id, fate)
      else fatesByLevel.get(slot.level)!.push(fate)
    })
    for (const u of released.slice(released.length - releasedRemoved)) releasedFates.set(u.id, { kind: 'remove' })
    const additionLevels = remainingLevels.slice(pairing.length)

    // Distribute each level's fates over its instances, per provenance group.
    const levels = [...fatesByLevel.keys()].sort((a, b) => a - b)
    const perLevelOptions: Array<Array<Map<number, Fate>>> = []
    for (const level of levels) {
      const options = distributions(idleByLevel.get(level)!, fatesByLevel.get(level)!, MAX_INTERPRETATIONS + 1)
      // More options at one level than the limit already means too many interpretations.
      if (options.length > MAX_INTERPRETATIONS) {
        markOverflow()
        return false
      }
      perLevelOptions.push(options)
    }

    const build = (choice: Array<Map<number, Fate>>): InstanceOperations => {
      const ops: InstanceOperations = {
        completions: [],
        levelChanges: [],
        removals: [],
        additions: [],
        stillUpgrading: [],
        finalLevels: []
      }
      const apply = (instance: VillageItemInstance, fate: Fate, endsUpgrade: boolean) => {
        if (fate.kind === 'keep') {
          ops.finalLevels.push({ instanceId: instance.id, instanceNumber: instance.instanceNumber, level: instance.level, upgrading: false })
        } else if (fate.kind === 'change') {
          ops.levelChanges.push({ instanceId: instance.id, instanceNumber: instance.instanceNumber, fromLevel: instance.level, toLevel: fate.to, endsUpgrade })
          ops.finalLevels.push({ instanceId: instance.id, instanceNumber: instance.instanceNumber, level: fate.to, upgrading: false })
        } else {
          ops.removals.push({ instanceId: instance.id, instanceNumber: instance.instanceNumber, level: instance.level, endsUpgrade })
        }
      }
      upgrading.forEach((u, i) => {
        if (combo[i] === 'keep') {
          ops.stillUpgrading.push({ instanceId: u.id, instanceNumber: u.instanceNumber, level: u.level, targetLevel: u.targetLevel! })
          ops.finalLevels.push({ instanceId: u.id, instanceNumber: u.instanceNumber, level: u.level, upgrading: true })
        } else if (combo[i] === 'complete') {
          ops.completions.push({ instanceId: u.id, instanceNumber: u.instanceNumber, fromLevel: u.level, toLevel: u.targetLevel! })
          ops.finalLevels.push({ instanceId: u.id, instanceNumber: u.instanceNumber, level: u.targetLevel!, upgrading: false })
        } else {
          apply(u, releasedFates.get(u.id)!, true)
        }
      })
      for (const assignment of choice) {
        for (const instance of idle) {
          const fate = assignment.get(instance.id)
          if (fate) apply(instance, fate, false)
        }
      }
      let next = 1
      for (const level of additionLevels) {
        while (usedNumbers.has(next) || ops.additions.some((a) => a.instanceNumber === next)) next += 1
        ops.additions.push({ instanceNumber: next, level })
        ops.finalLevels.push({ instanceId: null, instanceNumber: next, level, upgrading: false })
      }
      for (const list of [ops.completions, ops.levelChanges, ops.removals, ops.stillUpgrading, ops.finalLevels]) {
        ;(list as Array<{ instanceNumber: number }>).sort((a, b) => a.instanceNumber - b.instanceNumber)
      }
      return ops
    }

    // Cartesian product over levels, generated lazily.
    const walk = (index: number, chosen: Array<Map<number, Fate>>): boolean => {
      if (index === perLevelOptions.length) return record(build(chosen))
      for (const option of perLevelOptions[index]!) {
        if (!walk(index + 1, [...chosen, option])) return false
      }
      return true
    }
    if (!walk(0, [])) return false
  }
  return true
}

/**
 * Ways to take `total` removals from buckets of the given sizes, at most
 * `limit` of them, in a fixed order. One bucket gives exactly one way.
 */
function splitRemovals(sizes: number[], total: number, limit: number): number[][] {
  const out: number[][] = []
  const recurse = (i: number, need: number, acc: number[]) => {
    if (out.length >= limit) return
    if (i === sizes.length) {
      if (need === 0) out.push(acc)
      return
    }
    const capacityAfter = sizes.slice(i + 1).reduce((a, b) => a + b, 0)
    for (let take = Math.min(need, sizes[i]!); take >= Math.max(0, need - capacityAfter); take -= 1) {
      recurse(i + 1, need - take, [...acc, take])
    }
  }
  recurse(0, total, [])
  return out
}

/**
 * Distinct ways to hand a level's fates to its instances. Instances in the same
 * provenance group are interchangeable (canonical order: lowest instance number
 * gets keep, then changes ascending, then removals), so only distributions
 * across groups differ. A single group, or identical fates, gives one option.
 */
function distributions(
  instances: VillageItemInstance[],
  fates: Fate[],
  limit: number
): Array<Map<number, Fate>> {
  const groups: VillageItemInstance[][] = []
  const indexOf = new Map<string, number>()
  for (const instance of instances) {
    const key = provenanceClass(instance)
    if (!indexOf.has(key)) {
      indexOf.set(key, groups.length)
      groups.push([])
    }
    groups[indexOf.get(key)!]!.push(instance)
  }
  const sortedFates = [...fates].sort((a, b) => fateRank(a) - fateRank(b))
  const assignCanonical = (group: VillageItemInstance[], groupFates: Fate[], into: Map<number, Fate>) => {
    const ordered = [...groupFates].sort((a, b) => fateRank(a) - fateRank(b))
    group.forEach((instance, i) => into.set(instance.id, ordered[i]!))
  }

  if (groups.length === 1 || new Set(sortedFates.map(fateKey)).size === 1) {
    const map = new Map<number, Fate>()
    assignCanonical(instances, sortedFates, map)
    return [map]
  }

  // Choose a sub-multiset of fates for each group in turn; dedupe by multiset.
  const results: Array<Map<number, Fate>> = []
  // Returns false once `limit` results exist, which stops the whole search.
  const recurse = (groupIndex: number, pool: Fate[], acc: Array<Fate[]>): boolean => {
    if (groupIndex === groups.length) {
      const map = new Map<number, Fate>()
      groups.forEach((group, i) => assignCanonical(group, acc[i]!, map))
      results.push(map)
      return results.length < limit
    }
    const size = groups[groupIndex]!.length
    for (const pick of subMultisets(pool, size, limit)) {
      const rest = [...pool]
      for (const fate of pick) rest.splice(rest.findIndex((f) => fateKey(f) === fateKey(fate)), 1)
      if (!recurse(groupIndex + 1, rest, [...acc, pick])) return false
    }
    return true
  }
  recurse(0, sortedFates, [])
  return results
}

/** Distinct sub-multisets of `pool` with `size` elements, at most `limit` of them. */
function subMultisets(pool: Fate[], size: number, limit: number): Fate[][] {
  const kinds: Array<{ fate: Fate; count: number }> = []
  for (const fate of pool) {
    const last = kinds[kinds.length - 1]
    if (last && fateKey(last.fate) === fateKey(fate)) last.count += 1
    else kinds.push({ fate, count: 1 })
  }
  const out: Fate[][] = []
  const recurse = (i: number, need: number, acc: Fate[]) => {
    if (out.length >= limit) return
    if (need === 0) {
      out.push(acc)
      return
    }
    if (i === kinds.length) return
    for (let take = Math.min(need, kinds[i]!.count); take >= 0; take -= 1) {
      recurse(i + 1, need - take, [...acc, ...Array.from({ length: take }, () => kinds[i]!.fate)])
    }
  }
  recurse(0, size, [])
  return out
}
