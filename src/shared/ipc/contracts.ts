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
  historyRecord: 'history:record'
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
}
