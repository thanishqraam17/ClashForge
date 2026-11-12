import { mkdirSync, rmSync } from 'fs'
import { dirname } from 'path'
import { createDatabase, type ClashForgeDatabase } from '../../database/client/database'
import { parseGameCatalogue } from '../../domain/catalogue-validation'
import { parseTownHallRules } from '../../domain/town-hall-rules-validation'
import { LOCAL_VILLAGE_ID } from '../../domain/village'
import { manualProvenance } from '../../domain/village-state'
import type { BundledGameData } from '../../game-data'
import { SAMPLE_ITEMS, SAMPLE_MANIFEST } from '../../game-data/fixtures/sample-catalogue'
import { SAMPLE_TOWN_HALL_RULES } from '../../game-data/fixtures/sample-town-hall-rules'
import { createTownHallService } from '../../services/town-hall-service'
import { createVillageStateService } from '../../services/village-state-service'
import { resolveSampleDatabasePath } from './sample-mode'

/**
 * DEVELOPMENT ONLY. Loaded with a dynamic import behind the sample-mode build
 * check, so production builds never include it or the fixtures below.
 *
 * Deletes and recreates the sample database, then seeds a synthetic Town Hall 6
 * village. Only the sample path is ever opened; it never reads, copies or
 * migrates the real database. Any failure is thrown for the caller to abort on.
 */
export function openSampleVillage(
  userDataPath: string,
  bundled: Pick<BundledGameData, 'assets' | 'exportSemantics'>
): { database: ClashForgeDatabase; dbPath: string; gameData: BundledGameData } {
  const dbPath = resolveSampleDatabasePath(userDataPath)
  mkdirSync(dirname(dbPath), { recursive: true })
  for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(dbPath + suffix, { force: true })

  const catalogue = parseGameCatalogue(SAMPLE_MANIFEST, SAMPLE_ITEMS)
  const townHallRules = parseTownHallRules(SAMPLE_TOWN_HALL_RULES, catalogue)
  // Real artwork does not describe sample items, so no assets are offered.
  const gameData: BundledGameData = {
    catalogue,
    townHallRules,
    assets: { ...bundled.assets, assets: [] },
    exportSemantics: bundled.exportSemantics
  }

  const database = createDatabase({ dbPath })
  try {
    seedSampleVillage(database, gameData)
  } catch (error) {
    database.close()
    throw error
  }
  return { database, dbPath, gameData }
}

function seedSampleVillage(database: ClashForgeDatabase, gameData: BundledGameData): void {
  const townHall = createTownHallService(gameData.catalogue, gameData.townHallRules)
  const villageState = createVillageStateService({ database, catalogue: gameData.catalogue, townHall })
  const provenance = manualProvenance()
  database.transaction(() => {
    database.villages.upsertVillage({
      townHallLevel: 6,
      gold: 120_000,
      elixir: 95_000,
      darkElixir: 0,
      goldCapacity: 300_000,
      elixirCapacity: 300_000,
      darkElixirCapacity: 0,
      lastScannedAt: null,
      ...provenance
    })
    const [first] = villageState.setBuilderCount(2)
    const idle = { upgradeStartedAt: null, upgradeEndsAt: null, builderId: null, targetLevel: null }
    villageState.saveItemInstance({ itemId: 'test-cannon', instanceNumber: 1, level: 3, ...idle })
    villageState.saveItemInstance({
      itemId: 'test-cannon',
      instanceNumber: 2,
      level: 3,
      targetLevel: 4,
      upgradeStartedAt: null,
      upgradeEndsAt: new Date(Date.now() + 26 * 3_600_000),
      builderId: first!.id
    })
    // An imported upgrade whose builder is unknown, so availability is uncertain.
    database.villageItems.create({
      villageId: LOCAL_VILLAGE_ID,
      itemId: 'test-cannon',
      instanceNumber: 3,
      level: 2,
      targetLevel: 3,
      upgradeStartedAt: null,
      upgradeEndsAt: null,
      builderId: null,
      builderAssignment: 'unknown',
      upgradeObservedTimer: 7_200,
      upgradeObservedAt: new Date(),
      source: 'data-export',
      confidence: 0.9,
      confirmedAt: null
    })
    villageState.saveItemInstance({ itemId: 'test-mortar', instanceNumber: 1, level: 2, ...idle })
    villageState.saveItemInstance({ itemId: 'test-gold-mine', instanceNumber: 1, level: 5, ...idle })
    villageState.saveResearch({
      itemId: 'test-archer',
      level: 2,
      targetLevel: null,
      researchStartedAt: null,
      researchEndsAt: null
    })
  })
}
