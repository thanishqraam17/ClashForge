import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LOCAL_VILLAGE_ID } from '../../domain/village'
import type { ExportObservation } from './import-repository'
import { createTestDatabase, type TestDatabase } from './test-helpers'

const input = {
  villageId: LOCAL_VILLAGE_ID,
  exportTimestamp: 1704067200,
  contentSha256: 'c'.repeat(64),
  dataVersion: '0.1.1',
  semanticsVersion: '0.1.0',
  stateFingerprint: 'fp-1',
  summary: { entries: 3, unknownFields: [{ path: 'buildings[0].x', name: 'x' }] }
}

function observation(overrides: Partial<ExportObservation> = {}): ExportObservation {
  return {
    section: 'traps',
    position: 0,
    dataId: 12000000,
    level: 9,
    count: null,
    timer: 56132,
    gearUp: null,
    helperCooldown: null,
    helperRecurrent: null,
    mappedItemId: null,
    classification: 'unmapped',
    timerDisposition: 'ignored-unverified',
    ...overrides
  }
}

describe('ImportRepository', () => {
  let t: TestDatabase

  beforeEach(() => {
    t = createTestDatabase({ withVillage: true })
  })

  afterEach(() => t.cleanup())

  it('creates a previewed import that keeps the original export timestamp', () => {
    const created = t.database.imports.create(input)
    expect(created).toMatchObject({
      villageId: 1,
      exportTimestamp: 1704067200,
      status: 'previewed',
      appliedAt: null,
      discardedAt: null,
      applyResult: null,
      summary: input.summary
    })
    expect(t.database.imports.list(LOCAL_VILLAGE_ID).map((i) => i.id)).toEqual([created.id])
  })

  it('moves only from previewed to applied or discarded', () => {
    const a = t.database.imports.create(input)
    const applied = t.database.imports.markApplied(a.id, { changes: 2 })
    expect(applied).toMatchObject({ status: 'applied', applyResult: { changes: 2 } })
    expect(() => t.database.imports.markDiscarded(a.id)).toThrow(/previewed to applied/)

    const b = t.database.imports.create({ ...input, contentSha256: 'd'.repeat(64) })
    expect(t.database.imports.markDiscarded(b.id).status).toBe('discarded')
    expect(() => t.database.imports.markApplied(b.id, {})).toThrow(/previewed to applied/)
  })

  it('stores observations exactly, including absent fields and raw timers', () => {
    const imp = t.database.imports.create(input)
    t.database.imports.addObservations(imp.id, [
      observation(),
      observation({ position: 4, count: 1, timer: null, timerDisposition: null }),
      observation({
        section: 'units',
        position: 16,
        dataId: 4000022,
        level: 7,
        timer: 20514,
        helperRecurrent: false,
        mappedItemId: 'test-archer',
        classification: 'mapped'
      })
    ])
    const stored = t.database.imports.listObservations(imp.id)
    expect(stored).toHaveLength(3)
    expect(stored[0]).toEqual(observation())
    expect(stored[1]).toMatchObject({ count: 1, timer: null, timerDisposition: null })
    expect(stored[2]).toMatchObject({ helperRecurrent: false, mappedItemId: 'test-archer', timer: 20514 })
  })
})
