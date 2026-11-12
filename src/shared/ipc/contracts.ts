/**
 * Single source of truth for the main <-> renderer IPC surface.
 *
 * Rules:
 * - Every channel is listed in IPC_CHANNELS and described in IpcContract.
 * - Payloads and responses are plain serialisable DTOs. Timestamps are ISO 8601 UTC strings.
 * - Handlers never throw across the boundary; they return IpcResult.
 * - This module must stay free of Node, Electron and database imports so the
 *   renderer, preload and main process can all share it.
 */

import type {
  CatalogueItem,
  GameMode,
  ItemCategory,
  ValidationStatus
} from '../../domain/catalogue'
import type { ItemAtTownHall } from '../../domain/town-hall-rules'
import type { TownHallComparison, TownHallSummary } from '../../services/town-hall-service'
import {
  UPGRADE_HISTORY_ENTITY_TYPES,
  type UpgradeHistoryEntityType
} from '../../domain/upgrade-history'

export const IPC_CHANNELS = {
  villageGetCurrent: 'village:get-current',
  villageSave: 'village:save',
  buildingsList: 'buildings:list',
  buildingsSave: 'buildings:save',
  heroesList: 'heroes:list',
  heroesSave: 'heroes:save',
  researchList: 'research:list',
  researchSave: 'research:save',
  historyGetRecent: 'history:get-recent',
  historyRecord: 'history:record',
  catalogueGetItems: 'catalogue:get-items',
  catalogueGetItem: 'catalogue:get-item',
  catalogueGetDatasetInfo: 'catalogue:get-dataset-info',
  townHallGetMax: 'town-hall:get-max',
  townHallGetItem: 'town-hall:get-item',
  townHallGetSummary: 'town-hall:get-summary',
  townHallCompare: 'town-hall:compare'
} as const

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]

export const ALL_IPC_CHANNELS: readonly IpcChannel[] = Object.values(IPC_CHANNELS)

/** ISO 8601 UTC timestamp, e.g. 2026-09-14T10:30:00.000Z */
export type IsoTimestamp = string

// ---------------------------------------------------------------------------
// DTOs returned to the renderer
// ---------------------------------------------------------------------------

export type VillageDto = {
  id: number
  townHallLevel: number
  gold: number
  elixir: number
  darkElixir: number
  goldCapacity: number
  elixirCapacity: number
  darkElixirCapacity: number
  builderCount: number
  availableBuilders: number
  lastScannedAt: IsoTimestamp | null
  createdAt: IsoTimestamp
  updatedAt: IsoTimestamp
}

export type BuildingDto = {
  id: number
  villageId: number
  name: string
  category: string
  level: number
  quantity: number
  isUpgrading: boolean
  upgradeStartedAt: IsoTimestamp | null
  upgradeEndsAt: IsoTimestamp | null
  createdAt: IsoTimestamp
  updatedAt: IsoTimestamp
}

export type HeroDto = {
  id: number
  villageId: number
  name: string
  level: number
  isUpgrading: boolean
  upgradeStartedAt: IsoTimestamp | null
  upgradeEndsAt: IsoTimestamp | null
  createdAt: IsoTimestamp
  updatedAt: IsoTimestamp
}

export type ResearchDto = {
  id: number
  villageId: number
  name: string
  level: number
  category: string
  isResearching: boolean
  researchStartedAt: IsoTimestamp | null
  researchEndsAt: IsoTimestamp | null
  createdAt: IsoTimestamp
  updatedAt: IsoTimestamp
}

export { UPGRADE_HISTORY_ENTITY_TYPES }
export type UpgradeHistoryEntityTypeDto = UpgradeHistoryEntityType

export type UpgradeHistoryDto = {
  id: number
  villageId: number
  entityType: UpgradeHistoryEntityTypeDto
  entityName: string
  fromLevel: number
  toLevel: number
  startedAt: IsoTimestamp
  completedAt: IsoTimestamp | null
  createdAt: IsoTimestamp
}

/** Catalogue items are static plain data, so the DTO is the domain type itself. */
export type CatalogueItemDto = CatalogueItem

export type DatasetInfoDto = {
  datasetVersion: string
  gameVersion: string | null
  releasedAt: string
  validationStatus: ValidationStatus
  knownOmissions: string[]
  itemCount: number
  isStale: boolean
  ageInDays: number
}

/** Plain data already; re-exported under DTO names for the renderer. */
export type ItemAtTownHallDto = ItemAtTownHall
export type TownHallSummaryDto = TownHallSummary
export type TownHallComparisonDto = TownHallComparison
/** Highest Town Hall with data per game mode; null when not yet known. */
export type MaxTownHallDto = Record<GameMode, number | null>

// ---------------------------------------------------------------------------
// Inputs sent from the renderer (all operate on the local village)
// ---------------------------------------------------------------------------

export type VillageSaveInput = {
  townHallLevel: number
  gold: number
  elixir: number
  darkElixir: number
  goldCapacity: number
  elixirCapacity: number
  darkElixirCapacity: number
  builderCount: number
  availableBuilders: number
  lastScannedAt: IsoTimestamp | null
}

/** Omit `id` to create; provide an existing `id` to update. */
export type BuildingSaveInput = {
  id?: number
  name: string
  category: string
  level: number
  quantity: number
  isUpgrading: boolean
  upgradeStartedAt: IsoTimestamp | null
  upgradeEndsAt: IsoTimestamp | null
}

/** Omit `id` to create; provide an existing `id` to update. */
export type HeroSaveInput = {
  id?: number
  name: string
  level: number
  isUpgrading: boolean
  upgradeStartedAt: IsoTimestamp | null
  upgradeEndsAt: IsoTimestamp | null
}

/** Omit `id` to create; provide an existing `id` to update. */
export type ResearchSaveInput = {
  id?: number
  name: string
  level: number
  category: string
  isResearching: boolean
  researchStartedAt: IsoTimestamp | null
  researchEndsAt: IsoTimestamp | null
}

export type HistoryGetRecentInput = {
  /** Positive integer, at most HISTORY_RECENT_MAX_LIMIT. Omit for the default. */
  limit?: number
}

export const HISTORY_RECENT_DEFAULT_LIMIT = 50
export const HISTORY_RECENT_MAX_LIMIT = 500

export type HistoryRecordInput = {
  entityType: UpgradeHistoryEntityTypeDto
  entityName: string
  fromLevel: number
  toLevel: number
  startedAt: IsoTimestamp
  completedAt: IsoTimestamp | null
}

export type CatalogueGetItemsInput = {
  gameMode?: GameMode
  categories?: ItemCategory[]
  search?: string
  maxTownHall?: number
}

export type CatalogueGetItemInput = {
  id: string
}

export type TownHallGetItemInput = {
  itemId: string
  townHall: number
}

export type TownHallGetSummaryInput = {
  townHall: number
  gameMode?: GameMode
}

export type TownHallCompareInput = {
  fromTownHall: number
  toTownHall: number
  gameMode?: GameMode
}

// ---------------------------------------------------------------------------
// Results and errors
// ---------------------------------------------------------------------------

export const IPC_ERROR_CODES = [
  'VALIDATION_ERROR',
  'NOT_FOUND',
  'VILLAGE_NOT_INITIALISED',
  'FORBIDDEN',
  'INTERNAL_ERROR'
] as const

export type IpcErrorCode = (typeof IPC_ERROR_CODES)[number]

export type IpcError = {
  code: IpcErrorCode
  message: string
}

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: IpcError }

// ---------------------------------------------------------------------------
// Channel contract
// ---------------------------------------------------------------------------

export type IpcContract = {
  'village:get-current': { request: void; response: VillageDto | null }
  'village:save': { request: VillageSaveInput; response: VillageDto }
  'buildings:list': { request: void; response: BuildingDto[] }
  'buildings:save': { request: BuildingSaveInput; response: BuildingDto }
  'heroes:list': { request: void; response: HeroDto[] }
  'heroes:save': { request: HeroSaveInput; response: HeroDto }
  'research:list': { request: void; response: ResearchDto[] }
  'research:save': { request: ResearchSaveInput; response: ResearchDto }
  'history:get-recent': { request: HistoryGetRecentInput | void; response: UpgradeHistoryDto[] }
  'history:record': { request: HistoryRecordInput; response: UpgradeHistoryDto }
  'catalogue:get-items': {
    request: CatalogueGetItemsInput | void
    response: CatalogueItemDto[]
  }
  'catalogue:get-item': { request: CatalogueGetItemInput; response: CatalogueItemDto | null }
  'catalogue:get-dataset-info': { request: void; response: DatasetInfoDto }
  'town-hall:get-max': { request: void; response: MaxTownHallDto }
  'town-hall:get-item': { request: TownHallGetItemInput; response: ItemAtTownHallDto | null }
  'town-hall:get-summary': { request: TownHallGetSummaryInput; response: TownHallSummaryDto }
  'town-hall:compare': { request: TownHallCompareInput; response: TownHallComparisonDto }
}

export type IpcRequest<C extends IpcChannel> = IpcContract[C]['request']
export type IpcResponse<C extends IpcChannel> = IpcContract[C]['response']

// ---------------------------------------------------------------------------
// API exposed to the renderer as window.clashForge
// ---------------------------------------------------------------------------

export type ClashForgeApi = {
  platform: string
  village: {
    getCurrent: () => Promise<IpcResult<VillageDto | null>>
    save: (input: VillageSaveInput) => Promise<IpcResult<VillageDto>>
  }
  buildings: {
    list: () => Promise<IpcResult<BuildingDto[]>>
    save: (input: BuildingSaveInput) => Promise<IpcResult<BuildingDto>>
  }
  heroes: {
    list: () => Promise<IpcResult<HeroDto[]>>
    save: (input: HeroSaveInput) => Promise<IpcResult<HeroDto>>
  }
  research: {
    list: () => Promise<IpcResult<ResearchDto[]>>
    save: (input: ResearchSaveInput) => Promise<IpcResult<ResearchDto>>
  }
  history: {
    getRecent: (input?: HistoryGetRecentInput) => Promise<IpcResult<UpgradeHistoryDto[]>>
    record: (input: HistoryRecordInput) => Promise<IpcResult<UpgradeHistoryDto>>
  }
  catalogue: {
    getItems: (input?: CatalogueGetItemsInput) => Promise<IpcResult<CatalogueItemDto[]>>
    getItem: (input: CatalogueGetItemInput) => Promise<IpcResult<CatalogueItemDto | null>>
    getDatasetInfo: () => Promise<IpcResult<DatasetInfoDto>>
  }
  townHall: {
    getMax: () => Promise<IpcResult<MaxTownHallDto>>
    getItem: (input: TownHallGetItemInput) => Promise<IpcResult<ItemAtTownHallDto | null>>
    getSummary: (input: TownHallGetSummaryInput) => Promise<IpcResult<TownHallSummaryDto>>
    compare: (input: TownHallCompareInput) => Promise<IpcResult<TownHallComparisonDto>>
  }
}
