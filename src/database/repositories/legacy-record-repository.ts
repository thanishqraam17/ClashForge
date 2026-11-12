import type Database from 'better-sqlite3'

/**
 * Records archived by migration 003 from the old free-text buildings, heroes
 * and research tables. They are never deleted: a record is either converted to
 * the catalogue-based model (when the mapping is reliable), left pending for
 * the player to reconcile, or dismissed by the player.
 */

export const LEGACY_KINDS = ['building', 'hero', 'research'] as const
export type LegacyKind = (typeof LEGACY_KINDS)[number]

export const RECONCILIATION_STATUSES = ['pending', 'converted', 'dismissed'] as const
export type ReconciliationStatus = (typeof RECONCILIATION_STATUSES)[number]

export type LegacyRecord = {
  kind: LegacyKind
  id: number
  villageId: number
  name: string
  /** Free-text category from the old model; null for heroes, which had none. */
  category: string | null
  level: number
  /** Buildings stored a count; heroes and research are always 1. */
  quantity: number
  isUpgrading: boolean
  upgradeStartedAt: Date | null
  upgradeEndsAt: Date | null
  status: ReconciliationStatus
  mappedItemId: string | null
  note: string | null
  reconciledAt: Date | null
  archivedAt: Date | null
}

const TABLES: Record<LegacyKind, string> = {
  building: 'legacy_buildings',
  hero: 'legacy_heroes',
  research: 'legacy_research'
}

type LegacyRow = {
  id: number
  village_id: number
  name: string
  category?: string
  level: number
  quantity?: number
  is_upgrading?: number
  is_researching?: number
  upgrade_started_at?: string | null
  upgrade_ends_at?: string | null
  research_started_at?: string | null
  research_ends_at?: string | null
  reconciliation_status: ReconciliationStatus
  mapped_item_id: string | null
  reconciliation_note: string | null
  reconciled_at: string | null
  archived_at: string | null
}

function date(value: string | null | undefined): Date | null {
  return value ? new Date(value) : null
}

export class LegacyRecordRepository {
  constructor(private readonly db: Database.Database) {}

  list(options: { villageId?: number; status?: ReconciliationStatus } = {}): LegacyRecord[] {
    const records: LegacyRecord[] = []
    for (const kind of LEGACY_KINDS) {
      const where: string[] = []
      const params: unknown[] = []
      if (options.villageId !== undefined) {
        where.push('village_id = ?')
        params.push(options.villageId)
      }
      if (options.status !== undefined) {
        where.push('reconciliation_status = ?')
        params.push(options.status)
      }
      const sql = `SELECT * FROM ${TABLES[kind]}${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY id`
      const rows = this.db.prepare(sql).all(...params) as LegacyRow[]
      records.push(...rows.map((row) => mapRow(kind, row)))
    }
    return records
  }

  get(kind: LegacyKind, id: number): LegacyRecord | null {
    const row = this.db.prepare(`SELECT * FROM ${TABLES[kind]} WHERE id = ?`).get(id) as
      | LegacyRow
      | undefined
    return row ? mapRow(kind, row) : null
  }

  countByStatus(villageId: number): Record<ReconciliationStatus, number> {
    const counts: Record<ReconciliationStatus, number> = { pending: 0, converted: 0, dismissed: 0 }
    for (const kind of LEGACY_KINDS) {
      const rows = this.db
        .prepare(
          `SELECT reconciliation_status AS status, COUNT(*) AS n FROM ${TABLES[kind]}
           WHERE village_id = ? GROUP BY reconciliation_status`
        )
        .all(villageId) as Array<{ status: ReconciliationStatus; n: number }>
      for (const row of rows) counts[row.status] += row.n
    }
    return counts
  }

  /** Records why a pending record could not be converted (updated on each attempt). */
  setPendingNote(kind: LegacyKind, id: number, note: string): void {
    this.db
      .prepare(
        `UPDATE ${TABLES[kind]} SET reconciliation_note = ?
         WHERE id = ? AND reconciliation_status = 'pending'`
      )
      .run(note, id)
  }

  /** Marks a pending record as converted. The original columns are kept. */
  markConverted(kind: LegacyKind, id: number, mappedItemId: string, note: string): void {
    const result = this.db
      .prepare(
        `UPDATE ${TABLES[kind]} SET reconciliation_status = 'converted', mapped_item_id = ?,
           reconciliation_note = ?, reconciled_at = ?
         WHERE id = ? AND reconciliation_status = 'pending'`
      )
      .run(mappedItemId, note, new Date().toISOString(), id)
    if (result.changes !== 1) {
      throw new Error(`Legacy ${kind} ${id} is not pending`)
    }
  }
}

export function createLegacyRecordRepository(db: Database.Database): LegacyRecordRepository {
  return new LegacyRecordRepository(db)
}

function mapRow(kind: LegacyKind, row: LegacyRow): LegacyRecord {
  const isResearch = kind === 'research'
  return {
    kind,
    id: row.id,
    villageId: row.village_id,
    name: row.name,
    category: row.category ?? null,
    level: row.level,
    quantity: kind === 'building' ? (row.quantity ?? 1) : 1,
    isUpgrading: (isResearch ? row.is_researching : row.is_upgrading) === 1,
    upgradeStartedAt: date(isResearch ? row.research_started_at : row.upgrade_started_at),
    upgradeEndsAt: date(isResearch ? row.research_ends_at : row.upgrade_ends_at),
    status: row.reconciliation_status,
    mappedItemId: row.mapped_item_id,
    note: row.reconciliation_note,
    reconciledAt: date(row.reconciled_at),
    archivedAt: date(row.archived_at)
  }
}
