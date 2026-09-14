import Database from 'better-sqlite3'
import { mkdirSync } from 'fs'
import { dirname } from 'path'
import { createBuildingRepository, type BuildingRepository } from '../repositories/building-repository'
import { createHeroRepository, type HeroRepository } from '../repositories/hero-repository'
import { createResearchRepository, type ResearchRepository } from '../repositories/research-repository'
import {
  createUpgradeHistoryRepository,
  type UpgradeHistoryRepository
} from '../repositories/upgrade-history-repository'
import { createVillageRepository, type VillageRepository } from '../repositories/village-repository'
import { runMigrations } from '../schema/migrate'

export type CreateDatabaseOptions = {
  dbPath: string
}

export type ClashForgeDatabase = {
  readonly dbPath: string
  readonly villages: VillageRepository
  readonly buildings: BuildingRepository
  readonly heroes: HeroRepository
  readonly research: ResearchRepository
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
  const buildings = createBuildingRepository(db)
  const heroes = createHeroRepository(db)
  const research = createResearchRepository(db)
  const upgradeHistory = createUpgradeHistoryRepository(db)

  return {
    dbPath: options.dbPath,
    villages,
    buildings,
    heroes,
    research,
    upgradeHistory,
    healthCheck(): void {
      db.prepare('SELECT 1 AS ok').get()
    },
    close(): void {
      db.close()
    }
  }
}
