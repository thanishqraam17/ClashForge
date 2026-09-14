import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { LOCAL_VILLAGE_ID } from '../../domain/village'
import { createDatabase } from '../client/database'

const upgradeStartedAt = new Date('2026-09-14T09:00:00.000Z')
const upgradeEndsAt = new Date('2026-09-15T09:00:00.000Z')

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

describe('HeroRepository', () => {
  it('create, getByVillageId, getById, update, upsert, and timestamps', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clashforge-hero-'))
    const dbPath = join(dir, 'test.db')

    try {
      const database = seedVillage(dbPath)
      const created = database.heroes.create({
        villageId: LOCAL_VILLAGE_ID,
        name: 'Archer Queen',
        level: 30,
        isUpgrading: true,
        upgradeStartedAt,
        upgradeEndsAt
      })

      expect(created.upgradeEndsAt?.toISOString()).toBe(upgradeEndsAt.toISOString())

      expect(database.heroes.getByVillageId(LOCAL_VILLAGE_ID)).toHaveLength(1)
      expect(database.heroes.getById(created.id)?.level).toBe(30)

      const updated = database.heroes.update({
        ...created,
        level: 31
      })
      expect(updated.level).toBe(31)

      const upserted = database.heroes.upsert({
        ...updated,
        isUpgrading: false,
        upgradeStartedAt: null,
        upgradeEndsAt: null
      })
      expect(upserted.isUpgrading).toBe(false)

      database.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
