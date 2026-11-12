/**
 * Canonical game catalogue types.
 *
 * The catalogue describes what exists in the game (items, categories, data
 * provenance). It is static, versioned data shipped with the app, separate
 * from a player's village state. Town Hall availability, levels, costs and
 * durations are modelled in later phases and deliberately not included here.
 */

export const GAME_MODES = ['home-village', 'builder-base'] as const
export type GameMode = (typeof GAME_MODES)[number]

export const ITEM_CATEGORIES = [
  'town-hall',
  'resource',
  'army',
  'defense',
  'trap',
  'wall',
  'hero',
  'troop',
  'super-troop',
  'spell',
  'siege-machine',
  'pet',
  'hero-equipment',
  'other'
] as const
export type ItemCategory = (typeof ITEM_CATEGORIES)[number]

/**
 * Stable, lowercase kebab-case identifier (e.g. `archer-tower`, `bb-archer-tower`).
 * IDs are globally unique across game modes and must never be renamed once
 * released, because village data and plans reference them.
 * Convention: Builder Base items use the `bb-` prefix.
 */
export type ItemId = string

export const ITEM_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export const ITEM_ID_MAX_LENGTH = 64

export function isValidItemId(value: string): value is ItemId {
  return value.length <= ITEM_ID_MAX_LENGTH && ITEM_ID_PATTERN.test(value)
}

export type CatalogueItem = {
  id: ItemId
  name: string
  category: ItemCategory
  /** Optional finer grouping, e.g. `elixir-troop`, `dark-troop`, `air-defense`. */
  subcategory: string | null
  gameMode: GameMode
  /** Town Hall (or Builder Hall) level that first unlocks the item. */
  introducedAtTownHall: number
  isUpgradeable: boolean
  /** True when a village can own more than one instance (e.g. cannons, walls). */
  isRepeatable: boolean
  description: string | null
  /** Asset reference, resolved by the asset system (Phase 4). Null until mapped. */
  assetId: string | null
  /** IDs of entries in the manifest's `sources` list that back this item. */
  sourceIds: string[]
  /** ISO 8601 date (YYYY-MM-DD) the item was last checked against its sources. */
  lastVerifiedAt: string | null
}

export const VALIDATION_STATUSES = ['unverified', 'partial', 'verified'] as const
export type ValidationStatus = (typeof VALIDATION_STATUSES)[number]

export const SOURCE_KINDS = ['official', 'community', 'in-game', 'test-fixture'] as const
export type SourceKind = (typeof SOURCE_KINDS)[number]

export type DataSource = {
  id: string
  name: string
  kind: SourceKind
  url: string | null
  /** ISO 8601 date (YYYY-MM-DD) the source was consulted. */
  retrievedAt: string | null
  notes: string | null
}

export type ChangelogEntry = {
  version: string
  date: string
  changes: string[]
}

export type GameDataManifest = {
  /** Semantic version of the dataset, e.g. `0.1.0`. */
  datasetVersion: string
  /** Game update this dataset targets, if known. */
  gameVersion: string | null
  /** ISO 8601 date (YYYY-MM-DD). */
  releasedAt: string
  validationStatus: ValidationStatus
  /** Explicit list of what the dataset does not yet cover. Must not be empty unless verified. */
  knownOmissions: string[]
  sources: DataSource[]
  changelog: ChangelogEntry[]
}

export type GameCatalogue = {
  manifest: GameDataManifest
  items: CatalogueItem[]
}
