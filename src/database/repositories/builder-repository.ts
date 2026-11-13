import type Database from 'better-sqlite3'
import {
  validateBuilderInput,
  VillageStateValidationError,
  type Builder,
  type BuilderKind,
  type BuilderPersistInput
} from '../../domain/village-state'
import { dateOrNull, isoOrNull, parseStateSource } from './provenance'

type BuilderRow = {
  id: number
  village_id: number
  slot: number
  kind: BuilderKind
  source: string
  confidence: number
  confirmed_at: string | null
  created_at: string
  updated_at: string
}

export class BuilderRepository {
  constructor(private readonly db: Database.Database) {}

  listByVillage(villageId: number): Builder[] {
    const rows = this.db
      .prepare('SELECT * FROM builders WHERE village_id = ? ORDER BY slot')
      .all(villageId) as BuilderRow[]
    return rows.map(mapRow)
  }

  /** Rows of one kind, oldest first — the order reclassification consumes legacy rows in. */
  listByVillageAndKind(villageId: number, kind: BuilderKind): Builder[] {
    const rows = this.db
      .prepare('SELECT * FROM builders WHERE village_id = ? AND kind = ? ORDER BY created_at, slot')
      .all(villageId, kind) as BuilderRow[]
    return rows.map(mapRow)
  }

  getById(id: number): Builder | null {
    const row = this.db.prepare('SELECT * FROM builders WHERE id = ?').get(id) as
      | BuilderRow
      | undefined
    return row ? mapRow(row) : null
  }

  create(input: BuilderPersistInput): Builder {
    validateBuilderInput(input)
    const now = new Date().toISOString()
    const result = this.db
      .prepare(
        `INSERT INTO builders (village_id, slot, kind, source, confidence, confirmed_at, created_at, updated_at)
         VALUES (@villageId, @slot, @kind, @source, @confidence, @confirmedAt, @now, @now)`
      )
      .run({
        villageId: input.villageId,
        slot: input.slot,
        kind: input.kind,
        source: input.source,
        confidence: input.confidence,
        confirmedAt: isoOrNull(input.confirmedAt),
        now
      })
    return this.getById(Number(result.lastInsertRowid))!
  }

  update(builder: Builder): Builder {
    validateBuilderInput(builder)
    const existing = this.getById(builder.id)
    if (existing === null) {
      throw new VillageStateValidationError(`Builder ${builder.id} does not exist`)
    }
    if (existing.villageId !== builder.villageId) {
      throw new VillageStateValidationError('A builder cannot move between villages')
    }
    this.db
      .prepare(
        `UPDATE builders SET slot = @slot, kind = @kind, source = @source, confidence = @confidence,
           confirmed_at = @confirmedAt, updated_at = @updatedAt
         WHERE id = @id`
      )
      .run({
        id: builder.id,
        slot: builder.slot,
        kind: builder.kind,
        source: builder.source,
        confidence: builder.confidence,
        confirmedAt: isoOrNull(builder.confirmedAt),
        updatedAt: new Date().toISOString()
      })
    return this.getById(builder.id)!
  }

  /** Relabels a builder's kind only. Never touches its assignment, slot or id. */
  relabel(id: number, kind: BuilderKind): Builder {
    const existing = this.getById(id)
    if (existing === null) {
      throw new VillageStateValidationError(`Builder ${id} does not exist`)
    }
    this.db
      .prepare('UPDATE builders SET kind = ?, updated_at = ? WHERE id = ?')
      .run(kind, new Date().toISOString(), id)
    return this.getById(id)!
  }

  /** Fails (foreign key) while the builder is assigned to an upgrade. */
  delete(id: number): boolean {
    return this.db.prepare('DELETE FROM builders WHERE id = ?').run(id).changes > 0
  }
}

export function createBuilderRepository(db: Database.Database): BuilderRepository {
  return new BuilderRepository(db)
}

function mapRow(row: BuilderRow): Builder {
  return {
    id: row.id,
    villageId: row.village_id,
    slot: row.slot,
    kind: row.kind,
    source: parseStateSource(row.source),
    confidence: row.confidence,
    confirmedAt: dateOrNull(row.confirmed_at),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at)
  }
}
