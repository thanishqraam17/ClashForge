import type Database from 'better-sqlite3'
import {
  validateHeroPersistInput,
  type Hero,
  type HeroPersistInput,
  HeroValidationError
} from '../../domain/hero'

type HeroRow = {
  id: number
  village_id: number
  name: string
  level: number
  is_upgrading: number
  upgrade_started_at: string | null
  upgrade_ends_at: string | null
  created_at: string
  updated_at: string
}

export class HeroRepository {
  constructor(private readonly db: Database.Database) {}

  getByVillageId(villageId: number): Hero[] {
    if (villageId < 1) {
      throw new HeroValidationError('villageId must be at least 1')
    }
    const rows = this.db
      .prepare('SELECT * FROM heroes WHERE village_id = ? ORDER BY id')
      .all(villageId) as HeroRow[]
    return rows.map(mapRowToHero)
  }

  getById(id: number): Hero | null {
    if (id < 1) {
      throw new HeroValidationError('id must be at least 1')
    }
    const row = this.db.prepare('SELECT * FROM heroes WHERE id = ?').get(id) as
      | HeroRow
      | undefined
    return row ? mapRowToHero(row) : null
  }

  create(input: HeroPersistInput): Hero {
    validateHeroPersistInput(input)
    const now = new Date().toISOString()

    const result = this.db
      .prepare(
        `INSERT INTO heroes (
          village_id, name, level, is_upgrading,
          upgrade_started_at, upgrade_ends_at, created_at, updated_at
        ) VALUES (
          @villageId, @name, @level, @isUpgrading,
          @upgradeStartedAt, @upgradeEndsAt, @createdAt, @updatedAt
        )`
      )
      .run({
        villageId: input.villageId,
        name: input.name,
        level: input.level,
        isUpgrading: input.isUpgrading ? 1 : 0,
        upgradeStartedAt: input.upgradeStartedAt?.toISOString() ?? null,
        upgradeEndsAt: input.upgradeEndsAt?.toISOString() ?? null,
        createdAt: now,
        updatedAt: now
      })

    return this.getById(Number(result.lastInsertRowid))!
  }

  update(entity: Hero): Hero {
    if (entity.id < 1) {
      throw new HeroValidationError('id must be at least 1')
    }
    validateHeroPersistInput(entity)
    if (this.getById(entity.id) === null) {
      throw new HeroValidationError('Hero does not exist')
    }

    const updatedAt = new Date().toISOString()
    this.db
      .prepare(
        `UPDATE heroes SET
          village_id = @villageId,
          name = @name,
          level = @level,
          is_upgrading = @isUpgrading,
          upgrade_started_at = @upgradeStartedAt,
          upgrade_ends_at = @upgradeEndsAt,
          updated_at = @updatedAt
        WHERE id = @id`
      )
      .run({
        id: entity.id,
        villageId: entity.villageId,
        name: entity.name,
        level: entity.level,
        isUpgrading: entity.isUpgrading ? 1 : 0,
        upgradeStartedAt: entity.upgradeStartedAt?.toISOString() ?? null,
        upgradeEndsAt: entity.upgradeEndsAt?.toISOString() ?? null,
        updatedAt
      })

    return this.getById(entity.id)!
  }

  upsert(entity: Hero): Hero {
    validateHeroPersistInput(entity)
    if (entity.id > 0) {
      const existing = this.getById(entity.id)
      if (existing) {
        return this.update(entity)
      }
    }
    return this.create(entity)
  }
}

export function createHeroRepository(db: Database.Database): HeroRepository {
  return new HeroRepository(db)
}

function mapRowToHero(row: HeroRow): Hero {
  return {
    id: row.id,
    villageId: row.village_id,
    name: row.name,
    level: row.level,
    isUpgrading: row.is_upgrading === 1,
    upgradeStartedAt: row.upgrade_started_at ? new Date(row.upgrade_started_at) : null,
    upgradeEndsAt: row.upgrade_ends_at ? new Date(row.upgrade_ends_at) : null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at)
  }
}
