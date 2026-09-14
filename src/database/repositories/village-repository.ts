import type Database from 'better-sqlite3'
import {
  LOCAL_VILLAGE_ID,
  validateVillagePersistInput,
  type Village,
  type VillagePersistInput,
  VillageValidationError
} from '../../domain/village'

type VillageRow = {
  id: number
  town_hall_level: number
  gold: number
  elixir: number
  dark_elixir: number
  gold_capacity: number
  elixir_capacity: number
  dark_elixir_capacity: number
  builder_count: number
  available_builders: number
  last_scanned_at: string | null
  created_at: string
  updated_at: string
}

export class VillageRepository {
  constructor(private readonly db: Database.Database) {}

  getVillage(): Village | null {
    const row = this.db
      .prepare('SELECT * FROM villages WHERE id = ?')
      .get(LOCAL_VILLAGE_ID) as VillageRow | undefined
    return row ? mapRowToVillage(row) : null
  }

  createVillage(input: VillagePersistInput): Village {
    validateVillagePersistInput(input)
    if (this.getVillage() !== null) {
      throw new VillageValidationError('Village already exists')
    }

    const now = new Date().toISOString()
    this.db
      .prepare(
        `INSERT INTO villages (
          id, town_hall_level, gold, elixir, dark_elixir,
          gold_capacity, elixir_capacity, dark_elixir_capacity,
          builder_count, available_builders, last_scanned_at,
          created_at, updated_at
        ) VALUES (
          @id, @townHallLevel, @gold, @elixir, @darkElixir,
          @goldCapacity, @elixirCapacity, @darkElixirCapacity,
          @builderCount, @availableBuilders, @lastScannedAt,
          @createdAt, @updatedAt
        )`
      )
      .run({
        id: LOCAL_VILLAGE_ID,
        townHallLevel: input.townHallLevel,
        gold: input.gold,
        elixir: input.elixir,
        darkElixir: input.darkElixir,
        goldCapacity: input.goldCapacity,
        elixirCapacity: input.elixirCapacity,
        darkElixirCapacity: input.darkElixirCapacity,
        builderCount: input.builderCount,
        availableBuilders: input.availableBuilders,
        lastScannedAt: input.lastScannedAt?.toISOString() ?? null,
        createdAt: now,
        updatedAt: now
      })

    return this.getVillage()!
  }

  updateVillage(village: Village): Village {
    if (village.id !== LOCAL_VILLAGE_ID) {
      throw new VillageValidationError('Only the local village (id 1) can be updated')
    }
    validateVillagePersistInput(village)
    if (this.getVillage() === null) {
      throw new VillageValidationError('Village does not exist')
    }

    const updatedAt = new Date().toISOString()
    this.db
      .prepare(
        `UPDATE villages SET
          town_hall_level = @townHallLevel,
          gold = @gold,
          elixir = @elixir,
          dark_elixir = @darkElixir,
          gold_capacity = @goldCapacity,
          elixir_capacity = @elixirCapacity,
          dark_elixir_capacity = @darkElixirCapacity,
          builder_count = @builderCount,
          available_builders = @availableBuilders,
          last_scanned_at = @lastScannedAt,
          updated_at = @updatedAt
        WHERE id = @id`
      )
      .run({
        id: LOCAL_VILLAGE_ID,
        townHallLevel: village.townHallLevel,
        gold: village.gold,
        elixir: village.elixir,
        darkElixir: village.darkElixir,
        goldCapacity: village.goldCapacity,
        elixirCapacity: village.elixirCapacity,
        darkElixirCapacity: village.darkElixirCapacity,
        builderCount: village.builderCount,
        availableBuilders: village.availableBuilders,
        lastScannedAt: village.lastScannedAt?.toISOString() ?? null,
        updatedAt
      })

    return this.getVillage()!
  }

  upsertVillage(input: VillagePersistInput): Village {
    validateVillagePersistInput(input)
    const existing = this.getVillage()
    if (existing === null) {
      return this.createVillage(input)
    }

    return this.updateVillage({
      ...existing,
      ...input,
      id: LOCAL_VILLAGE_ID
    })
  }
}

export function createVillageRepository(db: Database.Database): VillageRepository {
  return new VillageRepository(db)
}

function mapRowToVillage(row: VillageRow): Village {
  return {
    id: row.id,
    townHallLevel: row.town_hall_level,
    gold: row.gold,
    elixir: row.elixir,
    darkElixir: row.dark_elixir,
    goldCapacity: row.gold_capacity,
    elixirCapacity: row.elixir_capacity,
    darkElixirCapacity: row.dark_elixir_capacity,
    builderCount: row.builder_count,
    availableBuilders: row.available_builders,
    lastScannedAt: row.last_scanned_at ? new Date(row.last_scanned_at) : null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at)
  }
}
