import { parseAssetManifest, type AssetManifest } from '../domain/assets'
import { parseGameCatalogue } from '../domain/catalogue-validation'
import { parseExportSemantics, type ExportSemantics } from '../domain/export-semantics'
import type { GameCatalogue } from '../domain/catalogue'
import type { TownHallRuleSet } from '../domain/town-hall-rules'
import { parseTownHallRules } from '../domain/town-hall-rules-validation'
import rawAssets from './assets.json'
import rawExportSemantics from './export-semantics.json'
import rawItems from './items.json'
import rawManifest from './manifest.json'
import rawTownHallRules from './town-hall-rules.json'

export type BundledGameData = {
  catalogue: GameCatalogue
  townHallRules: TownHallRuleSet
  assets: AssetManifest
  exportSemantics: ExportSemantics
}

/**
 * Loads and validates the game data bundled with the app. Throws a validation
 * error if the shipped files are malformed or inconsistent with each other,
 * which tests catch long before a release.
 */
export function loadBundledGameData(): BundledGameData {
  const catalogue = parseGameCatalogue(rawManifest, rawItems)
  const townHallRules = parseTownHallRules(rawTownHallRules, catalogue)
  const assets = parseAssetManifest(rawAssets, catalogue, townHallRules)
  const exportSemantics = parseExportSemantics(rawExportSemantics)
  return { catalogue, townHallRules, assets, exportSemantics }
}
