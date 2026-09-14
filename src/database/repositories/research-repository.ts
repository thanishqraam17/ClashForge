import type Database from 'better-sqlite3'
import {
  validateResearchPersistInput,
  type Research,
  type ResearchPersistInput,
  ResearchValidationError
} from '../../domain/research'

type ResearchRow = {
  id: number
  village_id: number
  name: string
  level: number
  category: string
  is_researching: number
  research_started_at: string | null
  research_ends_at: string | null
  created_at: string
  updated_at: string
}

export class ResearchRepository {
  constructor(private readonly db: Database.Database) {}

  getByVillageId(villageId: number): Research[] {
    if (villageId < 1) {
      throw new ResearchValidationError('villageId must be at least 1')
    }
    const rows = this.db
      .prepare('SELECT * FROM research WHERE village_id = ? ORDER BY id')
      .all(villageId) as ResearchRow[]
    return rows.map(mapRowToResearch)
  }

  getById(id: number): Research | null {
    if (id < 1) {
      throw new ResearchValidationError('id must be at least 1')
    }
    const row = this.db.prepare('SELECT * FROM research WHERE id = ?').get(id) as
      | ResearchRow
      | undefined
    return row ? mapRowToResearch(row) : null
  }

  create(input: ResearchPersistInput): Research {
    validateResearchPersistInput(input)
    const now = new Date().toISOString()

    const result = this.db
      .prepare(
        `INSERT INTO research (
          village_id, name, level, category, is_researching,
          research_started_at, research_ends_at, created_at, updated_at
        ) VALUES (
          @villageId, @name, @level, @category, @isResearching,
          @researchStartedAt, @researchEndsAt, @createdAt, @updatedAt
        )`
      )
      .run({
        villageId: input.villageId,
        name: input.name,
        level: input.level,
        category: input.category,
        isResearching: input.isResearching ? 1 : 0,
        researchStartedAt: input.researchStartedAt?.toISOString() ?? null,
        researchEndsAt: input.researchEndsAt?.toISOString() ?? null,
        createdAt: now,
        updatedAt: now
      })

    return this.getById(Number(result.lastInsertRowid))!
  }

  update(entity: Research): Research {
    if (entity.id < 1) {
      throw new ResearchValidationError('id must be at least 1')
    }
    validateResearchPersistInput(entity)
    if (this.getById(entity.id) === null) {
      throw new ResearchValidationError('Research does not exist')
    }

    const updatedAt = new Date().toISOString()
    this.db
      .prepare(
        `UPDATE research SET
          village_id = @villageId,
          name = @name,
          level = @level,
          category = @category,
          is_researching = @isResearching,
          research_started_at = @researchStartedAt,
          research_ends_at = @researchEndsAt,
          updated_at = @updatedAt
        WHERE id = @id`
      )
      .run({
        id: entity.id,
        villageId: entity.villageId,
        name: entity.name,
        level: entity.level,
        category: entity.category,
        isResearching: entity.isResearching ? 1 : 0,
        researchStartedAt: entity.researchStartedAt?.toISOString() ?? null,
        researchEndsAt: entity.researchEndsAt?.toISOString() ?? null,
        updatedAt
      })

    return this.getById(entity.id)!
  }

  upsert(entity: Research): Research {
    validateResearchPersistInput(entity)
    if (entity.id > 0) {
      const existing = this.getById(entity.id)
      if (existing) {
        return this.update(entity)
      }
    }
    return this.create(entity)
  }
}

export function createResearchRepository(db: Database.Database): ResearchRepository {
  return new ResearchRepository(db)
}

function mapRowToResearch(row: ResearchRow): Research {
  return {
    id: row.id,
    villageId: row.village_id,
    name: row.name,
    level: row.level,
    category: row.category,
    isResearching: row.is_researching === 1,
    researchStartedAt: row.research_started_at ? new Date(row.research_started_at) : null,
    researchEndsAt: row.research_ends_at ? new Date(row.research_ends_at) : null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at)
  }
}
