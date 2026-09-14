import type Database from 'better-sqlite3'
import {
  isUpgradeHistoryEntityType,
  validateUpgradeHistoryRecordInput,
  type UpgradeHistory,
  type UpgradeHistoryRecordInput,
  UpgradeHistoryValidationError
} from '../../domain/upgrade-history'

type UpgradeHistoryRow = {
  id: number
  village_id: number
  entity_type: string
  entity_name: string
  from_level: number
  to_level: number
  started_at: string
  completed_at: string | null
  created_at: string
}

const ORDER_BY_RECENT = 'ORDER BY created_at DESC, id DESC'

export class UpgradeHistoryRepository {
  constructor(private readonly db: Database.Database) {}

  recordUpgrade(input: UpgradeHistoryRecordInput): UpgradeHistory {
    validateUpgradeHistoryRecordInput(input)
    const createdAt = new Date().toISOString()

    const result = this.db
      .prepare(
        `INSERT INTO upgrade_history (
          village_id, entity_type, entity_name, from_level, to_level,
          started_at, completed_at, created_at
        ) VALUES (
          @villageId, @entityType, @entityName, @fromLevel, @toLevel,
          @startedAt, @completedAt, @createdAt
        )`
      )
      .run({
        villageId: input.villageId,
        entityType: input.entityType,
        entityName: input.entityName,
        fromLevel: input.fromLevel,
        toLevel: input.toLevel,
        startedAt: input.startedAt.toISOString(),
        completedAt: input.completedAt?.toISOString() ?? null,
        createdAt
      })

    return this.getById(Number(result.lastInsertRowid))!
  }

  getById(id: number): UpgradeHistory | null {
    if (id < 1) {
      throw new UpgradeHistoryValidationError('id must be at least 1')
    }
    const row = this.db.prepare('SELECT * FROM upgrade_history WHERE id = ?').get(id) as
      | UpgradeHistoryRow
      | undefined
    return row ? mapRowToUpgradeHistory(row) : null
  }

  getByVillageId(villageId: number): UpgradeHistory[] {
    if (villageId < 1) {
      throw new UpgradeHistoryValidationError('villageId must be at least 1')
    }
    const rows = this.db
      .prepare(`SELECT * FROM upgrade_history WHERE village_id = ? ${ORDER_BY_RECENT}`)
      .all(villageId) as UpgradeHistoryRow[]
    return rows.map(mapRowToUpgradeHistory)
  }

  getRecentByVillageId(villageId: number, limit?: number): UpgradeHistory[] {
    if (villageId < 1) {
      throw new UpgradeHistoryValidationError('villageId must be at least 1')
    }
    if (limit !== undefined) {
      if (!Number.isInteger(limit) || limit < 1) {
        throw new UpgradeHistoryValidationError('limit must be a positive integer')
      }
      const rows = this.db
        .prepare(
          `SELECT * FROM upgrade_history WHERE village_id = ? ${ORDER_BY_RECENT} LIMIT ?`
        )
        .all(villageId, limit) as UpgradeHistoryRow[]
      return rows.map(mapRowToUpgradeHistory)
    }

    return this.getByVillageId(villageId)
  }
}

export function createUpgradeHistoryRepository(
  db: Database.Database
): UpgradeHistoryRepository {
  return new UpgradeHistoryRepository(db)
}

function mapRowToUpgradeHistory(row: UpgradeHistoryRow): UpgradeHistory {
  if (!isUpgradeHistoryEntityType(row.entity_type)) {
    throw new UpgradeHistoryValidationError(
      `Stored entity_type "${row.entity_type}" is invalid`
    )
  }

  return {
    id: row.id,
    villageId: row.village_id,
    entityType: row.entity_type,
    entityName: row.entity_name,
    fromLevel: row.from_level,
    toLevel: row.to_level,
    startedAt: new Date(row.started_at),
    completedAt: row.completed_at ? new Date(row.completed_at) : null,
    createdAt: new Date(row.created_at)
  }
}
