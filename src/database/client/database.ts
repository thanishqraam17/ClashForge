import Database from 'better-sqlite3'
import { mkdirSync } from 'fs'
import { dirname } from 'path'
import { createVillageRepository, type VillageRepository } from '../repositories/village-repository'
import { runMigrations } from '../schema/migrate'

export type CreateDatabaseOptions = {
  dbPath: string
}

export type ClashForgeDatabase = {
  readonly dbPath: string
  readonly villages: VillageRepository
  healthCheck: () => void
  close: () => void
}

function enableForeignKeys(db: Database.Database): void {
  db.pragma('foreign_keys = ON')
}

export function createDatabase(options: CreateDatabaseOptions): ClashForgeDatabase {
  mkdirSync(dirname(options.dbPath), { recursive: true })

  const db = new Database(options.dbPath)
  enableForeignKeys(db)
  runMigrations(db)

  const villages = createVillageRepository(db)

  return {
    dbPath: options.dbPath,
    villages,
    healthCheck(): void {
      db.prepare('SELECT 1 AS ok').get()
    },
    close(): void {
      db.close()
    }
  }
}
