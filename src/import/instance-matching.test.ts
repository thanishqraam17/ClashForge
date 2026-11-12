import { describe, expect, it } from 'vitest'
import type { StateSource, VillageItemInstance } from '../domain/village-state'
import { matchInstances, MAX_INTERPRETATIONS, provenanceClass, type InstanceOperations } from './instance-matching'

let nextId = 1
function inst(
  instanceNumber: number,
  level: number,
  opts: { target?: number; source?: StateSource; confidence?: number; confirmed?: boolean } = {}
): VillageItemInstance {
  const upgrading = opts.target !== undefined
  return {
    id: nextId++,
    villageId: 1,
    itemId: 'test-cannon',
    instanceNumber,
    level,
    targetLevel: upgrading ? opts.target! : null,
    upgradeStartedAt: null,
    upgradeEndsAt: null,
    builderId: upgrading ? 1 : null,
    builderAssignment: upgrading ? 'confirmed' : null,
    upgradeObservedTimer: null,
    upgradeObservedAt: null,
    source: opts.source ?? 'manual',
    confidence: opts.confidence ?? 1,
    confirmedAt: opts.confirmed === false ? null : new Date('2026-11-12T00:00:00.000Z'),
    createdAt: new Date(),
    updatedAt: new Date()
  }
}

function outcomes(exported: number[], current: VillageItemInstance[]): InstanceOperations[] {
  const result = matchInstances(exported, current)
  if (result.kind !== 'outcomes') throw new Error(result.reason)
  return result.outcomes
}

/** Short, readable form of an outcome. */
function describe_(ops: InstanceOperations): string[] {
  return [
    ...ops.stillUpgrading.map((u) => `#${u.instanceNumber} still ${u.level}->${u.targetLevel}`),
    ...ops.completions.map((c) => `#${c.instanceNumber} completed ${c.toLevel}`),
    ...ops.levelChanges.map((c) => `#${c.instanceNumber} ${c.fromLevel}->${c.toLevel}${c.endsUpgrade ? ' (upgrade ended)' : ''}`),
    ...ops.removals.map((r) => `#${r.instanceNumber} removed${r.endsUpgrade ? ' (upgrade ended)' : ''}`),
    ...ops.additions.map((a) => `+#${a.instanceNumber} at ${a.level}`)
  ]
}

describe('matchInstances: completed-upgrade ambiguity (F1)', () => {
  it('offers both interpretations for the audit case: #1 upgrading 3->4, #2 idle 3, export {3, 4}', () => {
    const result = outcomes([3, 4], [inst(1, 3, { target: 4 }), inst(2, 3)])
    expect(result.map(describe_)).toEqual([
      ['#1 still 3->4', '#2 3->4'],
      ['#1 completed 4']
    ])
  })

  it('uses the exported counts: export {3, 3} only fits "still upgrading"', () => {
    expect(outcomes([3, 3], [inst(1, 3, { target: 4 }), inst(2, 3)]).map(describe_)).toEqual([['#1 still 3->4']])
  })

  it('uses the exported counts: export {4, 4} only fits "completed" plus a level change', () => {
    expect(outcomes([4, 4], [inst(1, 3, { target: 4 }), inst(2, 3)]).map(describe_)).toEqual([
      ['#1 completed 4', '#2 3->4']
    ])
  })

  it('takes grouped counts into account: export {3, 4, 4} gives two interpretations, each with one addition', () => {
    expect(outcomes([3, 4, 4], [inst(1, 3, { target: 4 }), inst(2, 3)]).map(describe_)).toEqual([
      ['#1 still 3->4', '#2 3->4', '+#3 at 4'],
      ['#1 completed 4', '+#3 at 4']
    ])
  })

  it('does not offer "still upgrading" when no exported entry is left at the old level', () => {
    // Two upgrading at 3, one exported 3: both cannot still be upgrading.
    const result = outcomes([3, 4], [inst(1, 3, { target: 4 }), inst(2, 3, { target: 4 })])
    expect(result.map(describe_)).toEqual([
      ['#1 still 3->4', '#2 completed 4'],
      ['#2 still 3->4', '#1 completed 4']
    ])
  })

  it('releases an upgrade only when nothing else fits, and marks it', () => {
    expect(outcomes([5], [inst(1, 3, { target: 4 })]).map(describe_)).toEqual([['#1 3->5 (upgrade ended)']])
    expect(outcomes([], [inst(1, 3, { target: 4 })]).map(describe_)).toEqual([['#1 removed (upgrade ended)']])
  })

  it('keeps an unambiguous recorded upgrade as is', () => {
    expect(outcomes([3, 5], [inst(1, 3, { target: 4 }), inst(2, 3)]).map(describe_)).toEqual([
      ['#1 still 3->4', '#2 3->5']
    ])
  })
})

describe('matchInstances: removed upgrading instances (audit N1)', () => {
  it('offers "the upgrading one is gone" when the export has fewer instances: export {3}', () => {
    expect(outcomes([3], [inst(1, 3, { target: 4 }), inst(2, 3)]).map(describe_)).toEqual([
      ['#1 still 3->4', '#2 removed'],
      ['#1 removed (upgrade ended)']
    ])
  })

  it('offers it alongside a completion: export {4}', () => {
    expect(outcomes([4], [inst(1, 3, { target: 4 }), inst(2, 3)]).map(describe_)).toEqual([
      ['#1 completed 4', '#2 removed'],
      ['#2 3->4', '#1 removed (upgrade ended)']
    ])
  })

  it('offers it regardless of provenance', () => {
    const result = outcomes([3], [inst(1, 3, { target: 4 }), inst(2, 3, { source: 'timer-estimate', confidence: 0.3, confirmed: false })])
    expect(result).toHaveLength(2)
  })

  it('does not invent releases when nothing has to be removed', () => {
    expect(outcomes([3, 3], [inst(1, 3, { target: 4 }), inst(2, 3)]).map(describe_)).toEqual([['#1 still 3->4']])
    expect(outcomes([3, 4], [inst(1, 3, { target: 4 }), inst(2, 3)])).toHaveLength(2) // unchanged F1 case
  })
})

describe('matchInstances: invariants (seeded random cases)', () => {
  /**
   * mulberry32: a small, well-distributed, deterministic generator. (A plain
   * `seed % n` linear congruential generator repeats its low bits and barely
   * varies levels; see the coverage assertions below.)
   */
  function generator(seed: number) {
    let state = seed
    return (n: number): number => {
      state = (state + 0x6d2b79f5) | 0
      let t = Math.imul(state ^ (state >>> 15), 1 | state)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n)
    }
  }

  /** Provenance groups: different source, confirmation and confidence bands. */
  const PROVENANCE: Array<{ source: StateSource; confidence: number; confirmed: boolean }> = [
    { source: 'manual', confidence: 1, confirmed: true },
    { source: 'manual', confidence: 1, confirmed: false },
    { source: 'timer-estimate', confidence: 0.3, confirmed: false },
    { source: 'data-export', confidence: 0.95, confirmed: true },
    { source: 'data-export', confidence: 0.5, confirmed: false }
  ]

  it('holds every matching invariant over varied villages, and the generator really varies', () => {
    const rnd = generator(20261112)
    const coverage = {
      currentLevels: new Set<number>(),
      exportedLevels: new Set<number>(),
      exportSizes: new Set<number>(),
      provenanceGroups: new Set<number>(),
      upgrading: 0,
      idle: 0,
      ambiguous: 0,
      blocked: 0
    }

    for (let c = 0; c < 5000; c += 1) {
      nextId = 1
      const current: VillageItemInstance[] = []
      for (let n = 1, size = 1 + rnd(6); n <= size; n += 1) {
        const level = 1 + rnd(5)
        const group = rnd(PROVENANCE.length)
        const upgrading = rnd(3) === 0
        coverage.currentLevels.add(level)
        coverage.provenanceGroups.add(group)
        if (upgrading) coverage.upgrading += 1
        else coverage.idle += 1
        current.push(inst(n, level, { ...PROVENANCE[group]!, target: upgrading ? level + 1 : undefined }))
      }
      const exported = Array.from({ length: rnd(8) }, () => 1 + rnd(5))
      coverage.exportSizes.add(exported.length)
      for (const level of exported) coverage.exportedLevels.add(level)

      const result = matchInstances(exported, current)
      // Deterministic: the same input gives exactly the same result.
      expect(JSON.stringify(matchInstances(exported, current))).toBe(JSON.stringify(result))
      if (result.kind === 'too-many') {
        coverage.blocked += 1
        continue
      }
      expect(result.outcomes.length).toBeGreaterThan(0)
      if (result.outcomes.length > 1) coverage.ambiguous += 1

      // Distinct interpretations.
      const keys = result.outcomes.map((o) => JSON.stringify(o))
      expect(new Set(keys).size).toBe(keys.length)

      for (const ops of result.outcomes) {
        // Exact exported multiplicities.
        expect(ops.finalLevels.map((f) => f.level).sort()).toEqual([...exported].sort())
        // Additions and removals match the difference in counts.
        expect(ops.removals.length).toBe(Math.max(0, current.length - exported.length))
        expect(ops.additions.length).toBe(Math.max(0, exported.length - current.length))
        // Exactly one fate per recorded instance: it either survives (once) or is removed (once).
        const survivors = ops.finalLevels.filter((f) => f.instanceId !== null).map((f) => f.instanceId!)
        const removed = ops.removals.map((r) => r.instanceId)
        const fates = [...survivors, ...removed].sort((a, b) => a - b)
        expect(fates).toEqual(current.map((i) => i.id).sort((a, b) => a - b))
        // Completions only to the recorded target; still-upgrading only for upgrading instances.
        for (const done of ops.completions) {
          expect(current.find((i) => i.id === done.instanceId)!.targetLevel).toBe(done.toLevel)
        }
        for (const still of ops.stillUpgrading) {
          expect(current.find((i) => i.id === still.instanceId)!.targetLevel).toBe(still.targetLevel)
        }
        // Unique instance numbers: additions never collide with each other or with recorded instances.
        const numbers = ops.finalLevels.map((f) => f.instanceNumber)
        expect(new Set(numbers).size).toBe(numbers.length)
        for (const added of ops.additions) {
          expect(current.some((i) => i.instanceNumber === added.instanceNumber)).toBe(false)
        }
      }
    }

    // Coverage: fail if the generator stops exercising the space.
    expect([...coverage.currentLevels].sort()).toEqual([1, 2, 3, 4, 5])
    expect([...coverage.exportedLevels].sort()).toEqual([1, 2, 3, 4, 5])
    expect([...coverage.exportSizes].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect(coverage.provenanceGroups.size).toBe(PROVENANCE.length)
    expect(coverage.upgrading).toBeGreaterThan(1000)
    expect(coverage.idle).toBeGreaterThan(1000)
    expect(coverage.ambiguous).toBeGreaterThan(500)
    expect(coverage.blocked).toBeGreaterThan(0) // the eight-interpretation cap is reached
  })
})

describe('matchInstances: same-level provenance (F2)', () => {
  it('treats the choice between materially different instances as ambiguous', () => {
    const result = outcomes([3, 5], [inst(1, 3), inst(2, 3, { source: 'timer-estimate', confidence: 0.3, confirmed: false })])
    expect(result.map(describe_)).toEqual([['#2 3->5'], ['#1 3->5']])
  })

  it('stays automatic for equal provenance, keeping the lowest instance numbers', () => {
    expect(outcomes([3, 5], [inst(1, 3), inst(2, 3)]).map(describe_)).toEqual([['#2 3->5']])
  })

  it('stays automatic when every instance at the level gets the same fate', () => {
    const result = outcomes([5, 5], [inst(1, 3), inst(2, 3, { source: 'data-export', confidence: 0.5, confirmed: false })])
    expect(result.map(describe_)).toEqual([['#1 3->5', '#2 3->5']])
  })

  it('surfaces which group loses an instance on removal', () => {
    const result = outcomes([3], [inst(1, 3), inst(2, 3, { confirmed: false })])
    expect(result.map(describe_)).toEqual([['#2 removed'], ['#1 removed']])
  })

  it('defines material difference by source, confirmation and 0.2 confidence bands', () => {
    const a = inst(1, 1, { source: 'data-export', confidence: 0.81, confirmed: false })
    expect(provenanceClass(a)).toBe(provenanceClass(inst(2, 1, { source: 'data-export', confidence: 0.95, confirmed: false })))
    expect(provenanceClass(a)).not.toBe(provenanceClass(inst(3, 1, { source: 'data-export', confidence: 0.79, confirmed: false })))
    expect(provenanceClass(a)).not.toBe(provenanceClass(inst(4, 1, { source: 'data-export', confidence: 0.81, confirmed: true })))
    expect(provenanceClass(inst(5, 1, { confidence: 1 }))).toBe(provenanceClass(inst(6, 1, { confidence: 0.85 })))
  })
})

describe('matchInstances: removals across levels (audit N3)', () => {
  it('asks which instance is removed when the candidates differ in provenance', () => {
    // Confirmed #1 at 2, low-confidence estimate #2 at 4; the export keeps only one, at 5.
    const result = outcomes([5], [inst(1, 2), inst(2, 4, { source: 'timer-estimate', confidence: 0.3, confirmed: false })])
    expect(result.map(describe_)).toEqual([['#2 4->5', '#1 removed'], ['#1 2->5', '#2 removed']])
  })

  it('removes the lowest level automatically when provenance is equal (decision C)', () => {
    expect(outcomes([5], [inst(1, 2), inst(2, 4)]).map(describe_)).toEqual([['#2 4->5', '#1 removed']])
    expect(outcomes([6, 7], [inst(1, 2), inst(2, 4), inst(3, 5)]).map(describe_)).toEqual([
      ['#2 4->6', '#3 5->7', '#1 removed']
    ])
  })

  it('treats levels with the same mix of provenance groups as interchangeable', () => {
    const estimate = { source: 'timer-estimate' as const, confidence: 0.3, confirmed: false }
    // Levels 2 and 3 are both confirmed-only; level 4 is estimate-only. One removal.
    const result = outcomes([6, 7], [inst(1, 2), inst(2, 3), inst(3, 4, estimate)])
    expect(result.map(describe_)).toEqual([['#2 3->6', '#3 4->7', '#1 removed'], ['#1 2->6', '#2 3->7', '#3 removed']])
  })

  it('removes released upgrades before idle instances, as before', () => {
    expect(outcomes([], [inst(1, 3, { target: 4 }), inst(2, 2)]).map(describe_)).toEqual([
      ['#1 removed (upgrade ended)', '#2 removed']
    ])
  })

  it('stops when the removal choices alone exceed the limit', () => {
    const groups = [
      {},
      { confirmed: false },
      { source: 'timer-estimate' as const, confidence: 0.3, confirmed: false },
      { source: 'data-export' as const, confidence: 0.95, confirmed: false },
      { source: 'data-export' as const, confidence: 0.5, confirmed: false },
      { source: 'screenshot' as const, confidence: 0.5, confirmed: false },
      { source: 'live-capture' as const, confidence: 0.5, confirmed: false },
      { source: 'data-export' as const, confidence: 0.1, confirmed: false },
      { source: 'screenshot' as const, confidence: 0.95, confirmed: false }
    ]
    // Nine levels, each a different provenance group, one survivor: nine possible removal sets.
    const current = groups.map((g, i) => inst(i + 1, i + 1, g))
    expect(matchInstances([20, 20, 20, 20, 20, 20, 20, 20], current).kind).toBe('too-many')
  })
})

describe('matchInstances: removal choices among released upgrades (audit A1)', () => {
  const ESTIMATE = { source: 'timer-estimate' as const, confidence: 0.3, confirmed: false }

  it('asks which released upgrade is removed when provenance differs', () => {
    // Neither old nor target levels are exported, so both upgrades are released; one survives at 9.
    expect(outcomes([9], [inst(1, 3, { target: 4 }), inst(2, 5, { target: 6, ...ESTIMATE })]).map(describe_)).toEqual([
      ['#2 5->9 (upgrade ended)', '#1 removed (upgrade ended)'],
      ['#1 3->9 (upgrade ended)', '#2 removed (upgrade ended)']
    ])
  })

  it('asks in the other provenance order too', () => {
    expect(outcomes([9], [inst(1, 3, { target: 4, ...ESTIMATE }), inst(2, 5, { target: 6 })]).map(describe_)).toEqual([
      ['#2 5->9 (upgrade ended)', '#1 removed (upgrade ended)'],
      ['#1 3->9 (upgrade ended)', '#2 removed (upgrade ended)']
    ])
  })

  it('removes the lowest-level released upgrade automatically when provenance is equal', () => {
    expect(outcomes([9], [inst(1, 3, { target: 4 }), inst(2, 5, { target: 6 })]).map(describe_)).toEqual([
      ['#2 5->9 (upgrade ended)', '#1 removed (upgrade ended)']
    ])
  })

  it('enumerates choices among several released upgrades in different groups', () => {
    // Three released upgrades in three groups, one survives: three interpretations.
    const result = outcomes(
      [9],
      [
        inst(1, 3, { target: 4 }),
        inst(2, 5, { target: 6, ...ESTIMATE }),
        inst(3, 7, { target: 8, confirmed: false })
      ]
    )
    expect(result).toHaveLength(3)
    expect(result.map((ops) => ops.levelChanges.map((c) => c.instanceNumber))).toEqual([[3], [2], [1]])
    for (const ops of result) expect(ops.removals.every((r) => r.endsUpgrade)).toBe(true)
  })

  it('combines released choices with idle provenance choices', () => {
    // Released #1 (confirmed) and #2 (estimate); idle #3 (confirmed) and #4 (estimate) at 7.
    // Export {7, 8, 9}: one idle stays at 7; the other idle plus one released take 8 and 9; one released goes.
    const result = outcomes(
      [7, 8, 9],
      [
        inst(1, 3, { target: 4 }),
        inst(2, 5, { target: 6, ...ESTIMATE }),
        inst(3, 7),
        inst(4, 7, ESTIMATE)
      ]
    )
    expect(result).toHaveLength(4) // 2 released choices x 2 idle choices
    for (const ops of result) {
      expect(ops.finalLevels.map((f) => f.level).sort()).toEqual([7, 8, 9])
      expect(ops.removals).toHaveLength(1)
      expect(ops.removals[0]!.endsUpgrade).toBe(true)
    }
  })

  it('blocks when released and idle choices together exceed the limit', () => {
    const groups = [{}, ESTIMATE, { confirmed: false }]
    // Three released (three groups), two must go: 3 choices. Idle at 7 in three groups, one kept: 3 choices.
    const current = [
      ...groups.map((g, i) => inst(i + 1, 1 + 2 * i, { target: 2 + 2 * i, ...g })),
      ...groups.map((g, i) => inst(i + 4, 7, g))
    ]
    expect(matchInstances([7, 9, 9, 9], current)).toEqual({
      kind: 'too-many',
      reason: 'More than 8 possible interpretations; correct this item manually'
    })
  })
})

describe('matchInstances: limits and determinism', () => {
  it('stops at the interpretation limit instead of enumerating everything', () => {
    // Four upgrades, export {3,3,4,4}: which two are still upgrading -> C(4,2) = 6, within the limit.
    const current = [1, 2, 3, 4].map((n) => inst(n, 3, { target: 4 }))
    const within = matchInstances([3, 3, 4, 4], current)
    expect(within.kind === 'outcomes' && within.outcomes.length).toBe(6)
    // Eight upgrades, export {3x4, 4x4}: C(8,4) = 70 interpretations -> stopped at the limit.
    const many = matchInstances([3, 3, 3, 3, 4, 4, 4, 4], [...current, ...[5, 6, 7, 8].map((n) => inst(n, 3, { target: 4 }))])
    expect(many).toEqual({
      kind: 'too-many',
      reason: `More than ${MAX_INTERPRETATIONS} possible interpretations; correct this item manually`
    })
  })

  it('caps provenance distributions over very large same-level groups without exploding', () => {
    const walls = [
      ...Array.from({ length: 150 }, (_, i) => inst(i + 1, 5)),
      ...Array.from({ length: 150 }, (_, i) => inst(i + 151, 5, { source: 'data-export', confidence: 0.5, confirmed: false }))
    ]
    const exported = [...Array.from({ length: 200 }, () => 5), ...Array.from({ length: 100 }, () => 6)]
    const started = Date.now()
    expect(matchInstances(exported, walls).kind).toBe('too-many')
    expect(Date.now() - started).toBeLessThan(2000)
  })

  it('refuses items with more upgrades than the matching limit', () => {
    const current = Array.from({ length: 9 }, (_, i) => inst(i + 1, 3, { target: 4 }))
    expect(matchInstances(Array.from({ length: 9 }, () => 3), current).kind).toBe('too-many')
  })

  it('is deterministic and every operation is exact', () => {
    const current = () => [inst(1, 3, { target: 4 }), inst(2, 3), inst(3, 2, { confirmed: false })]
    const a = matchInstances([2, 3, 4, 6], current())
    const b = matchInstances([2, 3, 4, 6], current())
    const strip = (r: typeof a) => JSON.stringify(r, (k, v) => (k === 'instanceId' ? undefined : v))
    expect(strip(a)).toBe(strip(b))
    if (a.kind !== 'outcomes') throw new Error('expected outcomes')
    for (const ops of a.outcomes) {
      // Every interpretation realises exactly the exported multiset.
      expect(ops.finalLevels.map((f) => f.level).sort()).toEqual([2, 3, 4, 6])
    }
  })

  it('adds new instances at the next free numbers', () => {
    expect(outcomes([3, 3, 3], [inst(2, 3)]).map(describe_)).toEqual([['+#1 at 3', '+#3 at 3']])
  })
})
