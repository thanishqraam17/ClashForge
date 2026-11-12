import {
  HISTORY_RECENT_MAX_LIMIT,
  UPGRADE_HISTORY_ENTITY_TYPES,
  type BuildingSaveInput,
  type HeroSaveInput,
  type HistoryGetRecentInput,
  type HistoryRecordInput,
  type ResearchSaveInput,
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

function bool(fields: Fields, key: string): boolean {
  const value = fields[key]
  if (typeof value !== 'boolean') {
    throw new IpcInputError(`${key} must be a boolean`)
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
  'builderCount',
  'availableBuilders',
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
    builderCount: nonNegativeInt(f, 'builderCount'),
    availableBuilders: nonNegativeInt(f, 'availableBuilders'),
    lastScannedAt: nullableTimestamp(f, 'lastScannedAt')
  }
}

const BUILDING_KEYS = [
  'id',
  'name',
  'category',
  'level',
  'quantity',
  'isUpgrading',
  'upgradeStartedAt',
  'upgradeEndsAt'
] as const

export function parseBuildingSaveInput(value: unknown): BuildingSaveInput {
  const f = asObject(value, BUILDING_KEYS, 'building')
  const id = optionalPositiveInt(f, 'id')
  return {
    ...(id === undefined ? {} : { id }),
    name: text(f, 'name'),
    category: text(f, 'category'),
    level: nonNegativeInt(f, 'level'),
    quantity: nonNegativeInt(f, 'quantity'),
    isUpgrading: bool(f, 'isUpgrading'),
    upgradeStartedAt: nullableTimestamp(f, 'upgradeStartedAt'),
    upgradeEndsAt: nullableTimestamp(f, 'upgradeEndsAt')
  }
}

const HERO_KEYS = [
  'id',
  'name',
  'level',
  'isUpgrading',
  'upgradeStartedAt',
  'upgradeEndsAt'
] as const

export function parseHeroSaveInput(value: unknown): HeroSaveInput {
  const f = asObject(value, HERO_KEYS, 'hero')
  const id = optionalPositiveInt(f, 'id')
  return {
    ...(id === undefined ? {} : { id }),
    name: text(f, 'name'),
    level: nonNegativeInt(f, 'level'),
    isUpgrading: bool(f, 'isUpgrading'),
    upgradeStartedAt: nullableTimestamp(f, 'upgradeStartedAt'),
    upgradeEndsAt: nullableTimestamp(f, 'upgradeEndsAt')
  }
}

const RESEARCH_KEYS = [
  'id',
  'name',
  'level',
  'category',
  'isResearching',
  'researchStartedAt',
  'researchEndsAt'
] as const

export function parseResearchSaveInput(value: unknown): ResearchSaveInput {
  const f = asObject(value, RESEARCH_KEYS, 'research')
  const id = optionalPositiveInt(f, 'id')
  return {
    ...(id === undefined ? {} : { id }),
    name: text(f, 'name'),
    level: nonNegativeInt(f, 'level'),
    category: text(f, 'category'),
    isResearching: bool(f, 'isResearching'),
    researchStartedAt: nullableTimestamp(f, 'researchStartedAt'),
    researchEndsAt: nullableTimestamp(f, 'researchEndsAt')
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

/** For channels that take no payload: reject anything other than undefined/null. */
export function parseEmptyInput(value: unknown): void {
  if (value !== undefined && value !== null) {
    throw new IpcInputError('this request takes no payload')
  }
}
