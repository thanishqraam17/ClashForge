import type Database from 'better-sqlite3'
import {
  EDIT_ACTIONS,
  EDIT_ENTITY_TYPES,
  EditLogValidationError,
  validateEditLogInput,
  type EditAction,
  type EditEntityType,
  type EditLogEntry,
  type EditLogInput,
  type JsonValue
} from '../../domain/edit-log'

/**
 * Append-only store of manual edits. There is deliberately no update or
 * delete method; a database trigger rejects updates, and entries are only
 * removed when their village is deleted (cascade).
 */

type EditLogRow = {
  id: number
  village_id: number
  entity_type: string
  entity_id: number | null
  item_id: string | null
  action: string
  before_state: string | null
  after_state: string | null
  batch_id: string | null
  note: string | null
  created_at: string
}

export type EditLogQuery = {
  /** 1 to EDIT_LOG_MAX_LIMIT; defaults to 50. */
  limit?: number
  /** Return entries older than this id (for paging). */
  beforeId?: number
  entityType?: EditEntityType
  itemId?: string
  batchId?: string
}

export const EDIT_LOG_MAX_LIMIT = 200

export class EditLogRepository {
  constructor(private readonly db: Database.Database) {}

  append(input: EditLogInput): EditLogEntry {
    validateEditLogInput(input)
    const result = this.db
      .prepare(
        `INSERT INTO edit_log (
          village_id, entity_type, entity_id, item_id, action,
          before_state, after_state, batch_id, note, created_at
        ) VALUES (
          @villageId, @entityType, @entityId, @itemId, @action,
          @before, @after, @batchId, @note, @createdAt
        )`
      )
      .run({
        villageId: input.villageId,
        entityType: input.entityType,
        entityId: input.entityId,
        itemId: input.itemId,
        action: input.action,
        before: input.before === null ? null : JSON.stringify(input.before),
        after: input.after === null ? null : JSON.stringify(input.after),
        batchId: input.batchId,
        note: input.note,
        createdAt: new Date().toISOString()
      })
    return this.getById(Number(result.lastInsertRowid))!
  }

  /**
   * Writes several entries. Every entry is validated before any is written;
   * callers run this inside their own transaction so it commits or rolls
   * back with the change it describes.
   */
  appendMany(inputs: EditLogInput[]): EditLogEntry[] {
    for (const input of inputs) validateEditLogInput(input)
    return inputs.map((input) => this.append(input))
  }

  getById(id: number): EditLogEntry | null {
    const row = this.db.prepare('SELECT * FROM edit_log WHERE id = ?').get(id) as EditLogRow | undefined
    return row ? mapRow(row) : null
  }

  /** Newest first. */
  list(villageId: number, query: EditLogQuery = {}): EditLogEntry[] {
    const limit = query.limit ?? 50
    if (!Number.isInteger(limit) || limit < 1 || limit > EDIT_LOG_MAX_LIMIT) {
      throw new EditLogValidationError(`limit must be between 1 and ${EDIT_LOG_MAX_LIMIT}`)
    }
    const where = ['village_id = @villageId']
    if (query.beforeId !== undefined) where.push('id < @beforeId')
    if (query.entityType !== undefined) where.push('entity_type = @entityType')
    if (query.itemId !== undefined) where.push('item_id = @itemId')
    if (query.batchId !== undefined) where.push('batch_id = @batchId')
    const rows = this.db
      .prepare(`SELECT * FROM edit_log WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT @limit`)
      .all({
        villageId,
        limit,
        beforeId: query.beforeId ?? null,
        entityType: query.entityType ?? null,
        itemId: query.itemId ?? null,
        batchId: query.batchId ?? null
      }) as EditLogRow[]
    return rows.map(mapRow)
  }

  /** Every entry of one bulk edit, in the order written. */
  getBatch(batchId: string): EditLogEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM edit_log WHERE batch_id = ? ORDER BY id')
      .all(batchId) as EditLogRow[]
    return rows.map(mapRow)
  }
}

export function createEditLogRepository(db: Database.Database): EditLogRepository {
  return new EditLogRepository(db)
}

function mapRow(row: EditLogRow): EditLogEntry {
  if (!(EDIT_ENTITY_TYPES as readonly string[]).includes(row.entity_type)) {
    throw new Error(`Stored entity type "${row.entity_type}" is invalid`)
  }
  if (!(EDIT_ACTIONS as readonly string[]).includes(row.action)) {
    throw new Error(`Stored action "${row.action}" is invalid`)
  }
  return {
    id: row.id,
    villageId: row.village_id,
    entityType: row.entity_type as EditEntityType,
    entityId: row.entity_id,
    itemId: row.item_id,
    action: row.action as EditAction,
    // Parsed fresh on every read, so callers can never change stored data.
    before: row.before_state === null ? null : (JSON.parse(row.before_state) as JsonValue),
    after: row.after_state === null ? null : (JSON.parse(row.after_state) as JsonValue),
    batchId: row.batch_id,
    note: row.note,
    createdAt: new Date(row.created_at)
  }
}
