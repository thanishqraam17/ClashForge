import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { LOCAL_VILLAGE_ID } from '../../domain/village'
import { createDatabase } from '../client/database'

const researchStartedAt = new Date('2026-09-14T11:00:00.000Z')
const researchEndsAt = new Date('2026-09-16T11:00:00.000Z')

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

describe('ResearchRepository', () => {
  it('create, getByVillageId, getById, update, upsert, and timestamps', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clashforge-research-'))
    const dbPath = join(dir, 'test.db')

    try {
      const database = seedVillage(dbPath)
      const created = database.research.create({
        villageId: LOCAL_VILLAGE_ID,
        name: 'Balloon',
        level: 5,
        category: 'TROOP',
        isResearching: true,
        researchStartedAt,
        researchEndsAt
      })

      expect(created.researchStartedAt?.toISOString()).toBe(researchStartedAt.toISOString())

      expect(database.research.getByVillageId(LOCAL_VILLAGE_ID)).toHaveLength(1)
      expect(database.research.getById(created.id)?.name).toBe('Balloon')

      const updated = database.research.update({
        ...created,
        level: 6
      })
      expect(updated.level).toBe(6)

      const upserted = database.research.upsert({
        ...updated,
        isResearching: false,
        researchStartedAt: null,
        researchEndsAt: null
      })
      expect(upserted.isResearching).toBe(false)

      database.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
