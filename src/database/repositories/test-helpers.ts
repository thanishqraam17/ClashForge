import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { manualProvenance } from '../../domain/village-state'
import { createDatabase, type ClashForgeDatabase } from '../client/database'
import { runMigrations } from '../schema/migrate'

export const TEST_CONFIRMED = manualProvenance(new Date('2026-11-12T10:00:00.000Z'))

export type TestDatabase = {
  database: ClashForgeDatabase
  dbPath: string
  cleanup: () => void
}

/** Fresh migrated database in a temp directory, optionally with the local village. */
export function createTestDatabase(options: { withVillage?: boolean } = {}): TestDatabase {
  const dir = mkdtempSync(join(tmpdir(), 'clashforge-test-'))
  const dbPath = join(dir, 'test.db')
  const database = createDatabase({ dbPath })
  if (options.withVillage) {
    database.villages.createVillage({
      townHallLevel: 5,
      gold: 0,
      elixir: 0,
      darkElixir: 0,
      goldCapacity: 0,
      elixirCapacity: 0,
      darkElixirCapacity: 0,
      lastScannedAt: null,
      ...TEST_CONFIRMED
    })
  }
  return {
    database,
    dbPath,
    cleanup() {
      try {
        database.close()
      } catch {
        // already closed by the test
      }
      rmSync(dir, { recursive: true, force: true })
    }
  }
}

const T0 = '2026-09-14T10:00:00.000Z'

/**
 * Writes a schema-v2 village (Town Hall 5, two builders) with legacy free-text
 * rows, then migrates to the current schema. Names match the sample catalogue
 * fixture where noted.
 */
export function seedLegacyDatabase(db: Database.Database): void {
  runMigrations(db, { upTo: 2 })
  db.prepare(
    `INSERT INTO villages (id, town_hall_level, builder_count, available_builders, created_at, updated_at)
     VALUES (1, 5, 2, 2, ?, ?)`
  ).run(T0, T0)
  db.prepare(
    `INSERT INTO buildings (village_id, name, category, level, quantity, is_upgrading,
      upgrade_started_at, upgrade_ends_at, created_at, updated_at)
     VALUES (1, 'Test Cannon', 'DEFENSE', 3, 2, 0, NULL, NULL, ?, ?),
            (1, 'Mystery Tower', 'DEFENSE', 1, 1, 1, NULL, '2026-09-15T00:00:00.000Z', ?, ?)`
  ).run(T0, T0, T0, T0)
  db.prepare(
    `INSERT INTO heroes (village_id, name, level, is_upgrading, created_at, updated_at)
     VALUES (1, 'Test Knight', 4, 0, ?, ?)`
  ).run(T0, T0)
  db.prepare(
    `INSERT INTO research (village_id, name, level, category, is_researching, research_ends_at, created_at, updated_at)
     VALUES (1, 'Test Archer', 2, 'TROOP', 1, '2026-09-20T00:00:00.000Z', ?, ?)`
  ).run(T0, T0)
  runMigrations(db)
}

/** Test database whose contents went through migration 003 from legacy data. */
export function createLegacyTestDatabase(): TestDatabase {
  const dir = mkdtempSync(join(tmpdir(), 'clashforge-legacy-'))
  const dbPath = join(dir, 'test.db')
  const raw = new Database(dbPath)
  raw.pragma('foreign_keys = ON')
  seedLegacyDatabase(raw)
  raw.close()
  const database = createDatabase({ dbPath })
  return {
    database,
    dbPath,
    cleanup() {
      try {
        database.close()
      } catch {
        // already closed by the test
      }
      rmSync(dir, { recursive: true, force: true })
    }
  }
}
