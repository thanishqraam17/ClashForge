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
import type { StateSource } from '../../domain/village-state'
import type {
  LegacyKind,
  ReconciliationStatus
} from '../../database/repositories/legacy-record-repository'
import type { TownHallComparison, TownHallSummary } from '../../services/town-hall-service'
import {
  UPGRADE_HISTORY_ENTITY_TYPES,
  type UpgradeHistoryEntityType
} from '../../domain/upgrade-history'

export const IPC_CHANNELS = {
  villageGetCurrent: 'village:get-current',
  villageSave: 'village:save',
  historyGetRecent: 'history:get-recent',
  historyRecord: 'history:record',
  catalogueGetItems: 'catalogue:get-items',
  catalogueGetItem: 'catalogue:get-item',
  catalogueGetDatasetInfo: 'catalogue:get-dataset-info',
  townHallGetMax: 'town-hall:get-max',
  townHallGetItem: 'town-hall:get-item',
  townHallGetSummary: 'town-hall:get-summary',
  townHallCompare: 'town-hall:compare',
  assetsResolve: 'assets:resolve',
  assetsGetAttributions: 'assets:get-attributions',
  villageStateGet: 'village-state:get',
  villageStateGetCoverage: 'village-state:get-coverage',
  villageItemsSave: 'village-items:save',
  villageItemsRemove: 'village-items:remove',
  buildersSetCount: 'builders:set-count',
  researchSave: 'research:save',
  researchRemove: 'research:remove',
  snapshotsCapture: 'snapshots:capture',
  snapshotsList: 'snapshots:list',
  snapshotsGet: 'snapshots:get',
  legacyList: 'legacy:list'
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
  lastScannedAt: IsoTimestamp | null
  source: StateSource
  confidence: number
  confirmedAt: IsoTimestamp | null
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

/**
 * Image for an item. `kind` tells the UI how to present it:
 * `generic` must be labelled as a generic (not level-specific) image, and
 * `placeholder` means no image is available (url is null).
 */
export type AssetResolutionDto =
  | {
      kind: 'exact-level' | 'canonical' | 'generic'
      itemId: string
      url: string
      level: number | null
      sourceName: string
      sourceUrl: string | null
      attribution: string
      lastVerifiedAt: string
    }
  | { kind: 'placeholder'; itemId: string; url: null }

export type AttributionDto = {
  sourceName: string
  sourceUrl: string | null
  attribution: string
}

/** Where a value came from and whether a person confirmed it. */
export type ProvenanceDto = {
  source: StateSource
  confidence: number
  /** Null means unconfirmed or estimated; present it as such. */
  confirmedAt: IsoTimestamp | null
}

export type CatalogueCoverageDto = {
  datasetVersion: string
  validationStatus: ValidationStatus
  catalogueItemCount: number
  maxTownHall: number | null
  villageTownHall: number | null
  /** False while the game data cannot support item or research records. */
  canRecordItems: boolean
  reason: string | null
}

export type BuilderDto = ProvenanceDto & {
  id: number
  slot: number
  assignedItemInstanceId: number | null
  /** `possibly-busy`: idle on record but an upgrade with an unknown builder exists. */
  status: 'busy' | 'free' | 'possibly-busy'
}

/** Show `freeMin`–`freeMax`; present it as estimated unless `isConfirmed`. */
export type BuilderAvailabilityDto = {
  total: number
  busyAssigned: number
  busyUnassigned: number
  freeMin: number
  freeMax: number
  isConfirmed: boolean
  inconsistent: boolean
}

export type VillageItemDto = ProvenanceDto & {
  id: number
  itemId: string
  instanceNumber: number
  level: number
  targetLevel: number | null
  upgradeStartedAt: IsoTimestamp | null
  upgradeEndsAt: IsoTimestamp | null
  builderId: number | null
  builderAssignment: 'confirmed' | 'assigned' | 'unknown' | null
  /** Raw imported timer (seconds, as exported) and the export time; null unless imported. */
  upgradeObservedTimer: number | null
  upgradeObservedAt: IsoTimestamp | null
}

export type ResearchStateDto = ProvenanceDto & {
  id: number
  itemId: string
  level: number
  targetLevel: number | null
  researchStartedAt: IsoTimestamp | null
  researchEndsAt: IsoTimestamp | null
}

export type SnapshotSummaryDto = {
  id: number
  capturedAt: IsoTimestamp
  source: StateSource
  dataVersion: string
  schemaVersion: number
}

export type SnapshotDto = SnapshotSummaryDto & {
  payload: import('../../domain/village-state').VillageSnapshotPayload
}

export type LegacyRecordCountsDto = Record<ReconciliationStatus, number>

export type VillageStateDto = {
  village: VillageDto
  coverage: CatalogueCoverageDto
  builders: BuilderDto[]
  builderAvailability: BuilderAvailabilityDto
  items: VillageItemDto[]
  research: ResearchStateDto[]
  activeResearchItemId: string | null
  latestSnapshot: { id: number; capturedAt: IsoTimestamp; source: StateSource } | null
  legacyRecords: LegacyRecordCountsDto
}

export type LegacyRecordDto = {
  kind: LegacyKind
  id: number
  name: string
  category: string | null
  level: number
  quantity: number
  isUpgrading: boolean
  upgradeStartedAt: IsoTimestamp | null
  upgradeEndsAt: IsoTimestamp | null
  status: ReconciliationStatus
  mappedItemId: string | null
  note: string | null
  reconciledAt: IsoTimestamp | null
  archivedAt: IsoTimestamp | null
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
  lastScannedAt: IsoTimestamp | null
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

export type AssetsResolveInput = {
  itemId: string
  /** Omit or null for the item's canonical image. */
  level?: number | null
}

/** Omit `id` to record a new instance. Manual saves are stored as confirmed. */
export type VillageItemSaveInput = {
  id?: number
  itemId: string
  instanceNumber: number
  level: number
  targetLevel: number | null
  upgradeStartedAt: IsoTimestamp | null
  upgradeEndsAt: IsoTimestamp | null
  builderId: number | null
}

export type IdInput = { id: number }

export type BuildersSetCountInput = { count: number }

export type ResearchSaveInput = {
  itemId: string
  level: number
  targetLevel: number | null
  researchStartedAt: IsoTimestamp | null
  researchEndsAt: IsoTimestamp | null
}

export type ResearchRemoveInput = { itemId: string }

export type SnapshotsListInput = { limit?: number }

export type LegacyListInput = { status?: ReconciliationStatus }

// ---------------------------------------------------------------------------
// Results and errors
// ---------------------------------------------------------------------------

export const IPC_ERROR_CODES = [
  'VALIDATION_ERROR',
  'NOT_FOUND',
  'VILLAGE_NOT_INITIALISED',
  /** The bundled game data does not cover this yet; not the user's mistake. */
  'CATALOGUE_INCOMPLETE',
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
  'assets:resolve': { request: AssetsResolveInput; response: AssetResolutionDto }
  'assets:get-attributions': { request: void; response: AttributionDto[] }
  'village-state:get': { request: void; response: VillageStateDto | null }
  'village-state:get-coverage': { request: void; response: CatalogueCoverageDto }
  'village-items:save': { request: VillageItemSaveInput; response: VillageItemDto }
  'village-items:remove': { request: IdInput; response: null }
  'builders:set-count': { request: BuildersSetCountInput; response: BuilderDto[] }
  'research:save': { request: ResearchSaveInput; response: ResearchStateDto }
  'research:remove': { request: ResearchRemoveInput; response: null }
  'snapshots:capture': { request: void; response: SnapshotDto }
  'snapshots:list': { request: SnapshotsListInput | void; response: SnapshotSummaryDto[] }
  'snapshots:get': { request: IdInput; response: SnapshotDto | null }
  'legacy:list': { request: LegacyListInput | void; response: LegacyRecordDto[] }
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
  assets: {
    resolve: (input: AssetsResolveInput) => Promise<IpcResult<AssetResolutionDto>>
    getAttributions: () => Promise<IpcResult<AttributionDto[]>>
  }
  villageState: {
    get: () => Promise<IpcResult<VillageStateDto | null>>
    getCoverage: () => Promise<IpcResult<CatalogueCoverageDto>>
  }
  villageItems: {
    save: (input: VillageItemSaveInput) => Promise<IpcResult<VillageItemDto>>
    remove: (input: IdInput) => Promise<IpcResult<null>>
  }
  builders: {
    setCount: (input: BuildersSetCountInput) => Promise<IpcResult<BuilderDto[]>>
  }
  research: {
    save: (input: ResearchSaveInput) => Promise<IpcResult<ResearchStateDto>>
    remove: (input: ResearchRemoveInput) => Promise<IpcResult<null>>
  }
  snapshots: {
    capture: () => Promise<IpcResult<SnapshotDto>>
    list: (input?: SnapshotsListInput) => Promise<IpcResult<SnapshotSummaryDto[]>>
    get: (input: IdInput) => Promise<IpcResult<SnapshotDto | null>>
  }
  legacy: {
    list: (input?: LegacyListInput) => Promise<IpcResult<LegacyRecordDto[]>>
  }
}
