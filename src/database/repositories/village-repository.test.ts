import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { LOCAL_VILLAGE_ID } from '../../domain/village'
import { createDatabase } from '../client/database'

const sampleInput = {
  townHallLevel: 9,
  gold: 1_000_000,
  elixir: 2_000_000,
  darkElixir: 10_000,
  goldCapacity: 8_000_000,
  elixirCapacity: 8_000_000,
  darkElixirCapacity: 300_000,
  builderCount: 4,
  availableBuilders: 2,
  lastScannedAt: new Date('2026-09-14T10:00:00.000Z')
}

describe('VillageRepository smoke', () => {
  it('creates, updates, upserts, and persists across reopen', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clashforge-village-'))
    const dbPath = join(dir, 'test.db')

    try {
      let database = createDatabase({ dbPath })
      expect(database.villages.getVillage()).toBeNull()

      const created = database.villages.createVillage(sampleInput)
      expect(created.id).toBe(LOCAL_VILLAGE_ID)
      expect(created.gold).toBe(sampleInput.gold)

      const updated = database.villages.updateVillage({
        ...created,
        gold: 3_000_000
      })
      expect(updated.gold).toBe(3_000_000)

      database.close()

      database = createDatabase({ dbPath })
      const reloaded = database.villages.getVillage()
      expect(reloaded?.gold).toBe(3_000_000)

      const upserted = database.villages.upsertVillage({
        ...sampleInput,
        elixir: 5_000_000
      })
      expect(upserted.elixir).toBe(5_000_000)

      database.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
