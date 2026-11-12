import { join, resolve } from 'path'
import { resolveProductionDatabasePath } from '../../database/client/database-path'

/**
 * Development-only sample-data mode. Started with `npm run dev:sample`, which
 * builds in Vite mode "sample". The sample village lives in its own database
 * under userData/sample-data and is recreated on every launch. Production
 * builds compile the request check to `false`, so the seed code and the test
 * fixtures it uses are not bundled, and a packaged app never honours it.
 */

export const SAMPLE_MODE_NAME = 'sample'
/** Passed to the renderer through webPreferences.additionalArguments. */
export const SAMPLE_DATA_ARGUMENT = '--clashforge-sample-data'
export const SAMPLE_DATABASE_DIRECTORY = 'sample-data'
export const SAMPLE_DATABASE_FILENAME = 'clashforge-sample.db'

export type SampleModeRequest = {
  /** import.meta.env.DEV of the build. */
  devBuild: boolean
  /** import.meta.env.MODE of the build. */
  mode: string
  /** app.isPackaged. */
  isPackaged: boolean
}

/** Sample mode needs a development build, in sample mode, not packaged. */
export function isSampleModeRequested({ devBuild, mode, isPackaged }: SampleModeRequest): boolean {
  return devBuild === true && mode === SAMPLE_MODE_NAME && isPackaged === false
}

/** The sample database path; never the real one. */
export function resolveSampleDatabasePath(userDataPath: string): string {
  const path = join(userDataPath, SAMPLE_DATABASE_DIRECTORY, SAMPLE_DATABASE_FILENAME)
  if (resolve(path) === resolve(resolveProductionDatabasePath(userDataPath))) {
    throw new Error('The sample database path must differ from the real database path')
  }
  return path
}
