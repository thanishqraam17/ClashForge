import Database from 'better-sqlite3'
import { mkdirSync } from 'fs'
import { dirname } from 'path'
import {
  createUpgradeHistoryRepository,
  type UpgradeHistoryRepository
} from '../repositories/upgrade-history-repository'
import {
  createVillageItemRepository,
  type VillageItemRepository
} from '../repositories/village-item-repository'
import { createVillageRepository, type VillageRepository } from '../repositories/village-repository'
import { runMigrations } from '../schema/migrate'
import {
  createResearchStateRepository,
  type ResearchStateRepository
} from '../repositories/research-state-repository'
import { createBuilderRepository, type BuilderRepository } from '../repositories/builder-repository'

export type CreateDatabaseOptions = {
  dbPath: string
}

export type ClashForgeDatabase = {
  readonly dbPath: string
  readonly villages: VillageRepository
  readonly villageItems: VillageItemRepository
  readonly builders: BuilderRepository
  readonly researchStates: ResearchStateRepository
  readonly upgradeHistory: UpgradeHistoryRepository
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
  const villageItems = createVillageItemRepository(db)
  const builders = createBuilderRepository(db)
  const researchStates = createResearchStateRepository(db)
  const upgradeHistory = createUpgradeHistoryRepository(db)

  return {
    dbPath: options.dbPath,
    villages,
    villageItems,
    builders,
    researchStates,
    upgradeHistory,
    healthCheck(): void {
      db.prepare('SELECT 1 AS ok').get()
    },
    close(): void {
      db.close()
    }
  }
}
