import type Database from 'better-sqlite3'
import {
  validateVillageItemInput,
  VillageStateValidationError,
  type VillageItemInstance,
  type VillageItemPersistInput
} from '../../domain/village-state'
import { dateOrNull, isoOrNull, parseStateSource } from './provenance'

type VillageItemRow = {
  id: number
  village_id: number
  item_id: string
  instance_number: number
  level: number
  target_level: number | null
  upgrade_started_at: string | null
  upgrade_ends_at: string | null
  builder_id: number | null
  source: string
  confidence: number
  confirmed_at: string | null
  created_at: string
  updated_at: string
}

const ORDER = 'ORDER BY item_id, instance_number'

function toParams(input: VillageItemPersistInput) {
  return {
    villageId: input.villageId,
    itemId: input.itemId,
    instanceNumber: input.instanceNumber,
    level: input.level,
    targetLevel: input.targetLevel,
    upgradeStartedAt: isoOrNull(input.upgradeStartedAt),
    upgradeEndsAt: isoOrNull(input.upgradeEndsAt),
    builderId: input.builderId,
    source: input.source,
    confidence: input.confidence,
    confirmedAt: isoOrNull(input.confirmedAt)
  }
}

/** Persistence for individual item instances. Business rules live in the village state service. */
export class VillageItemRepository {
  constructor(private readonly db: Database.Database) {}

  listByVillage(villageId: number): VillageItemInstance[] {
    const rows = this.db
      .prepare(`SELECT * FROM village_items WHERE village_id = ? ${ORDER}`)
      .all(villageId) as VillageItemRow[]
    return rows.map(mapRow)
  }

  listByItem(villageId: number, itemId: string): VillageItemInstance[] {
    const rows = this.db
      .prepare(`SELECT * FROM village_items WHERE village_id = ? AND item_id = ? ${ORDER}`)
      .all(villageId, itemId) as VillageItemRow[]
    return rows.map(mapRow)
  }

  getById(id: number): VillageItemInstance | null {
    const row = this.db.prepare('SELECT * FROM village_items WHERE id = ?').get(id) as
      | VillageItemRow
      | undefined
    return row ? mapRow(row) : null
  }

  getByBuilder(builderId: number): VillageItemInstance | null {
    const row = this.db
      .prepare('SELECT * FROM village_items WHERE builder_id = ?')
      .get(builderId) as VillageItemRow | undefined
    return row ? mapRow(row) : null
  }

  create(input: VillageItemPersistInput): VillageItemInstance {
    validateVillageItemInput(input)
    const now = new Date().toISOString()
    const result = this.db
      .prepare(
        `INSERT INTO village_items (
          village_id, item_id, instance_number, level, target_level,
          upgrade_started_at, upgrade_ends_at, builder_id,
          source, confidence, confirmed_at, created_at, updated_at
        ) VALUES (
          @villageId, @itemId, @instanceNumber, @level, @targetLevel,
          @upgradeStartedAt, @upgradeEndsAt, @builderId,
          @source, @confidence, @confirmedAt, @now, @now
        )`
      )
      .run({ ...toParams(input), now })
    return this.getById(Number(result.lastInsertRowid))!
  }

  update(instance: VillageItemInstance): VillageItemInstance {
    validateVillageItemInput(instance)
    const existing = this.getById(instance.id)
    if (existing === null) {
      throw new VillageStateValidationError(`Item instance ${instance.id} does not exist`)
    }
    if (existing.villageId !== instance.villageId) {
      throw new VillageStateValidationError('An item instance cannot move between villages')
    }
    this.db
      .prepare(
        `UPDATE village_items SET
          item_id = @itemId,
          instance_number = @instanceNumber,
          level = @level,
          target_level = @targetLevel,
          upgrade_started_at = @upgradeStartedAt,
          upgrade_ends_at = @upgradeEndsAt,
          builder_id = @builderId,
          source = @source,
          confidence = @confidence,
          confirmed_at = @confirmedAt,
          updated_at = @updatedAt
        WHERE id = @id`
      )
      .run({ ...toParams(instance), id: instance.id, updatedAt: new Date().toISOString() })
    return this.getById(instance.id)!
  }

  delete(id: number): boolean {
    return this.db.prepare('DELETE FROM village_items WHERE id = ?').run(id).changes > 0
  }
}

export function createVillageItemRepository(db: Database.Database): VillageItemRepository {
  return new VillageItemRepository(db)
}

function mapRow(row: VillageItemRow): VillageItemInstance {
  return {
    id: row.id,
    villageId: row.village_id,
    itemId: row.item_id,
    instanceNumber: row.instance_number,
    level: row.level,
    targetLevel: row.target_level,
    upgradeStartedAt: dateOrNull(row.upgrade_started_at),
    upgradeEndsAt: dateOrNull(row.upgrade_ends_at),
    builderId: row.builder_id,
    source: parseStateSource(row.source),
    confidence: row.confidence,
    confirmedAt: dateOrNull(row.confirmed_at),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at)
  }
}
