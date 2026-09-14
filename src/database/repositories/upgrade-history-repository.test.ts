import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { UpgradeHistoryValidationError } from '../../domain/upgrade-history'
import { LOCAL_VILLAGE_ID } from '../../domain/village'
import { createDatabase } from '../client/database'

function seedVillage(dbPath: string) {
  const database = createDatabase({ dbPath })
  database.villages.createVillage({
    townHallLevel: 9,
    gold: 0,
    elixir: 0,
    darkElixir: 0,
    goldCapacity: 0,
    elixirCapacity: 0,
    darkElixirCapacity: 0,
    builderCount: 4,
    availableBuilders: 4,
    lastScannedAt: null
  })
  return database
}

describe('UpgradeHistoryRepository', () => {
  it('records, retrieves, orders, limits, validates, and enforces FK', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clashforge-history-'))
    const dbPath = join(dir, 'test.db')

    try {
      const database = seedVillage(dbPath)
      const startedAt = new Date('2026-09-10T12:00:00.000Z')
      const completedAt = new Date('2026-09-12T12:00:00.000Z')

      const building = database.upgradeHistory.recordUpgrade({
        villageId: LOCAL_VILLAGE_ID,
        entityType: 'building',
        entityName: 'Army Camp',
        fromLevel: 7,
        toLevel: 8,
        startedAt,
        completedAt
      })

      const heroInProgress = database.upgradeHistory.recordUpgrade({
        villageId: LOCAL_VILLAGE_ID,
        entityType: 'hero',
        entityName: 'Archer Queen',
        fromLevel: 30,
        toLevel: 31,
        startedAt: new Date('2026-09-13T12:00:00.000Z'),
        completedAt: null
      })

      expect(heroInProgress.completedAt).toBeNull()

      const research = database.upgradeHistory.recordUpgrade({
        villageId: LOCAL_VILLAGE_ID,
        entityType: 'research',
        entityName: 'Balloon',
        fromLevel: 5,
        toLevel: 6,
        startedAt: new Date('2026-09-14T12:00:00.000Z'),
        completedAt: new Date('2026-09-15T12:00:00.000Z')
      })

      expect(building.fromLevel).toBe(7)
      expect(building.toLevel).toBe(8)
      expect(building.completedAt?.toISOString()).toBe(completedAt.toISOString())

      const history = database.upgradeHistory.getByVillageId(LOCAL_VILLAGE_ID)
      expect(history).toHaveLength(3)
      expect(history[0]?.id).toBe(research.id)
      expect(history[1]?.id).toBe(heroInProgress.id)
      expect(history[2]?.id).toBe(building.id)

      const recent = database.upgradeHistory.getRecentByVillageId(LOCAL_VILLAGE_ID, 2)
      expect(recent).toHaveLength(2)
      expect(recent[0]?.entityType).toBe('research')

      expect(() =>
        database.upgradeHistory.recordUpgrade({
          villageId: LOCAL_VILLAGE_ID,
          entityType: 'building',
          entityName: 'X-Bow',
          fromLevel: 3,
          toLevel: 2,
          startedAt,
          completedAt: null
        })
      ).toThrow(UpgradeHistoryValidationError)

      expect(() => database.upgradeHistory.getRecentByVillageId(LOCAL_VILLAGE_ID, 0)).toThrow(
        UpgradeHistoryValidationError
      )

      expect(() =>
        database.upgradeHistory.recordUpgrade({
          villageId: 999,
          entityType: 'building',
          entityName: 'Orphan',
          fromLevel: 1,
          toLevel: 2,
          startedAt,
          completedAt: null
        })
      ).toThrow()

      database.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
