import { join } from 'path'

export const PRODUCTION_DATABASE_FILENAME = 'clashforge.db'

/** Production DB path from Electron userData; tests supply their own path via createDatabase. */
export function resolveProductionDatabasePath(userDataPath: string): string {
  return join(userDataPath, PRODUCTION_DATABASE_FILENAME)
}
