import type Database from 'better-sqlite3'
import {
  buildSnapshotPayload,
  SNAPSHOT_SCHEMA_VERSION,
  VillageStateValidationError,
  type StateSource,
  type VillageSnapshot,
  type VillageSnapshotPayload
} from '../../domain/village-state'
import type { BuilderRepository } from './builder-repository'
import { parseStateSource } from './provenance'
import type { ResearchStateRepository } from './research-state-repository'
import type { VillageItemRepository } from './village-item-repository'
import type { VillageRepository } from './village-repository'

type SnapshotRow = {
  id: number
  village_id: number
  captured_at: string
  source: string
  data_version: string
  schema_version: number
  payload: string
  created_at: string
}

export type CaptureSnapshotInput = {
  villageId: number
  source: StateSource
  /** Game dataset version in use. */
  dataVersion: string
  capturedAt?: Date
}

export type SnapshotRepositoryDependencies = {
  villages: VillageRepository
  villageItems: VillageItemRepository
  builders: BuilderRepository
  researchStates: ResearchStateRepository
}

/**
 * Append-only store of village snapshots. There is deliberately no update
 * method, and a database trigger rejects UPDATEs, so a snapshot always
 * describes the state at its capture time.
 */
export class SnapshotRepository {
  constructor(
    private readonly db: Database.Database,
    private readonly state: SnapshotRepositoryDependencies
  ) {}

  /** Reads the current state and stores it, atomically. */
  capture(input: CaptureSnapshotInput): VillageSnapshot {
    if (!input.dataVersion.trim()) {
      throw new VillageStateValidationError('dataVersion is required')
    }
    const capturedAt = input.capturedAt ?? new Date()
    if (Number.isNaN(capturedAt.getTime())) {
      throw new VillageStateValidationError('capturedAt is invalid')
    }
    parseStateSource(input.source)

    const run = this.db.transaction((): number => {
      const village = this.state.villages.getVillage()
      if (village === null || village.id !== input.villageId) {
        throw new VillageStateValidationError('Cannot snapshot a village that does not exist')
      }
      const payload = buildSnapshotPayload({
        village,
        builders: this.state.builders.listByVillage(input.villageId),
        items: this.state.villageItems.listByVillage(input.villageId),
        research: this.state.researchStates.listByVillage(input.villageId)
      })
      const result = this.db
        .prepare(
          `INSERT INTO village_snapshots (
            village_id, captured_at, source, data_version, schema_version, payload, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          input.villageId,
          capturedAt.toISOString(),
          input.source,
          input.dataVersion,
          SNAPSHOT_SCHEMA_VERSION,
          JSON.stringify(payload),
          new Date().toISOString()
        )
      return Number(result.lastInsertRowid)
    })

    return this.getById(run())!
  }

  getById(id: number): VillageSnapshot | null {
    const row = this.db.prepare('SELECT * FROM village_snapshots WHERE id = ?').get(id) as
      | SnapshotRow
      | undefined
    return row ? mapRow(row) : null
  }

  /** The most recent snapshot: the last confirmed baseline for change detection. */
  getLatest(villageId: number): VillageSnapshot | null {
    const row = this.db
      .prepare(
        'SELECT * FROM village_snapshots WHERE village_id = ? ORDER BY captured_at DESC, id DESC LIMIT 1'
      )
      .get(villageId) as SnapshotRow | undefined
    return row ? mapRow(row) : null
  }

  /** Newest first. */
  list(villageId: number, limit = 50): VillageSnapshot[] {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new VillageStateValidationError('limit must be a positive integer')
    }
    const rows = this.db
      .prepare(
        'SELECT * FROM village_snapshots WHERE village_id = ? ORDER BY captured_at DESC, id DESC LIMIT ?'
      )
      .all(villageId, limit) as SnapshotRow[]
    return rows.map(mapRow)
  }
}

export function createSnapshotRepository(
  db: Database.Database,
  state: SnapshotRepositoryDependencies
): SnapshotRepository {
  return new SnapshotRepository(db, state)
}

function mapRow(row: SnapshotRow): VillageSnapshot {
  return {
    id: row.id,
    villageId: row.village_id,
    capturedAt: new Date(row.captured_at),
    source: parseStateSource(row.source),
    dataVersion: row.data_version,
    schemaVersion: row.schema_version,
    // Parsed fresh on every read, so callers can never mutate stored data.
    payload: JSON.parse(row.payload) as VillageSnapshotPayload,
    createdAt: new Date(row.created_at)
  }
}
