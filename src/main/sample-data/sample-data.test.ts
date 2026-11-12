import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveProductionDatabasePath } from '../../database/client/database-path'
import { LOCAL_VILLAGE_ID } from '../../domain/village'
import { loadBundledGameData } from '../../game-data'
import { createTownHallService } from '../../services/town-hall-service'
import { createVillageStateService } from '../../services/village-state-service'
import { isSampleModeRequested, resolveSampleDatabasePath } from './sample-mode'
import { openSampleVillage } from './sample-seed'

describe('sample-data mode', () => {
  it('is requested only by an unpackaged development build in sample mode', () => {
    expect(isSampleModeRequested({ devBuild: true, mode: 'sample', isPackaged: false })).toBe(true)
    expect(isSampleModeRequested({ devBuild: true, mode: 'sample', isPackaged: true })).toBe(false)
    expect(isSampleModeRequested({ devBuild: false, mode: 'sample', isPackaged: false })).toBe(false)
    expect(isSampleModeRequested({ devBuild: false, mode: 'sample', isPackaged: true })).toBe(false)
    expect(isSampleModeRequested({ devBuild: true, mode: 'development', isPackaged: false })).toBe(false)
    expect(isSampleModeRequested({ devBuild: true, mode: 'production', isPackaged: false })).toBe(false)
  })

  it('uses a separate database path', () => {
    const userData = join(tmpdir(), 'clashforge-user-data')
    const sample = resolveSampleDatabasePath(userData)
    expect(sample).toBe(join(userData, 'sample-data', 'clashforge-sample.db'))
    expect(sample).not.toBe(resolveProductionDatabasePath(userData))
  })

  describe('seeding', () => {
    let userData: string
    const bundled = loadBundledGameData()

    beforeEach(() => {
      userData = mkdtempSync(join(tmpdir(), 'clashforge-sample-'))
    })
    afterEach(() => rmSync(userData, { recursive: true, force: true }))

    it('creates only the sample database and seeds a synthetic village', () => {
      const { database, dbPath, gameData } = openSampleVillage(userData, bundled)
      try {
        expect(dbPath).toBe(resolveSampleDatabasePath(userData))
        expect(existsSync(resolveProductionDatabasePath(userData))).toBe(false)
        expect(readdirSync(userData)).toEqual(['sample-data'])

        expect(gameData.catalogue.items.some((i) => i.id === 'test-cannon')).toBe(true)
        expect(gameData.assets.assets).toEqual([])
        const townHall = createTownHallService(gameData.catalogue, gameData.townHallRules)
        const state = createVillageStateService({ database, catalogue: gameData.catalogue, townHall }).getState()!
        expect(state.village.townHallLevel).toBe(6)
        expect(state.coverage.canRecordItems).toBe(true)
        expect(state.builders).toHaveLength(2)
        expect(state.items.map((i) => [i.itemId, i.instanceNumber, i.builderAssignment])).toEqual(
          expect.arrayContaining([
            ['test-cannon', 2, 'confirmed'],
            ['test-cannon', 3, 'unknown']
          ])
        )
        expect(state.builderAvailability.isConfirmed).toBe(false)
        expect(state.research.map((r) => r.itemId)).toEqual(['test-archer'])
      } finally {
        database.close()
      }
    })

    it('recreates the sample database on every launch, discarding earlier changes', () => {
      const first = openSampleVillage(userData, bundled)
      first.database.villageItems.delete(first.database.villageItems.listByVillage(LOCAL_VILLAGE_ID)[0]!.id)
      const changedCount = first.database.villageItems.listByVillage(LOCAL_VILLAGE_ID).length
      first.database.close()

      const second = openSampleVillage(userData, bundled)
      try {
        expect(second.database.villageItems.listByVillage(LOCAL_VILLAGE_ID)).toHaveLength(changedCount + 1)
        expect(existsSync(resolveProductionDatabasePath(userData))).toBe(false)
      } finally {
        second.database.close()
      }
    })

    it('throws instead of opening anything else when preparation fails', () => {
      // A file where the sample directory should be makes preparation fail.
      writeFileSync(join(userData, 'sample-data'), 'not a directory')
      try {
        expect(() => openSampleVillage(userData, bundled)).toThrow()
        expect(existsSync(resolveProductionDatabasePath(userData))).toBe(false)
      } finally {
        expect(readdirSync(userData)).toEqual(['sample-data'])
      }
    })
  })
})
