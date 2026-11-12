import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EditLogValidationError, type EditLogInput } from '../../domain/edit-log'
import { LOCAL_VILLAGE_ID } from '../../domain/village'
import { createTestDatabase, type TestDatabase } from './test-helpers'

function entry(overrides: Partial<EditLogInput> = {}): EditLogInput {
  return {
    villageId: LOCAL_VILLAGE_ID,
    entityType: 'item-instance',
    entityId: 1,
    itemId: 'test-cannon',
    action: 'update',
    before: { level: 3 },
    after: { level: 4 },
    batchId: null,
    note: null,
    ...overrides
  }
}

describe('EditLogRepository', () => {
  let t: TestDatabase

  beforeEach(() => {
    t = createTestDatabase({ withVillage: true })
  })

  afterEach(() => t.cleanup())

  it('appends an entry and reads it back exactly', () => {
    const saved = t.database.editLog.append(entry({ note: 'fixed a typo' }))
    expect(saved).toMatchObject({
      villageId: 1,
      entityType: 'item-instance',
      entityId: 1,
      itemId: 'test-cannon',
      action: 'update',
      before: { level: 3 },
      after: { level: 4 },
      batchId: null,
      note: 'fixed a typo'
    })
    expect(saved.createdAt).toBeInstanceOf(Date)
    expect(t.database.editLog.getById(saved.id)).toEqual(saved)
  })

  it('lists newest first, pages with beforeId, and filters', () => {
    const log = t.database.editLog
    log.append(entry({ itemId: 'test-mortar' }))
    log.append(entry({ entityType: 'builders', entityId: null, itemId: null, action: 'set-count', before: 2, after: 3 }))
    const third = log.append(entry())
    expect(log.list(LOCAL_VILLAGE_ID).map((e) => e.id)).toEqual([third.id, third.id - 1, third.id - 2])
    expect(log.list(LOCAL_VILLAGE_ID, { limit: 1 }).map((e) => e.id)).toEqual([third.id])
    expect(log.list(LOCAL_VILLAGE_ID, { beforeId: third.id }).map((e) => e.id)).toEqual([third.id - 1, third.id - 2])
    expect(log.list(LOCAL_VILLAGE_ID, { entityType: 'builders' })).toHaveLength(1)
    expect(log.list(LOCAL_VILLAGE_ID, { itemId: 'test-mortar' })).toHaveLength(1)
    expect(() => log.list(LOCAL_VILLAGE_ID, { limit: 0 })).toThrow(EditLogValidationError)
    expect(() => log.list(LOCAL_VILLAGE_ID, { limit: 201 })).toThrow(EditLogValidationError)
  })

  it('returns a batch in the order written', () => {
    const batch = t.database.editLog.appendMany([
      entry({ entityId: 3, batchId: 'b1' }),
      entry({ entityId: 1, batchId: 'b1' }),
      entry({ entityId: 2, batchId: 'b1' })
    ])
    t.database.editLog.append(entry({ batchId: 'b2' }))
    expect(t.database.editLog.getBatch('b1').map((e) => e.entityId)).toEqual([3, 1, 2])
    expect(batch).toHaveLength(3)
    expect(t.database.editLog.list(LOCAL_VILLAGE_ID, { batchId: 'b1' })).toHaveLength(3)
  })

  it('validates every entry of appendMany before writing any', () => {
    expect(() =>
      t.database.editLog.appendMany([entry({ batchId: 'b' }), entry({ batchId: 'b', after: { level: undefined } as never })])
    ).toThrow('after.level is undefined, which is not JSON')
    expect(t.database.editLog.list(LOCAL_VILLAGE_ID)).toEqual([])
  })

  it('rolls back with the surrounding transaction', () => {
    expect(() =>
      t.database.transaction(() => {
        t.database.editLog.appendMany([entry({ batchId: 'b' }), entry({ batchId: 'b' })])
        throw new Error('the change failed')
      })
    ).toThrow('the change failed')
    expect(t.database.editLog.list(LOCAL_VILLAGE_ID)).toEqual([])
  })

  it('returns fresh copies, so callers cannot change stored data', () => {
    const saved = t.database.editLog.append(entry())
    ;(saved.after as { level: number }).level = 99
    expect(t.database.editLog.getById(saved.id)!.after).toEqual({ level: 4 })
  })

  it('cannot be updated, and entries go with their village', () => {
    const saved = t.database.editLog.append(entry())
    const raw = new Database(t.dbPath)
    raw.pragma('foreign_keys = ON')
    expect(() => raw.prepare(`UPDATE edit_log SET note = 'changed' WHERE id = ?`).run(saved.id)).toThrow(
      /edit log entries are immutable/
    )
    raw.prepare('DELETE FROM villages WHERE id = ?').run(LOCAL_VILLAGE_ID)
    expect(raw.prepare('SELECT COUNT(*) AS n FROM edit_log').get()).toEqual({ n: 0 })
    raw.close()
  })

  it('has no update or delete methods', () => {
    const repo = t.database.editLog as unknown as Record<string, unknown>
    for (const name of ['update', 'delete', 'remove', 'clear']) expect(repo[name]).toBeUndefined()
  })
})
