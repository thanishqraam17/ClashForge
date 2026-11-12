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
