import type Database from 'better-sqlite3'

/**
 * Records of data-export imports (migration 004).
 *
 * - An import row is created when a preview is made and can only move from
 *   `previewed` to `applied` or `discarded` (enforced by a database trigger).
 * - Observations are every parsed export entry exactly as exported, stored
 *   with the preview and never edited.
 */

export const IMPORT_STATUSES = ['previewed', 'applied', 'discarded'] as const
export type ImportStatus = (typeof IMPORT_STATUSES)[number]

export const OBSERVATION_CLASSIFICATIONS = ['mapped', 'unmapped', 'out-of-scope', 'unknown-section'] as const
export type ObservationClassification = (typeof OBSERVATION_CLASSIFICATIONS)[number]

export const TIMER_DISPOSITIONS = ['ignored-unverified', 'applied-as-upgrade'] as const
export type TimerDisposition = (typeof TIMER_DISPOSITIONS)[number]

export type ExportImport = {
  id: number
  villageId: number
  /** Original export timestamp (Unix seconds), unchanged. */
  exportTimestamp: number
  contentSha256: string
  dataVersion: string
  semanticsVersion: string
  status: ImportStatus
  previewedAt: Date
  appliedAt: Date | null
  discardedAt: Date | null
  stateFingerprint: string
  summary: unknown
  applyResult: unknown | null
  createdAt: Date
}

export type CreateImportInput = {
  villageId: number
  exportTimestamp: number
  contentSha256: string
  dataVersion: string
  semanticsVersion: string
  stateFingerprint: string
  summary: unknown
}

export type ExportObservation = {
  section: string
  position: number
  dataId: number
  level: number | null
  count: number | null
  timer: number | null
  gearUp: number | null
  helperCooldown: number | null
  helperRecurrent: boolean | null
  mappedItemId: string | null
  classification: ObservationClassification
  timerDisposition: TimerDisposition | null
}

type ImportRow = {
  id: number
  village_id: number
  export_timestamp: number
  content_sha256: string
  data_version: string
  semantics_version: string
  status: ImportStatus
  previewed_at: string
  applied_at: string | null
  discarded_at: string | null
  state_fingerprint: string
  summary: string
  apply_result: string | null
  created_at: string
}

type ObservationRow = {
  section: string
  position: number
  data_id: number
  level: number | null
  count: number | null
  timer: number | null
  gear_up: number | null
  helper_cooldown: number | null
  helper_recurrent: number | null
  mapped_item_id: string | null
  classification: ObservationClassification
  timer_disposition: TimerDisposition | null
}

export class ImportRepository {
  constructor(private readonly db: Database.Database) {}

  create(input: CreateImportInput): ExportImport {
    const now = new Date().toISOString()
    const result = this.db
      .prepare(
        `INSERT INTO export_imports (
          village_id, export_timestamp, content_sha256, data_version, semantics_version,
          status, previewed_at, state_fingerprint, summary, created_at
        ) VALUES (?, ?, ?, ?, ?, 'previewed', ?, ?, ?, ?)`
      )
      .run(
        input.villageId,
        input.exportTimestamp,
        input.contentSha256,
        input.dataVersion,
        input.semanticsVersion,
        now,
        input.stateFingerprint,
        JSON.stringify(input.summary),
        now
      )
    return this.getById(Number(result.lastInsertRowid))!
  }

  getById(id: number): ExportImport | null {
    const row = this.db.prepare('SELECT * FROM export_imports WHERE id = ?').get(id) as
      | ImportRow
      | undefined
    return row ? mapImport(row) : null
  }

  /** Newest first. */
  list(villageId: number, limit = 50): ExportImport[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM export_imports WHERE village_id = ? ORDER BY previewed_at DESC, id DESC LIMIT ?'
      )
      .all(villageId, limit) as ImportRow[]
    return rows.map(mapImport)
  }

  markApplied(id: number, applyResult: unknown): ExportImport {
    this.db
      .prepare(
        `UPDATE export_imports SET status = 'applied', applied_at = ?, apply_result = ? WHERE id = ?`
      )
      .run(new Date().toISOString(), JSON.stringify(applyResult), id)
    return this.getById(id)!
  }

  markDiscarded(id: number): ExportImport {
    this.db
      .prepare(`UPDATE export_imports SET status = 'discarded', discarded_at = ? WHERE id = ?`)
      .run(new Date().toISOString(), id)
    return this.getById(id)!
  }

  addObservations(importId: number, observations: ExportObservation[]): void {
    const insert = this.db.prepare(
      `INSERT INTO export_observations (
        import_id, section, position, data_id, level, count, timer, gear_up,
        helper_cooldown, helper_recurrent, mapped_item_id, classification, timer_disposition, created_at
      ) VALUES (
        @importId, @section, @position, @dataId, @level, @count, @timer, @gearUp,
        @helperCooldown, @helperRecurrent, @mappedItemId, @classification, @timerDisposition, @now
      )`
    )
    const now = new Date().toISOString()
    for (const o of observations) {
      insert.run({
        importId,
        section: o.section,
        position: o.position,
        dataId: o.dataId,
        level: o.level,
        count: o.count,
        timer: o.timer,
        gearUp: o.gearUp,
        helperCooldown: o.helperCooldown,
        helperRecurrent: o.helperRecurrent === null ? null : o.helperRecurrent ? 1 : 0,
        mappedItemId: o.mappedItemId,
        classification: o.classification,
        timerDisposition: o.timerDisposition,
        now
      })
    }
  }

  listObservations(importId: number): ExportObservation[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM export_observations WHERE import_id = ? ORDER BY section, position'
      )
      .all(importId) as ObservationRow[]
    return rows.map((row) => ({
      section: row.section,
      position: row.position,
      dataId: row.data_id,
      level: row.level,
      count: row.count,
      timer: row.timer,
      gearUp: row.gear_up,
      helperCooldown: row.helper_cooldown,
      helperRecurrent: row.helper_recurrent === null ? null : row.helper_recurrent === 1,
      mappedItemId: row.mapped_item_id,
      classification: row.classification,
      timerDisposition: row.timer_disposition
    }))
  }
}

export function createImportRepository(db: Database.Database): ImportRepository {
  return new ImportRepository(db)
}

function mapImport(row: ImportRow): ExportImport {
  return {
    id: row.id,
    villageId: row.village_id,
    exportTimestamp: row.export_timestamp,
    contentSha256: row.content_sha256,
    dataVersion: row.data_version,
    semanticsVersion: row.semantics_version,
    status: row.status,
    previewedAt: new Date(row.previewed_at),
    appliedAt: row.applied_at ? new Date(row.applied_at) : null,
    discardedAt: row.discarded_at ? new Date(row.discarded_at) : null,
    stateFingerprint: row.state_fingerprint,
    summary: JSON.parse(row.summary),
    applyResult: row.apply_result === null ? null : JSON.parse(row.apply_result),
    createdAt: new Date(row.created_at)
  }
}
