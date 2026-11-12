import {
  GAME_MODES,
  ITEM_CATEGORIES,
  SOURCE_KINDS,
  VALIDATION_STATUSES,
  isValidItemId,
  type CatalogueItem,
  type ChangelogEntry,
  type DataSource,
  type GameCatalogue,
  type GameDataManifest
} from './catalogue'

/**
 * Validates raw (untrusted, e.g. parsed JSON) game data. Collects every issue
 * instead of stopping at the first, so a dataset author sees all problems at once.
 */

export type CatalogueIssue = {
  path: string
  message: string
}

export type CatalogueValidationResult =
  | { ok: true; catalogue: GameCatalogue }
  | { ok: false; issues: CatalogueIssue[] }

export class CatalogueValidationError extends Error {
  constructor(readonly issues: CatalogueIssue[]) {
    super(
      `Game data is invalid:\n${issues.map((issue) => `  ${issue.path}: ${issue.message}`).join('\n')}`
    )
    this.name = 'CatalogueValidationError'
  }
}

const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const SOURCE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_TOWN_HALL_LEVEL = 30

type Fields = Record<string, unknown>

class Collector {
  readonly issues: CatalogueIssue[] = []

  add(path: string, message: string): void {
    this.issues.push({ path, message })
  }

  object(value: unknown, path: string, keys: readonly string[]): Fields | null {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      this.add(path, 'must be an object')
      return null
    }
    for (const key of Object.keys(value)) {
      if (!keys.includes(key)) {
        this.add(`${path}.${key}`, 'is not a recognised field')
      }
    }
    return value as Fields
  }

  array(value: unknown, path: string): unknown[] {
    if (!Array.isArray(value)) {
      this.add(path, 'must be an array')
      return []
    }
    return value
  }

  string(fields: Fields, key: string, path: string): string {
    const value = fields[key]
    if (typeof value !== 'string' || !value.trim()) {
      this.add(`${path}.${key}`, 'must be a non-empty string')
      return ''
    }
    return value
  }

  nullableString(fields: Fields, key: string, path: string): string | null {
    return fields[key] === null ? null : this.string(fields, key, path)
  }

  boolean(fields: Fields, key: string, path: string): boolean {
    const value = fields[key]
    if (typeof value !== 'boolean') {
      this.add(`${path}.${key}`, 'must be a boolean')
      return false
    }
    return value
  }

  oneOf<T extends string>(
    fields: Fields,
    key: string,
    path: string,
    allowed: readonly T[]
  ): T {
    const value = fields[key]
    if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
      this.add(`${path}.${key}`, `must be one of: ${allowed.join(', ')}`)
      return allowed[0]!
    }
    return value as T
  }

  date(fields: Fields, key: string, path: string): string {
    const value = this.string(fields, key, path)
    if (value && (!DATE_PATTERN.test(value) || Number.isNaN(Date.parse(value)))) {
      this.add(`${path}.${key}`, 'must be a YYYY-MM-DD date')
    }
    return value
  }

  nullableDate(fields: Fields, key: string, path: string): string | null {
    return fields[key] === null ? null : this.date(fields, key, path)
  }

  stringList(fields: Fields, key: string, path: string): string[] {
    return this.array(fields[key], `${path}.${key}`).map((entry, index) => {
      if (typeof entry !== 'string' || !entry.trim()) {
        this.add(`${path}.${key}[${index}]`, 'must be a non-empty string')
        return ''
      }
      return entry
    })
  }
}

const SOURCE_KEYS = ['id', 'name', 'kind', 'url', 'retrievedAt', 'notes'] as const

function parseSource(c: Collector, value: unknown, path: string): DataSource | null {
  const f = c.object(value, path, SOURCE_KEYS)
  if (!f) return null
  const id = c.string(f, 'id', path)
  if (id && !SOURCE_ID_PATTERN.test(id)) {
    c.add(`${path}.id`, 'must be lowercase kebab-case')
  }
  const url = c.nullableString(f, 'url', path)
  if (url !== null && url && !/^https:\/\//.test(url)) {
    c.add(`${path}.url`, 'must be an https URL')
  }
  return {
    id,
    name: c.string(f, 'name', path),
    kind: c.oneOf(f, 'kind', path, SOURCE_KINDS),
    url,
    retrievedAt: c.nullableDate(f, 'retrievedAt', path),
    notes: c.nullableString(f, 'notes', path)
  }
}

const CHANGELOG_KEYS = ['version', 'date', 'changes'] as const

function parseChangelogEntry(
  c: Collector,
  value: unknown,
  path: string
): ChangelogEntry | null {
  const f = c.object(value, path, CHANGELOG_KEYS)
  if (!f) return null
  return {
    version: c.string(f, 'version', path),
    date: c.date(f, 'date', path),
    changes: c.stringList(f, 'changes', path)
  }
}

const MANIFEST_KEYS = [
  'datasetVersion',
  'gameVersion',
  'releasedAt',
  'validationStatus',
  'knownOmissions',
  'sources',
  'changelog'
] as const

function parseManifest(c: Collector, value: unknown): GameDataManifest | null {
  const path = 'manifest'
  const f = c.object(value, path, MANIFEST_KEYS)
  if (!f) return null

  const datasetVersion = c.string(f, 'datasetVersion', path)
  if (datasetVersion && !SEMVER_PATTERN.test(datasetVersion)) {
    c.add(`${path}.datasetVersion`, 'must be a semantic version like 1.2.3')
  }

  const validationStatus = c.oneOf(f, 'validationStatus', path, VALIDATION_STATUSES)
  const knownOmissions = c.stringList(f, 'knownOmissions', path)
  if (validationStatus !== 'verified' && knownOmissions.length === 0) {
    c.add(
      `${path}.knownOmissions`,
      'must list what is missing unless validationStatus is "verified"'
    )
  }

  const sources = c
    .array(f['sources'], `${path}.sources`)
    .map((entry, index) => parseSource(c, entry, `${path}.sources[${index}]`))
    .filter((source): source is DataSource => source !== null)
  const seenSources = new Set<string>()
  sources.forEach((source, index) => {
    if (seenSources.has(source.id)) {
      c.add(`${path}.sources[${index}].id`, `duplicate source id "${source.id}"`)
    }
    seenSources.add(source.id)
  })

  const changelog = c
    .array(f['changelog'], `${path}.changelog`)
    .map((entry, index) => parseChangelogEntry(c, entry, `${path}.changelog[${index}]`))
    .filter((entry): entry is ChangelogEntry => entry !== null)
  if (datasetVersion && !changelog.some((entry) => entry.version === datasetVersion)) {
    c.add(`${path}.changelog`, `must include an entry for version ${datasetVersion}`)
  }

  return {
    datasetVersion,
    gameVersion: f['gameVersion'] === null ? null : c.string(f, 'gameVersion', path),
    releasedAt: c.date(f, 'releasedAt', path),
    validationStatus,
    knownOmissions,
    sources,
    changelog
  }
}

const ITEM_KEYS = [
  'id',
  'name',
  'category',
  'subcategory',
  'gameMode',
  'introducedAtTownHall',
  'isUpgradeable',
  'isRepeatable',
  'description',
  'gameDataId',
  'assetId',
  'sourceIds',
  'lastVerifiedAt'
] as const

function parseItem(
  c: Collector,
  value: unknown,
  path: string,
  knownSourceIds: ReadonlySet<string>
): CatalogueItem | null {
  const f = c.object(value, path, ITEM_KEYS)
  if (!f) return null

  const id = c.string(f, 'id', path)
  if (id && !isValidItemId(id)) {
    c.add(`${path}.id`, 'must be lowercase kebab-case, at most 64 characters')
  }

  const gameMode = c.oneOf(f, 'gameMode', path, GAME_MODES)
  if (id && gameMode === 'builder-base' && !id.startsWith('bb-')) {
    c.add(`${path}.id`, 'Builder Base item ids must start with "bb-"')
  }
  if (id && gameMode === 'home-village' && id.startsWith('bb-')) {
    c.add(`${path}.id`, 'only Builder Base item ids may start with "bb-"')
  }

  const introducedAtTownHall = f['introducedAtTownHall']
  if (
    typeof introducedAtTownHall !== 'number' ||
    !Number.isInteger(introducedAtTownHall) ||
    introducedAtTownHall < 1 ||
    introducedAtTownHall > MAX_TOWN_HALL_LEVEL
  ) {
    c.add(
      `${path}.introducedAtTownHall`,
      `must be an integer between 1 and ${MAX_TOWN_HALL_LEVEL}`
    )
  }

  const sourceIds = c.stringList(f, 'sourceIds', path)
  if (sourceIds.length === 0) {
    c.add(`${path}.sourceIds`, 'must reference at least one source')
  }
  sourceIds.forEach((sourceId, index) => {
    if (sourceId && !knownSourceIds.has(sourceId)) {
      c.add(`${path}.sourceIds[${index}]`, `unknown source "${sourceId}"`)
    }
  })

  const gameDataId = f['gameDataId']
  if (
    gameDataId !== null &&
    (typeof gameDataId !== 'number' || !Number.isSafeInteger(gameDataId) || gameDataId < 1)
  ) {
    c.add(`${path}.gameDataId`, 'must be null or a positive integer')
  }

  return {
    id,
    gameDataId: gameDataId as number | null,
    name: c.string(f, 'name', path),
    category: c.oneOf(f, 'category', path, ITEM_CATEGORIES),
    subcategory: c.nullableString(f, 'subcategory', path),
    gameMode,
    introducedAtTownHall: introducedAtTownHall as number,
    isUpgradeable: c.boolean(f, 'isUpgradeable', path),
    isRepeatable: c.boolean(f, 'isRepeatable', path),
    description: c.nullableString(f, 'description', path),
    assetId: c.nullableString(f, 'assetId', path),
    sourceIds,
    lastVerifiedAt: c.nullableDate(f, 'lastVerifiedAt', path)
  }
}

export function validateGameCatalogue(
  rawManifest: unknown,
  rawItems: unknown
): CatalogueValidationResult {
  const c = new Collector()
  const manifest = parseManifest(c, rawManifest)
  const knownSourceIds = new Set(manifest?.sources.map((source) => source.id) ?? [])

  const items = c
    .array(rawItems, 'items')
    .map((entry, index) => parseItem(c, entry, `items[${index}]`, knownSourceIds))
    .filter((item): item is CatalogueItem => item !== null)

  const seenIds = new Set<string>()
  const seenGameDataIds = new Map<number, string>()
  items.forEach((item, index) => {
    if (item.id && seenIds.has(item.id)) {
      c.add(`items[${index}].id`, `duplicate item id "${item.id}"`)
    }
    seenIds.add(item.id)
    if (typeof item.gameDataId === 'number') {
      const owner = seenGameDataIds.get(item.gameDataId)
      if (owner !== undefined) {
        c.add(`items[${index}].gameDataId`, `game data id ${item.gameDataId} is already used by "${owner}"`)
      } else {
        seenGameDataIds.set(item.gameDataId, item.id)
      }
    }
  })

  if (c.issues.length > 0 || manifest === null) {
    return { ok: false, issues: c.issues }
  }
  return { ok: true, catalogue: { manifest, items } }
}

/** Throws CatalogueValidationError with every issue if the data is invalid. */
export function parseGameCatalogue(rawManifest: unknown, rawItems: unknown): GameCatalogue {
  const result = validateGameCatalogue(rawManifest, rawItems)
  if (!result.ok) {
    throw new CatalogueValidationError(result.issues)
  }
  return result.catalogue
}
