import type Database from 'better-sqlite3'
import migration001 from '../migrations/001_initial.sql?raw'
import migration002 from '../migrations/002_upgrade_history_nullable_completed_at.sql?raw'

/**
 * Timestamps: ISO 8601 UTC strings (e.g. 2026-09-14T10:30:00.000Z), stored as TEXT.
 * Parse with `new Date(value)` when needed; write with `date.toISOString()`.
 */

const MIGRATIONS: ReadonlyArray<{ version: number; sql: string }> = [
  { version: 1, sql: migration001 },
  { version: 2, sql: migration002 }
]

function readAppliedVersion(db: Database.Database): number {
  const table = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_version'"
    )
    .get() as { name: string } | undefined

  if (!table) {
    return 0
  }

  const row = db.prepare('SELECT version FROM schema_version LIMIT 1').get() as
    | { version: number }
    | undefined

  return row?.version ?? 0
}

function writeAppliedVersion(db: Database.Database, version: number): void {
  db.prepare('DELETE FROM schema_version').run()
  db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(version)
}

function ensureSchemaVersionTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER NOT NULL
    );
  `)
}

export function runMigrations(db: Database.Database): void {
  ensureSchemaVersionTable(db)
  const applied = readAppliedVersion(db)

  const pending = MIGRATIONS.filter((m) => m.version > applied).sort(
    (a, b) => a.version - b.version
  )

  for (const migration of pending) {
    const apply = db.transaction(() => {
      db.exec(migration.sql)
      writeAppliedVersion(db, migration.version)
    })
    apply()
  }
}
