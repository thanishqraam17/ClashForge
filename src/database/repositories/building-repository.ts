import type Database from 'better-sqlite3'
import {
  validateBuildingPersistInput,
  type Building,
  type BuildingPersistInput,
  BuildingValidationError
} from '../../domain/building'

type BuildingRow = {
  id: number
  village_id: number
  name: string
  category: string
  level: number
  quantity: number
  is_upgrading: number
  upgrade_started_at: string | null
  upgrade_ends_at: string | null
  created_at: string
  updated_at: string
}

export class BuildingRepository {
  constructor(private readonly db: Database.Database) {}

  getByVillageId(villageId: number): Building[] {
    if (villageId < 1) {
      throw new BuildingValidationError('villageId must be at least 1')
    }
    const rows = this.db
      .prepare('SELECT * FROM buildings WHERE village_id = ? ORDER BY id')
      .all(villageId) as BuildingRow[]
    return rows.map(mapRowToBuilding)
  }

  getById(id: number): Building | null {
    if (id < 1) {
      throw new BuildingValidationError('id must be at least 1')
    }
    const row = this.db.prepare('SELECT * FROM buildings WHERE id = ?').get(id) as
      | BuildingRow
      | undefined
    return row ? mapRowToBuilding(row) : null
  }

  create(input: BuildingPersistInput): Building {
    validateBuildingPersistInput(input)
    const now = new Date().toISOString()

    const result = this.db
      .prepare(
        `INSERT INTO buildings (
          village_id, name, category, level, quantity, is_upgrading,
          upgrade_started_at, upgrade_ends_at, created_at, updated_at
        ) VALUES (
          @villageId, @name, @category, @level, @quantity, @isUpgrading,
          @upgradeStartedAt, @upgradeEndsAt, @createdAt, @updatedAt
        )`
      )
      .run({
        villageId: input.villageId,
        name: input.name,
        category: input.category,
        level: input.level,
        quantity: input.quantity,
        isUpgrading: input.isUpgrading ? 1 : 0,
        upgradeStartedAt: input.upgradeStartedAt?.toISOString() ?? null,
        upgradeEndsAt: input.upgradeEndsAt?.toISOString() ?? null,
        createdAt: now,
        updatedAt: now
      })

    return this.getById(Number(result.lastInsertRowid))!
  }

  update(entity: Building): Building {
    if (entity.id < 1) {
      throw new BuildingValidationError('id must be at least 1')
    }
    validateBuildingPersistInput(entity)
    if (this.getById(entity.id) === null) {
      throw new BuildingValidationError('Building does not exist')
    }

    const updatedAt = new Date().toISOString()
    this.db
      .prepare(
        `UPDATE buildings SET
          village_id = @villageId,
          name = @name,
          category = @category,
          level = @level,
          quantity = @quantity,
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
        category: entity.category,
        level: entity.level,
        quantity: entity.quantity,
        isUpgrading: entity.isUpgrading ? 1 : 0,
        upgradeStartedAt: entity.upgradeStartedAt?.toISOString() ?? null,
        upgradeEndsAt: entity.upgradeEndsAt?.toISOString() ?? null,
        updatedAt
      })

    return this.getById(entity.id)!
  }

  upsert(entity: Building): Building {
    validateBuildingPersistInput(entity)
    if (entity.id > 0) {
      const existing = this.getById(entity.id)
      if (existing) {
        return this.update(entity)
      }
    }
    return this.create(entity)
  }
}

export function createBuildingRepository(db: Database.Database): BuildingRepository {
  return new BuildingRepository(db)
}

function mapRowToBuilding(row: BuildingRow): Building {
  return {
    id: row.id,
    villageId: row.village_id,
    name: row.name,
    category: row.category,
    level: row.level,
    quantity: row.quantity,
    isUpgrading: row.is_upgrading === 1,
    upgradeStartedAt: row.upgrade_started_at ? new Date(row.upgrade_started_at) : null,
    upgradeEndsAt: row.upgrade_ends_at ? new Date(row.upgrade_ends_at) : null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at)
  }
}
