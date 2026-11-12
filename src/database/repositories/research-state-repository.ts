import type Database from 'better-sqlite3'
import {
  validateResearchStateInput,
  VillageStateValidationError,
  type ResearchState,
  type ResearchStatePersistInput
} from '../../domain/village-state'
import { dateOrNull, isoOrNull, parseStateSource } from './provenance'

type ResearchRow = {
  id: number
  village_id: number
  item_id: string
  level: number
  target_level: number | null
  research_started_at: string | null
  research_ends_at: string | null
  source: string
  confidence: number
  confirmed_at: string | null
  created_at: string
  updated_at: string
}

function toParams(input: ResearchStatePersistInput) {
  return {
    villageId: input.villageId,
    itemId: input.itemId,
    level: input.level,
    targetLevel: input.targetLevel,
    researchStartedAt: isoOrNull(input.researchStartedAt),
    researchEndsAt: isoOrNull(input.researchEndsAt),
    source: input.source,
    confidence: input.confidence,
    confirmedAt: isoOrNull(input.confirmedAt)
  }
}

/** Laboratory research levels, one row per researched item. */
export class ResearchStateRepository {
  constructor(private readonly db: Database.Database) {}

  listByVillage(villageId: number): ResearchState[] {
    const rows = this.db
      .prepare('SELECT * FROM research WHERE village_id = ? ORDER BY item_id')
      .all(villageId) as ResearchRow[]
    return rows.map(mapRow)
  }

  getById(id: number): ResearchState | null {
    const row = this.db.prepare('SELECT * FROM research WHERE id = ?').get(id) as
      | ResearchRow
      | undefined
    return row ? mapRow(row) : null
  }

  getByItem(villageId: number, itemId: string): ResearchState | null {
    const row = this.db
      .prepare('SELECT * FROM research WHERE village_id = ? AND item_id = ?')
      .get(villageId, itemId) as ResearchRow | undefined
    return row ? mapRow(row) : null
  }

  /** The research currently running in the Laboratory, if any. */
  getActive(villageId: number): ResearchState | null {
    const row = this.db
      .prepare('SELECT * FROM research WHERE village_id = ? AND target_level IS NOT NULL')
      .get(villageId) as ResearchRow | undefined
    return row ? mapRow(row) : null
  }

  create(input: ResearchStatePersistInput): ResearchState {
    validateResearchStateInput(input)
    const now = new Date().toISOString()
    const result = this.db
      .prepare(
        `INSERT INTO research (
          village_id, item_id, level, target_level, research_started_at, research_ends_at,
          source, confidence, confirmed_at, created_at, updated_at
        ) VALUES (
          @villageId, @itemId, @level, @targetLevel, @researchStartedAt, @researchEndsAt,
          @source, @confidence, @confirmedAt, @now, @now
        )`
      )
      .run({ ...toParams(input), now })
    return this.getById(Number(result.lastInsertRowid))!
  }

  update(research: ResearchState): ResearchState {
    validateResearchStateInput(research)
    const existing = this.getById(research.id)
    if (existing === null) {
      throw new VillageStateValidationError(`Research ${research.id} does not exist`)
    }
    if (existing.villageId !== research.villageId || existing.itemId !== research.itemId) {
      throw new VillageStateValidationError('Research cannot change village or item')
    }
    this.db
      .prepare(
        `UPDATE research SET
          level = @level,
          target_level = @targetLevel,
          research_started_at = @researchStartedAt,
          research_ends_at = @researchEndsAt,
          source = @source,
          confidence = @confidence,
          confirmed_at = @confirmedAt,
          updated_at = @updatedAt
        WHERE id = @id`
      )
      .run({ ...toParams(research), id: research.id, updatedAt: new Date().toISOString() })
    return this.getById(research.id)!
  }

  delete(id: number): boolean {
    return this.db.prepare('DELETE FROM research WHERE id = ?').run(id).changes > 0
  }
}

export function createResearchStateRepository(db: Database.Database): ResearchStateRepository {
  return new ResearchStateRepository(db)
}

function mapRow(row: ResearchRow): ResearchState {
  return {
    id: row.id,
    villageId: row.village_id,
    itemId: row.item_id,
    level: row.level,
    targetLevel: row.target_level,
    researchStartedAt: dateOrNull(row.research_started_at),
    researchEndsAt: dateOrNull(row.research_ends_at),
    source: parseStateSource(row.source),
    confidence: row.confidence,
    confirmedAt: dateOrNull(row.confirmed_at),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at)
  }
}
