import { parseGameCatalogue } from '../domain/catalogue-validation'
import type { GameCatalogue } from '../domain/catalogue'
import rawItems from './items.json'
import rawManifest from './manifest.json'

/**
 * Loads and validates the game data bundled with the app. Throws
 * CatalogueValidationError if the shipped files are malformed, which is caught
 * by tests long before a release.
 */
export function loadBundledGameCatalogue(): GameCatalogue {
  return parseGameCatalogue(rawManifest, rawItems)
}
