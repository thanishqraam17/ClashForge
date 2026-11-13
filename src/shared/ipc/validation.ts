import { GAME_MODES, ITEM_CATEGORIES, isValidItemId } from '../../domain/catalogue'
import { EDIT_ENTITY_TYPES, EDIT_NOTE_MAX_LENGTH, type EditEntityType } from '../../domain/edit-log'
import type { LegacyKind } from '../../database/repositories/legacy-record-repository'
import {
  BULK_EDIT_MAX_ITEMS,
  EDIT_LOG_PAGE_MAX_LIMIT,
  HISTORY_RECENT_MAX_LIMIT,
  type EditLogGetBatchInput,
  type EditLogListInput,
  type EditNoteInput,
  type LegacyMapInput,
  type LegacyRecordRefInput,
  type VillageItemRemoveInput,
  type VillageItemsSetCountInput,
  type VillageItemsSetLevelsInput,
  type CatalogueGetItemInput,
  type AssetsResolveInput,
  type BuildersReclassifyLegacyInput,
  type BuildersRemoveUnclassifiedInput,
  type BuildersSetBobInput,
  type BuildersSetCountInput,
  type BuildersSetOrdinaryCountInput,
  type ImportApplyInput,
  type ImportListInput,
  type ImportPreviewTextInput,
  type IdInput,
  type LegacyListInput,
  type ResearchRemoveInput,
  type ResearchSaveInput,
  type SnapshotsListInput,
  type VillageItemSaveInput,
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

/**
 * The optional edit note. Only present in the result when sent, so requests
 * without a note parse exactly as before.
 */
function noteField(fields: Fields): EditNoteInput {
  if (!('note' in fields) || fields['note'] === undefined) return {}
  const value = fields['note']
  if (value === null) return { note: null }
  if (typeof value !== 'string') throw new IpcInputError('note must be a string or null')
  if (!value.trim()) throw new IpcInputError('note must not be empty')
  if (value.length > EDIT_NOTE_MAX_LENGTH) {
    throw new IpcInputError(`note must be at most ${EDIT_NOTE_MAX_LENGTH} characters`)
  }
  return { note: value }
}

/** A list of distinct positive integer ids, at most BULK_EDIT_MAX_ITEMS long. */
function idList(fields: Fields, key: string, { allowEmpty }: { allowEmpty: boolean }): number[] {
  const value = fields[key]
  if (!Array.isArray(value)) throw new IpcInputError(`${key} must be a list of ids`)
  if (!allowEmpty && value.length === 0) throw new IpcInputError(`${key} must not be empty`)
  if (value.length > BULK_EDIT_MAX_ITEMS) {
    throw new IpcInputError(`${key} must have at most ${BULK_EDIT_MAX_ITEMS} entries`)
  }
  for (let i = 0; i < value.length; i += 1) {
    if (!(i in value)) throw new IpcInputError(`${key} must not have gaps`)
    const id = value[i]
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1) {
      throw new IpcInputError(`${key} must contain positive integer ids`)
    }
  }
  if (new Set(value).size !== value.length) throw new IpcInputError(`${key} must not contain duplicates`)
  return [...(value as number[])]
}

function optionalIdList(fields: Fields, key: string): number[] | undefined {
  return fields[key] === undefined ? undefined : idList(fields, key, { allowEmpty: true })
}

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
  'lastScannedAt',
  'note'
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
    lastScannedAt: nullableTimestamp(f, 'lastScannedAt'),
    ...noteField(f)
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

function itemIdField(fields: Fields, key = 'itemId'): string {
  const value = fields[key]
  if (typeof value !== 'string' || !isValidItemId(value)) {
    throw new IpcInputError(`${key} must be a valid catalogue item id`)
  }
  return value
}

function nullablePositiveInt(fields: Fields, key: string): number | null {
  return fields[key] === null ? null : positiveInt(fields, key)
}

export function parseVillageItemSaveInput(value: unknown): VillageItemSaveInput {
  const f = asObject(
    value,
    ['id', 'itemId', 'instanceNumber', 'level', 'targetLevel', 'upgradeStartedAt', 'upgradeEndsAt', 'builderId', 'note'],
    'village item'
  )
  const id = optionalPositiveInt(f, 'id')
  return {
    ...(id === undefined ? {} : { id }),
    itemId: itemIdField(f),
    instanceNumber: positiveInt(f, 'instanceNumber'),
    level: positiveInt(f, 'level'),
    targetLevel: nullablePositiveInt(f, 'targetLevel'),
    upgradeStartedAt: nullableTimestamp(f, 'upgradeStartedAt'),
    upgradeEndsAt: nullableTimestamp(f, 'upgradeEndsAt'),
    builderId: nullablePositiveInt(f, 'builderId'),
    ...noteField(f)
  }
}

export function parseVillageItemRemoveInput(value: unknown): VillageItemRemoveInput {
  const f = asObject(value, ['id', 'note'], 'request')
  return { id: positiveInt(f, 'id'), ...noteField(f) }
}

export function parseIdInput(value: unknown): IdInput {
  const f = asObject(value, ['id'], 'request')
  return { id: positiveInt(f, 'id') }
}

export function parseBuildersSetCountInput(value: unknown): BuildersSetCountInput {
  const f = asObject(value, ['count', 'note'], 'builder count')
  return { count: nonNegativeInt(f, 'count'), ...noteField(f) }
}

const ORDINARY_BUILDER_HUT_MAX = 5

function boundedInt(fields: Fields, key: string, min: number, max: number): number {
  const value = fields[key]
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new IpcInputError(`${key} must be an integer between ${min} and ${max}`)
  }
  return value
}

function booleanField(fields: Fields, key: string): boolean {
  const value = fields[key]
  if (typeof value !== 'boolean') throw new IpcInputError(`${key} must be a boolean`)
  return value
}

export function parseBuildersSetOrdinaryCountInput(value: unknown): BuildersSetOrdinaryCountInput {
  const f = asObject(value, ['count', 'note'], 'ordinary Builder Hut count')
  return { count: boundedInt(f, 'count', 0, ORDINARY_BUILDER_HUT_MAX), ...noteField(f) }
}

export function parseBuildersSetBobInput(value: unknown): BuildersSetBobInput {
  const f = asObject(value, ['unlocked', 'note'], 'B.O.B. ownership')
  return { unlocked: booleanField(f, 'unlocked'), ...noteField(f) }
}

export function parseBuildersReclassifyLegacyInput(value: unknown): BuildersReclassifyLegacyInput {
  const f = asObject(value, ['ordinaryCount', 'bob', 'note'], 'legacy builder reclassification')
  const bob = f['bob']
  if (bob !== true && bob !== false && bob !== 'unsure') {
    throw new IpcInputError("bob must be true, false or 'unsure'")
  }
  return { ordinaryCount: boundedInt(f, 'ordinaryCount', 0, ORDINARY_BUILDER_HUT_MAX), bob, ...noteField(f) }
}

export function parseBuildersRemoveUnclassifiedInput(value: unknown): BuildersRemoveUnclassifiedInput {
  const f = asObject(value, ['id', 'note'], 'builder')
  return { id: positiveInt(f, 'id'), ...noteField(f) }
}

export function parseResearchSaveInput(value: unknown): ResearchSaveInput {
  const f = asObject(
    value,
    ['itemId', 'level', 'targetLevel', 'researchStartedAt', 'researchEndsAt', 'note'],
    'research'
  )
  return {
    itemId: itemIdField(f),
    level: positiveInt(f, 'level'),
    targetLevel: nullablePositiveInt(f, 'targetLevel'),
    researchStartedAt: nullableTimestamp(f, 'researchStartedAt'),
    researchEndsAt: nullableTimestamp(f, 'researchEndsAt'),
    ...noteField(f)
  }
}

export function parseResearchRemoveInput(value: unknown): ResearchRemoveInput {
  const f = asObject(value, ['itemId', 'note'], 'research')
  return { itemId: itemIdField(f), ...noteField(f) }
}

const SNAPSHOT_LIST_MAX = 200

export function parseSnapshotsListInput(value: unknown): SnapshotsListInput {
  if (value === undefined || value === null) return {}
  const f = asObject(value, ['limit'], 'snapshot query')
  const limit = optionalPositiveInt(f, 'limit')
  if (limit !== undefined && limit > SNAPSHOT_LIST_MAX) {
    throw new IpcInputError(`limit must be at most ${SNAPSHOT_LIST_MAX}`)
  }
  return limit === undefined ? {} : { limit }
}

// Bulk edits, legacy reconciliation and the edit log: shape and bounds only.
// Ownership, active-upgrade inclusion, coverage, Town Hall limits and legacy
// status are enforced by the edit service.

export function parseVillageItemsSetLevelsInput(value: unknown): VillageItemsSetLevelsInput {
  const f = asObject(value, ['itemId', 'level', 'instances', 'includeActiveUpgrades', 'note'], 'bulk level edit')
  const instances = f['instances'] === 'all' ? 'all' : idList(f, 'instances', { allowEmpty: false })
  const include = optionalIdList(f, 'includeActiveUpgrades')
  return {
    itemId: itemIdField(f),
    level: positiveInt(f, 'level'),
    instances,
    ...(include === undefined ? {} : { includeActiveUpgrades: include }),
    ...noteField(f)
  }
}

export function parseVillageItemsSetCountInput(value: unknown): VillageItemsSetCountInput {
  const f = asObject(
    value,
    ['itemId', 'count', 'levelForAdditions', 'removeInstances', 'includeActiveUpgrades', 'note'],
    'bulk count edit'
  )
  const count = nonNegativeInt(f, 'count')
  if (count > BULK_EDIT_MAX_ITEMS) throw new IpcInputError(`count must be at most ${BULK_EDIT_MAX_ITEMS}`)
  const levelForAdditions = optionalPositiveInt(f, 'levelForAdditions')
  const removeInstances = optionalIdList(f, 'removeInstances')
  const include = optionalIdList(f, 'includeActiveUpgrades')
  return {
    itemId: itemIdField(f),
    count,
    ...(levelForAdditions === undefined ? {} : { levelForAdditions }),
    ...(removeInstances === undefined ? {} : { removeInstances }),
    ...(include === undefined ? {} : { includeActiveUpgrades: include }),
    ...noteField(f)
  }
}

/** Mirrors LEGACY_KINDS without importing the database layer at runtime. */
const LEGACY_KINDS: readonly LegacyKind[] = ['building', 'hero', 'research']

function legacyKindField(fields: Fields): LegacyKind {
  const value = fields['kind']
  if (typeof value !== 'string' || !(LEGACY_KINDS as readonly string[]).includes(value)) {
    throw new IpcInputError(`kind must be one of: ${LEGACY_KINDS.join(', ')}`)
  }
  return value as LegacyKind
}

export function parseLegacyRecordRefInput(value: unknown): LegacyRecordRefInput {
  const f = asObject(value, ['kind', 'id', 'note'], 'legacy record')
  return { kind: legacyKindField(f), id: positiveInt(f, 'id'), ...noteField(f) }
}

export function parseLegacyMapInput(value: unknown): LegacyMapInput {
  const f = asObject(value, ['kind', 'id', 'itemId', 'level', 'note'], 'legacy mapping')
  const level = optionalPositiveInt(f, 'level')
  return {
    kind: legacyKindField(f),
    id: positiveInt(f, 'id'),
    itemId: itemIdField(f),
    ...(level === undefined ? {} : { level }),
    ...noteField(f)
  }
}

/** Exactly the format crypto.randomUUID() produces, which is how batch ids are made. */
const BATCH_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function batchIdField(fields: Fields): string {
  const value = fields['batchId']
  if (typeof value !== 'string' || !BATCH_ID_PATTERN.test(value)) {
    throw new IpcInputError('batchId must be a batch id')
  }
  return value
}

export function parseEditLogListInput(value: unknown): EditLogListInput {
  if (value === undefined || value === null) return {}
  const f = asObject(value, ['limit', 'beforeId', 'entityType', 'itemId', 'batchId'], 'edit log query')
  const limit = optionalPositiveInt(f, 'limit')
  if (limit !== undefined && limit > EDIT_LOG_PAGE_MAX_LIMIT) {
    throw new IpcInputError(`limit must be at most ${EDIT_LOG_PAGE_MAX_LIMIT}`)
  }
  const beforeId = optionalPositiveInt(f, 'beforeId')
  const entityType = f['entityType']
  if (entityType !== undefined && (typeof entityType !== 'string' || !(EDIT_ENTITY_TYPES as readonly string[]).includes(entityType))) {
    throw new IpcInputError(`entityType must be one of: ${EDIT_ENTITY_TYPES.join(', ')}`)
  }
  return {
    ...(limit === undefined ? {} : { limit }),
    ...(beforeId === undefined ? {} : { beforeId }),
    ...(entityType === undefined ? {} : { entityType: entityType as EditEntityType }),
    ...(f['itemId'] === undefined ? {} : { itemId: itemIdField(f) }),
    ...(f['batchId'] === undefined ? {} : { batchId: batchIdField(f) })
  }
}

export function parseEditLogGetBatchInput(value: unknown): EditLogGetBatchInput {
  const f = asObject(value, ['batchId'], 'request')
  return { batchId: batchIdField(f) }
}

const RECONCILIATION_STATUS_VALUES = ['pending', 'converted', 'dismissed'] as const

export function parseLegacyListInput(value: unknown): LegacyListInput {
  if (value === undefined || value === null) return {}
  const f = asObject(value, ['status'], 'legacy query')
  const status = f['status']
  if (status === undefined) return {}
  if (typeof status !== 'string' || !(RECONCILIATION_STATUS_VALUES as readonly string[]).includes(status)) {
    throw new IpcInputError(`status must be one of: ${RECONCILIATION_STATUS_VALUES.join(', ')}`)
  }
  return { status: status as LegacyListInput['status'] }
}

/** Generous transport limit; the parser enforces the real 1 MB export limit. */
const MAX_IMPORT_TEXT_CHARS = 2_000_000
const MAX_ACCEPTED_CHANGES = 1_000
const MAX_CHANGE_ID_LENGTH = 200

export function parseImportPreviewTextInput(value: unknown): ImportPreviewTextInput {
  const f = asObject(value, ['text'], 'import')
  const textValue = f['text']
  if (typeof textValue !== 'string') throw new IpcInputError('text must be a string')
  if (textValue.length > MAX_IMPORT_TEXT_CHARS) throw new IpcInputError('text is too large')
  return { text: textValue }
}

export function parseImportApplyInput(value: unknown): ImportApplyInput {
  const f = asObject(
    value,
    ['importId', 'acceptedChangeIds', 'conflictResolutions', 'ambiguityChoices'],
    'import apply'
  )
  const ids = f['acceptedChangeIds']
  if (
    !Array.isArray(ids) ||
    ids.length > MAX_ACCEPTED_CHANGES ||
    !ids.every((id) => typeof id === 'string' && id.length > 0 && id.length <= MAX_CHANGE_ID_LENGTH)
  ) {
    throw new IpcInputError('acceptedChangeIds must be a list of change ids')
  }
  const resolutions = f['conflictResolutions']
  if (typeof resolutions !== 'object' || resolutions === null || Array.isArray(resolutions)) {
    throw new IpcInputError('conflictResolutions must be an object')
  }
  const entries = Object.entries(resolutions as Record<string, unknown>)
  if (
    entries.length > MAX_ACCEPTED_CHANGES ||
    !entries.every(
      ([key, v]) => key.length <= MAX_CHANGE_ID_LENGTH && (v === 'keep-current' || v === 'apply-export')
    )
  ) {
    throw new IpcInputError('each conflict resolution must be keep-current or apply-export')
  }
  let ambiguityChoices: Record<string, string> = {}
  if (f['ambiguityChoices'] !== undefined) {
    const choices = f['ambiguityChoices']
    if (typeof choices !== 'object' || choices === null || Array.isArray(choices)) {
      throw new IpcInputError('ambiguityChoices must be an object')
    }
    const choiceEntries = Object.entries(choices as Record<string, unknown>)
    if (
      choiceEntries.length > MAX_ACCEPTED_CHANGES ||
      !choiceEntries.every(
        ([key, v]) =>
          key.length > 0 &&
          key.length <= MAX_CHANGE_ID_LENGTH &&
          typeof v === 'string' &&
          v.length > 0 &&
          v.length <= MAX_CHANGE_ID_LENGTH
      )
    ) {
      throw new IpcInputError('each ambiguity choice must map a change id to an interpretation id')
    }
    ambiguityChoices = Object.fromEntries(choiceEntries) as Record<string, string>
  }
  return {
    importId: positiveInt(f, 'importId'),
    acceptedChangeIds: ids as string[],
    conflictResolutions: Object.fromEntries(entries) as ImportApplyInput['conflictResolutions'],
    ambiguityChoices
  }
}

export function parseImportListInput(value: unknown): ImportListInput {
  if (value === undefined || value === null) return {}
  const f = asObject(value, ['limit'], 'import list')
  const limit = optionalPositiveInt(f, 'limit')
  if (limit !== undefined && limit > SNAPSHOT_LIST_MAX) {
    throw new IpcInputError(`limit must be at most ${SNAPSHOT_LIST_MAX}`)
  }
  return limit === undefined ? {} : { limit }
}

/** For channels that take no payload: reject anything other than undefined/null. */
export function parseEmptyInput(value: unknown): void {
  if (value !== undefined && value !== null) {
    throw new IpcInputError('this request takes no payload')
  }
}
