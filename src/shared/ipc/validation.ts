import { GAME_MODES, ITEM_CATEGORIES, isValidItemId } from '../../domain/catalogue'
import {
  HISTORY_RECENT_MAX_LIMIT,
  type CatalogueGetItemInput,
  type AssetsResolveInput,
  type CatalogueGetItemsInput,
  type TownHallCompareInput,
  type TownHallGetItemInput,
  type TownHallGetSummaryInput,
  UPGRADE_HISTORY_ENTITY_TYPES,
  type HistoryGetRecentInput,
  type HistoryRecordInput,
  type UpgradeHistoryEntityTypeDto,
  type VillageSaveInput
} from './contracts'

/**
 * Structural validation of untrusted IPC payloads. Business rules (e.g. end
 * time after start time) stay in the domain layer; this only guarantees shape
 * and primitive types so nothing malformed reaches a repository.
 */

export class IpcInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IpcInputError'
  }
}

const MAX_TEXT_LENGTH = 200
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/

type Fields = Record<string, unknown>

function asObject(value: unknown, allowedKeys: readonly string[], label: string): Fields {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new IpcInputError(`${label} must be an object`)
  }
  const proto = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) {
    throw new IpcInputError(`${label} must be a plain object`)
  }
  for (const key of Object.keys(value)) {
    if (!allowedKeys.includes(key)) {
      throw new IpcInputError(`${label} has unknown field "${key}"`)
    }
  }
  return value as Fields
}

function nonNegativeInt(fields: Fields, key: string): number {
  const value = fields[key]
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new IpcInputError(`${key} must be a non-negative integer`)
  }
  return value
}

function positiveInt(fields: Fields, key: string): number {
  const value = fields[key]
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new IpcInputError(`${key} must be a positive integer`)
  }
  return value
}

function optionalPositiveInt(fields: Fields, key: string): number | undefined {
  return fields[key] === undefined ? undefined : positiveInt(fields, key)
}

function text(fields: Fields, key: string): string {
  const value = fields[key]
  if (typeof value !== 'string') {
    throw new IpcInputError(`${key} must be a string`)
  }
  if (!value.trim()) {
    throw new IpcInputError(`${key} is required`)
  }
  if (value.length > MAX_TEXT_LENGTH) {
    throw new IpcInputError(`${key} must be at most ${MAX_TEXT_LENGTH} characters`)
  }
  return value
}

function timestamp(fields: Fields, key: string): string {
  const value = fields[key]
  if (
    typeof value !== 'string' ||
    !ISO_TIMESTAMP_PATTERN.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new IpcInputError(`${key} must be an ISO 8601 timestamp`)
  }
  return value
}

function nullableTimestamp(fields: Fields, key: string): string | null {
  if (fields[key] === null) {
    return null
  }
  return timestamp(fields, key)
}

function entityType(fields: Fields, key: string): UpgradeHistoryEntityTypeDto {
  const value = fields[key]
  if (
    typeof value !== 'string' ||
    !(UPGRADE_HISTORY_ENTITY_TYPES as readonly string[]).includes(value)
  ) {
    throw new IpcInputError(`${key} must be one of: ${UPGRADE_HISTORY_ENTITY_TYPES.join(', ')}`)
  }
  return value as UpgradeHistoryEntityTypeDto
}

const VILLAGE_KEYS = [
  'townHallLevel',
  'gold',
  'elixir',
  'darkElixir',
  'goldCapacity',
  'elixirCapacity',
  'darkElixirCapacity',
  'lastScannedAt'
] as const

export function parseVillageSaveInput(value: unknown): VillageSaveInput {
  const f = asObject(value, VILLAGE_KEYS, 'village')
  return {
    townHallLevel: positiveInt(f, 'townHallLevel'),
    gold: nonNegativeInt(f, 'gold'),
    elixir: nonNegativeInt(f, 'elixir'),
    darkElixir: nonNegativeInt(f, 'darkElixir'),
    goldCapacity: nonNegativeInt(f, 'goldCapacity'),
    elixirCapacity: nonNegativeInt(f, 'elixirCapacity'),
    darkElixirCapacity: nonNegativeInt(f, 'darkElixirCapacity'),
    lastScannedAt: nullableTimestamp(f, 'lastScannedAt')
  }
}

export function parseHistoryGetRecentInput(value: unknown): HistoryGetRecentInput {
  if (value === undefined || value === null) {
    return {}
  }
  const f = asObject(value, ['limit'], 'history query')
  const limit = optionalPositiveInt(f, 'limit')
  if (limit !== undefined && limit > HISTORY_RECENT_MAX_LIMIT) {
    throw new IpcInputError(`limit must be at most ${HISTORY_RECENT_MAX_LIMIT}`)
  }
  return limit === undefined ? {} : { limit }
}

const HISTORY_RECORD_KEYS = [
  'entityType',
  'entityName',
  'fromLevel',
  'toLevel',
  'startedAt',
  'completedAt'
] as const

export function parseHistoryRecordInput(value: unknown): HistoryRecordInput {
  const f = asObject(value, HISTORY_RECORD_KEYS, 'history record')
  return {
    entityType: entityType(f, 'entityType'),
    entityName: text(f, 'entityName'),
    fromLevel: nonNegativeInt(f, 'fromLevel'),
    toLevel: nonNegativeInt(f, 'toLevel'),
    startedAt: timestamp(f, 'startedAt'),
    completedAt: nullableTimestamp(f, 'completedAt')
  }
}

const MAX_TOWN_HALL_FILTER = 30

export function parseCatalogueGetItemsInput(value: unknown): CatalogueGetItemsInput {
  if (value === undefined || value === null) {
    return {}
  }
  const f = asObject(
    value,
    ['gameMode', 'categories', 'search', 'maxTownHall'],
    'catalogue query'
  )
  const result: CatalogueGetItemsInput = {}

  if (f['gameMode'] !== undefined) {
    const mode = f['gameMode']
    if (typeof mode !== 'string' || !(GAME_MODES as readonly string[]).includes(mode)) {
      throw new IpcInputError(`gameMode must be one of: ${GAME_MODES.join(', ')}`)
    }
    result.gameMode = mode as CatalogueGetItemsInput['gameMode']
  }

  if (f['categories'] !== undefined) {
    const categories = f['categories']
    if (
      !Array.isArray(categories) ||
      categories.length > ITEM_CATEGORIES.length ||
      !categories.every(
        (entry) =>
          typeof entry === 'string' && (ITEM_CATEGORIES as readonly string[]).includes(entry)
      )
    ) {
      throw new IpcInputError(`categories must be a list of: ${ITEM_CATEGORIES.join(', ')}`)
    }
    result.categories = categories as CatalogueGetItemsInput['categories']
  }

  if (f['search'] !== undefined) {
    const search = f['search']
    if (typeof search !== 'string' || search.length > MAX_TEXT_LENGTH) {
      throw new IpcInputError(`search must be a string of at most ${MAX_TEXT_LENGTH} characters`)
    }
    result.search = search
  }

  if (f['maxTownHall'] !== undefined) {
    const level = positiveInt(f, 'maxTownHall')
    if (level > MAX_TOWN_HALL_FILTER) {
      throw new IpcInputError(`maxTownHall must be at most ${MAX_TOWN_HALL_FILTER}`)
    }
    result.maxTownHall = level
  }

  return result
}

export function parseCatalogueGetItemInput(value: unknown): CatalogueGetItemInput {
  const f = asObject(value, ['id'], 'catalogue item query')
  const id = f['id']
  if (typeof id !== 'string' || !isValidItemId(id)) {
    throw new IpcInputError('id must be a valid catalogue item id')
  }
  return { id }
}

function optionalGameMode(fields: Fields): { gameMode?: (typeof GAME_MODES)[number] } {
  const mode = fields['gameMode']
  if (mode === undefined) return {}
  if (typeof mode !== 'string' || !(GAME_MODES as readonly string[]).includes(mode)) {
    throw new IpcInputError(`gameMode must be one of: ${GAME_MODES.join(', ')}`)
  }
  return { gameMode: mode as (typeof GAME_MODES)[number] }
}

/** Range against real data is checked by the Town Hall service; this checks shape. */
function townHallLevel(fields: Fields, key: string): number {
  const level = positiveInt(fields, key)
  if (level > MAX_TOWN_HALL_FILTER) {
    throw new IpcInputError(`${key} must be at most ${MAX_TOWN_HALL_FILTER}`)
  }
  return level
}

export function parseTownHallGetItemInput(value: unknown): TownHallGetItemInput {
  const f = asObject(value, ['itemId', 'townHall'], 'town hall item query')
  const itemId = f['itemId']
  if (typeof itemId !== 'string' || !isValidItemId(itemId)) {
    throw new IpcInputError('itemId must be a valid catalogue item id')
  }
  return { itemId, townHall: townHallLevel(f, 'townHall') }
}

export function parseTownHallGetSummaryInput(value: unknown): TownHallGetSummaryInput {
  const f = asObject(value, ['townHall', 'gameMode'], 'town hall summary query')
  return { townHall: townHallLevel(f, 'townHall'), ...optionalGameMode(f) }
}

export function parseTownHallCompareInput(value: unknown): TownHallCompareInput {
  const f = asObject(value, ['fromTownHall', 'toTownHall', 'gameMode'], 'town hall comparison')
  return {
    fromTownHall: townHallLevel(f, 'fromTownHall'),
    toTownHall: townHallLevel(f, 'toTownHall'),
    ...optionalGameMode(f)
  }
}

const MAX_ASSET_LEVEL = 200

export function parseAssetsResolveInput(value: unknown): AssetsResolveInput {
  const f = asObject(value, ['itemId', 'level'], 'asset query')
  const itemId = f['itemId']
  if (typeof itemId !== 'string' || !isValidItemId(itemId)) {
    throw new IpcInputError('itemId must be a valid catalogue item id')
  }
  if (f['level'] === undefined || f['level'] === null) {
    return { itemId, level: null }
  }
  const level = positiveInt(f, 'level')
  if (level > MAX_ASSET_LEVEL) {
    throw new IpcInputError(`level must be at most ${MAX_ASSET_LEVEL}`)
  }
  return { itemId, level }
}

/** For channels that take no payload: reject anything other than undefined/null. */
export function parseEmptyInput(value: unknown): void {
  if (value !== undefined && value !== null) {
    throw new IpcInputError('this request takes no payload')
  }
}
