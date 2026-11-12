import type { GameCatalogue, ItemId } from './catalogue'
import type { CatalogueIssue } from './catalogue-validation'
import type { TownHallRuleSet } from './town-hall-rules'

/**
 * Asset manifest: maps a catalogue item (and optionally a level) to an image
 * file with provenance. See docs/asset-licensing.md for the sourcing rules.
 */

export type AssetEntry = {
  itemId: ItemId
  /** Level-specific artwork, or null for the item's canonical image. */
  level: number | null
  /**
   * Path relative to the bundled assets directory, e.g. `defense/cannon-3.png`.
   * Fixed in the manifest; never derived from user input or item names.
   */
  assetPath: string
  sourceName: string
  sourceUrl: string | null
  /** Attribution text shown to users where the source requires it. */
  attribution: string
  /** Lowercase hex SHA-256 of the file, checked before the file is served. */
  checksum: string
  /** ISO date (YYYY-MM-DD) the image was checked against the real item. */
  lastVerifiedAt: string
}

export type AssetManifest = {
  assets: AssetEntry[]
}

export const ASSET_PATH_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*\.(?:png|webp)$/
const CHECKSUM_PATTERN = /^[0-9a-f]{64}$/
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const ENTRY_KEYS = [
  'itemId',
  'level',
  'assetPath',
  'sourceName',
  'sourceUrl',
  'attribution',
  'checksum',
  'lastVerifiedAt'
]

export type AssetManifestValidationResult =
  | { ok: true; manifest: AssetManifest }
  | { ok: false; issues: CatalogueIssue[] }

export class AssetManifestValidationError extends Error {
  constructor(readonly issues: CatalogueIssue[]) {
    super(
      `Asset manifest is invalid:\n${issues.map((issue) => `  ${issue.path}: ${issue.message}`).join('\n')}`
    )
    this.name = 'AssetManifestValidationError'
  }
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/** Highest level an item can reach at any Town Hall in the rules. */
function highestLevel(rules: TownHallRuleSet, itemId: ItemId): number {
  const entry = rules.items.find((item) => item.itemId === itemId)
  return entry ? Math.max(...entry.steps.map((step) => step.maxLevel)) : 0
}

export function validateAssetManifest(
  raw: unknown,
  catalogue: GameCatalogue,
  rules: TownHallRuleSet
): AssetManifestValidationResult {
  const issues: CatalogueIssue[] = []
  const add = (path: string, message: string): void => {
    issues.push({ path, message })
  }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, issues: [{ path: 'assets', message: 'must be an object' }] }
  }
  const fields = raw as Record<string, unknown>
  for (const key of Object.keys(fields)) {
    if (key !== 'assets') add(`assets.${key}`, 'is not a recognised field')
  }
  if (!Array.isArray(fields['assets'])) {
    add('assets.assets', 'must be an array')
    return { ok: false, issues }
  }

  const itemsById = new Map(catalogue.items.map((item) => [item.id, item]))
  const seenKeys = new Set<string>()
  const seenPaths = new Set<string>()
  const assets: AssetEntry[] = []

  fields['assets'].forEach((entry: unknown, index) => {
    const path = `assets.assets[${index}]`
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      add(path, 'must be an object')
      return
    }
    const e = entry as Record<string, unknown>
    const before = issues.length
    for (const key of Object.keys(e)) {
      if (!ENTRY_KEYS.includes(key)) add(`${path}.${key}`, 'is not a recognised field')
    }

    const item = typeof e['itemId'] === 'string' ? itemsById.get(e['itemId']) : undefined
    if (!item) add(`${path}.itemId`, `unknown catalogue item ${JSON.stringify(e['itemId'])}`)

    const level = e['level']
    if (level !== null) {
      if (typeof level !== 'number' || !Number.isInteger(level) || level < 1) {
        add(`${path}.level`, 'must be null or a positive integer')
      } else if (item && !item.isUpgradeable) {
        add(`${path}.level`, 'must be null for an item that is not upgradeable')
      } else if (item && level > highestLevel(rules, item.id)) {
        add(`${path}.level`, `exceeds the highest level of "${item.id}"`)
      }
    }

    if (typeof e['assetPath'] !== 'string' || !ASSET_PATH_PATTERN.test(e['assetPath'])) {
      add(`${path}.assetPath`, 'must look like "folder/file-name.png" (lowercase, png or webp)')
    } else if (seenPaths.has(e['assetPath'])) {
      add(`${path}.assetPath`, `duplicate asset path "${e['assetPath']}"`)
    }

    for (const key of ['sourceName', 'attribution']) {
      if (!nonEmptyString(e[key])) add(`${path}.${key}`, 'must be a non-empty string')
    }
    const url = e['sourceUrl']
    if (url !== null && (typeof url !== 'string' || !url.startsWith('https://'))) {
      add(`${path}.sourceUrl`, 'must be null or an https URL')
    }
    if (typeof e['checksum'] !== 'string' || !CHECKSUM_PATTERN.test(e['checksum'])) {
      add(`${path}.checksum`, 'must be a lowercase hex SHA-256')
    }
    if (
      typeof e['lastVerifiedAt'] !== 'string' ||
      !DATE_PATTERN.test(e['lastVerifiedAt']) ||
      Number.isNaN(Date.parse(e['lastVerifiedAt']))
    ) {
      add(`${path}.lastVerifiedAt`, 'must be a YYYY-MM-DD date')
    }

    if (item && issues.length === before) {
      const key = `${item.id}@${level ?? 'canonical'}`
      if (seenKeys.has(key)) {
        add(path, `duplicate image for "${item.id}" at level ${level ?? 'canonical'}`)
        return
      }
      seenKeys.add(key)
      seenPaths.add(e['assetPath'] as string)
      assets.push(e as unknown as AssetEntry)
    }
  })

  return issues.length > 0 ? { ok: false, issues } : { ok: true, manifest: { assets } }
}

export function parseAssetManifest(
  raw: unknown,
  catalogue: GameCatalogue,
  rules: TownHallRuleSet
): AssetManifest {
  const result = validateAssetManifest(raw, catalogue, rules)
  if (!result.ok) throw new AssetManifestValidationError(result.issues)
  return result.manifest
}
