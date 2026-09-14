import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { LOCAL_VILLAGE_ID } from '../../domain/village'
import { createDatabase } from '../client/database'

const upgradeStartedAt = new Date('2026-09-14T08:00:00.000Z')
const upgradeEndsAt = new Date('2026-09-15T08:00:00.000Z')

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

describe('BuildingRepository', () => {
  it('create, getByVillageId, getById, update, upsert, and timestamps', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clashforge-building-'))
    const dbPath = join(dir, 'test.db')

    try {
      const database = seedVillage(dbPath)
      const created = database.buildings.create({
        villageId: LOCAL_VILLAGE_ID,
        name: 'Army Camp',
        category: 'ARMY',
        level: 7,
        quantity: 1,
        isUpgrading: true,
        upgradeStartedAt,
        upgradeEndsAt
      })

      expect(created.id).toBeGreaterThan(0)
      expect(created.upgradeStartedAt?.toISOString()).toBe(upgradeStartedAt.toISOString())

      const byVillage = database.buildings.getByVillageId(LOCAL_VILLAGE_ID)
      expect(byVillage).toHaveLength(1)

      const byId = database.buildings.getById(created.id)
      expect(byId?.name).toBe('Army Camp')

      const updated = database.buildings.update({
        ...created,
        level: 8,
        isUpgrading: false,
        upgradeStartedAt: null,
        upgradeEndsAt: null
      })
      expect(updated.level).toBe(8)

      const upserted = database.buildings.upsert({
        ...updated,
        quantity: 2
      })
      expect(upserted.quantity).toBe(2)
      expect(database.buildings.getByVillageId(LOCAL_VILLAGE_ID)).toHaveLength(1)

      database.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
