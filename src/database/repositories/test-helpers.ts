import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { manualProvenance } from '../../domain/village-state'
import { createDatabase, type ClashForgeDatabase } from '../client/database'

export const TEST_CONFIRMED = manualProvenance(new Date('2026-11-12T10:00:00.000Z'))

export type TestDatabase = {
  database: ClashForgeDatabase
  dbPath: string
  cleanup: () => void
}

/** Fresh migrated database in a temp directory, optionally with the local village. */
export function createTestDatabase(options: { withVillage?: boolean } = {}): TestDatabase {
  const dir = mkdtempSync(join(tmpdir(), 'clashforge-test-'))
  const dbPath = join(dir, 'test.db')
  const database = createDatabase({ dbPath })
  if (options.withVillage) {
    database.villages.createVillage({
      townHallLevel: 5,
      gold: 0,
      elixir: 0,
      darkElixir: 0,
      goldCapacity: 0,
      elixirCapacity: 0,
      darkElixirCapacity: 0,
      lastScannedAt: null,
      ...TEST_CONFIRMED
    })
  }
  return {
    database,
    dbPath,
    cleanup() {
      try {
        database.close()
      } catch {
        // already closed by the test
      }
      rmSync(dir, { recursive: true, force: true })
    }
  }
}
