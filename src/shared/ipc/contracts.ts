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
import type { BuilderKind, StateSource } from '../../domain/village-state'
import type {
  LegacyKind,
  ReconciliationStatus
} from '../../database/repositories/legacy-record-repository'
import type { TownHallComparison, TownHallSummary } from '../../services/town-hall-service'
import type { EditAction, EditEntityType, JsonValue } from '../../domain/edit-log'
import type { ImportPlanSummary } from '../../services/import-service'
import type {
  ExportObservation,
  ImportStatus
} from '../../database/repositories/import-repository'
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
  buildersSetOrdinaryCount: 'builders:set-ordinary-count',
  buildersSetBob: 'builders:set-bob',
  buildersReclassifyLegacy: 'builders:reclassify-legacy',
  buildersRemoveUnclassified: 'builders:remove-unclassified',
  researchSave: 'research:save',
  researchRemove: 'research:remove',
  snapshotsCapture: 'snapshots:capture',
  snapshotsList: 'snapshots:list',
  snapshotsGet: 'snapshots:get',
  legacyList: 'legacy:list',
  legacyMap: 'legacy:map',
  legacyDismiss: 'legacy:dismiss',
  legacyRestore: 'legacy:restore',
  villageItemsSetLevels: 'village-items:set-levels',
  villageItemsSetCount: 'village-items:set-count',
  editLogList: 'edit-log:list',
  editLogGetBatch: 'edit-log:get-batch',
  importPreviewText: 'import:preview-text',
  importPreviewClipboard: 'import:preview-clipboard',
  importPreviewFile: 'import:preview-file',
  importApply: 'import:apply',
  importDiscard: 'import:discard',
  importList: 'import:list',
  importGetObservations: 'import:get-observations'
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
  kind: BuilderKind
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

/** Ids of the instances a bulk edit changed; batchId is null when nothing changed. */
export type BulkEditResultDto = {
  batchId: string | null
  created: number[]
  updated: number[]
  removed: number[]
}

/** What a legacy mapping created: item instances, or one research row. */
export type LegacyMapResultDto = {
  batchId: string
  entity: 'item-instance' | 'research'
  created: number[]
}

/** One manual edit. `before` is null for creates, `after` for deletes. */
export type EditLogEntryDto = {
  id: number
  entityType: EditEntityType
  entityId: number | null
  itemId: string | null
  action: EditAction
  before: JsonValue | null
  after: JsonValue | null
  batchId: string | null
  note: string | null
  createdAt: IsoTimestamp
}

/** Newest first. Pass nextBeforeId as beforeId for the next page; null on the last page. */
export type EditLogPageDto = {
  entries: EditLogEntryDto[]
  nextBeforeId: number | null
}

/** A previewed export: proposed changes, inferences, conflicts and everything not imported. */
export type ImportPreviewDto = {
  importId: number
  plan: ImportPlanSummary
}

export type ExportImportDto = {
  id: number
  /** Original export timestamp (Unix seconds), unchanged. */
  exportTimestamp: number
  status: ImportStatus
  dataVersion: string
  semanticsVersion: string
  previewedAt: IsoTimestamp
  appliedAt: IsoTimestamp | null
  discardedAt: IsoTimestamp | null
  summary: ImportPlanSummary
  applyResult: unknown | null
}

/** Every export entry exactly as observed (known fields only). */
export type ExportObservationDto = ExportObservation

// ---------------------------------------------------------------------------
// Inputs sent from the renderer (all operate on the local village)
// ---------------------------------------------------------------------------

/**
 * Optional reason stored in the edit log with a manual edit: null or 1 to
 * EDIT_NOTE_MAX_LENGTH characters, not only whitespace. Omitting it is the same as null.
 */
export type EditNoteInput = { note?: string | null }

export type VillageSaveInput = EditNoteInput & {
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
export type VillageItemSaveInput = EditNoteInput & {
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

export type VillageItemRemoveInput = IdInput & EditNoteInput

export type BuildersSetCountInput = EditNoteInput & { count: number }

/** 0-5 ordinary Home Village Builder Huts. */
export type BuildersSetOrdinaryCountInput = EditNoteInput & { count: number }
export type BuildersSetBobInput = EditNoteInput & { unlocked: boolean }
/** 'unsure' leaves B.O.B. ownership undecided; only ordinaryCount is applied. */
export type BuildersReclassifyLegacyInput = EditNoteInput & { ordinaryCount: number; bob: boolean | 'unsure' }
export type BuildersRemoveUnclassifiedInput = EditNoteInput & { id: number }

export type ResearchSaveInput = EditNoteInput & {
  itemId: string
  level: number
  targetLevel: number | null
  researchStartedAt: IsoTimestamp | null
  researchEndsAt: IsoTimestamp | null
}

export type ResearchRemoveInput = EditNoteInput & { itemId: string }

/** Upper bound on instance-id lists and counts in bulk edits. */
export const BULK_EDIT_MAX_ITEMS = 500

/**
 * Sets one level on the chosen instances (or 'all'). Upgrading instances must
 * be listed in includeActiveUpgrades; their upgrade is ended.
 */
export type VillageItemsSetLevelsInput = EditNoteInput & {
  itemId: string
  level: number
  instances: number[] | 'all'
  includeActiveUpgrades?: number[]
}

/** Adds idle instances at levelForAdditions, or removes instances, to reach count. */
export type VillageItemsSetCountInput = EditNoteInput & {
  itemId: string
  count: number
  levelForAdditions?: number
  removeInstances?: number[]
  includeActiveUpgrades?: number[]
}

export type LegacyRecordRefInput = EditNoteInput & { kind: LegacyKind; id: number }

/** level defaults to the archived level. */
export type LegacyMapInput = LegacyRecordRefInput & { itemId: string; level?: number }

export const EDIT_LOG_PAGE_DEFAULT_LIMIT = 50
export const EDIT_LOG_PAGE_MAX_LIMIT = 200

export type EditLogListInput = {
  limit?: number
  beforeId?: number
  entityType?: EditEntityType
  itemId?: string
  batchId?: string
}

export type EditLogGetBatchInput = { batchId: string }

export type SnapshotsListInput = { limit?: number }

export type LegacyListInput = { status?: ReconciliationStatus }

export type ImportPreviewTextInput = { text: string }

export type ImportApplyInput = {
  importId: number
  /** Changes to apply. Removals and conflicting changes must be listed individually. */
  acceptedChangeIds: string[]
  /** One decision per conflict on an accepted change, keyed `kind:recordId`. */
  conflictResolutions: Record<string, 'keep-current' | 'apply-export'>
  /**
   * The chosen interpretation id for every accepted `ambiguous-instances`
   * change, keyed by change id. Optional when no ambiguous change is accepted.
   */
  ambiguityChoices?: Record<string, string>
}

export type ImportListInput = { limit?: number }

// ---------------------------------------------------------------------------
// Results and errors
// ---------------------------------------------------------------------------

export const IPC_ERROR_CODES = [
  'VALIDATION_ERROR',
  'NOT_FOUND',
  'VILLAGE_NOT_INITIALISED',
  /** The bundled game data does not cover this yet; not the user's mistake. */
  'CATALOGUE_INCOMPLETE',
  /** The export text could not be read as a village export. */
  'IMPORT_INVALID',
  /** The village changed after the preview; preview again. */
  'STALE_PREVIEW',
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
  'village-items:remove': { request: VillageItemRemoveInput; response: null }
  'village-items:set-levels': { request: VillageItemsSetLevelsInput; response: BulkEditResultDto }
  'village-items:set-count': { request: VillageItemsSetCountInput; response: BulkEditResultDto }
  'builders:set-count': { request: BuildersSetCountInput; response: BuilderDto[] }
  'builders:set-ordinary-count': { request: BuildersSetOrdinaryCountInput; response: BuilderDto[] }
  'builders:set-bob': { request: BuildersSetBobInput; response: BuilderDto[] }
  'builders:reclassify-legacy': { request: BuildersReclassifyLegacyInput; response: BuilderDto[] }
  'builders:remove-unclassified': { request: BuildersRemoveUnclassifiedInput; response: null }
  'research:save': { request: ResearchSaveInput; response: ResearchStateDto }
  'research:remove': { request: ResearchRemoveInput; response: null }
  'snapshots:capture': { request: void; response: SnapshotDto }
  'snapshots:list': { request: SnapshotsListInput | void; response: SnapshotSummaryDto[] }
  'snapshots:get': { request: IdInput; response: SnapshotDto | null }
  'legacy:list': { request: LegacyListInput | void; response: LegacyRecordDto[] }
  'legacy:map': { request: LegacyMapInput; response: LegacyMapResultDto }
  /** pending -> dismissed; returns the updated record. */
  'legacy:dismiss': { request: LegacyRecordRefInput; response: LegacyRecordDto }
  /** dismissed -> pending; returns the updated record. */
  'legacy:restore': { request: LegacyRecordRefInput; response: LegacyRecordDto }
  'edit-log:list': { request: EditLogListInput | void; response: EditLogPageDto }
  /** NOT_FOUND when the batch has no entries. */
  'edit-log:get-batch': { request: EditLogGetBatchInput; response: EditLogEntryDto[] }
  'import:preview-text': { request: ImportPreviewTextInput; response: ImportPreviewDto }
  /** Reads the clipboard in the main process. */
  'import:preview-clipboard': { request: void; response: ImportPreviewDto }
  /** Opens a file picker in the main process; null when cancelled. */
  'import:preview-file': { request: void; response: ImportPreviewDto | null }
  'import:apply': { request: ImportApplyInput; response: ExportImportDto }
  'import:discard': { request: IdInput; response: ExportImportDto }
  'import:list': { request: ImportListInput | void; response: ExportImportDto[] }
  'import:get-observations': { request: IdInput; response: ExportObservationDto[] }
}

export type IpcRequest<C extends IpcChannel> = IpcContract[C]['request']
export type IpcResponse<C extends IpcChannel> = IpcContract[C]['response']

// ---------------------------------------------------------------------------
// API exposed to the renderer as window.clashForge
// ---------------------------------------------------------------------------

export type ClashForgeApi = {
  platform: string
  /** True only in the development sample-data mode: the village shown is synthetic. */
  sampleData: boolean
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
    remove: (input: VillageItemRemoveInput) => Promise<IpcResult<null>>
    setLevels: (input: VillageItemsSetLevelsInput) => Promise<IpcResult<BulkEditResultDto>>
    setCount: (input: VillageItemsSetCountInput) => Promise<IpcResult<BulkEditResultDto>>
  }
  builders: {
    setCount: (input: BuildersSetCountInput) => Promise<IpcResult<BuilderDto[]>>
    setOrdinaryCount: (input: BuildersSetOrdinaryCountInput) => Promise<IpcResult<BuilderDto[]>>
    setBob: (input: BuildersSetBobInput) => Promise<IpcResult<BuilderDto[]>>
    reclassifyLegacy: (input: BuildersReclassifyLegacyInput) => Promise<IpcResult<BuilderDto[]>>
    removeUnclassified: (input: BuildersRemoveUnclassifiedInput) => Promise<IpcResult<null>>
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
    map: (input: LegacyMapInput) => Promise<IpcResult<LegacyMapResultDto>>
    dismiss: (input: LegacyRecordRefInput) => Promise<IpcResult<LegacyRecordDto>>
    restore: (input: LegacyRecordRefInput) => Promise<IpcResult<LegacyRecordDto>>
  }
  editLog: {
    list: (input?: EditLogListInput) => Promise<IpcResult<EditLogPageDto>>
    getBatch: (input: EditLogGetBatchInput) => Promise<IpcResult<EditLogEntryDto[]>>
  }
  imports: {
    previewText: (input: ImportPreviewTextInput) => Promise<IpcResult<ImportPreviewDto>>
    previewClipboard: () => Promise<IpcResult<ImportPreviewDto>>
    previewFile: () => Promise<IpcResult<ImportPreviewDto | null>>
    apply: (input: ImportApplyInput) => Promise<IpcResult<ExportImportDto>>
    discard: (input: IdInput) => Promise<IpcResult<ExportImportDto>>
    list: (input?: ImportListInput) => Promise<IpcResult<ExportImportDto[]>>
    getObservations: (input: IdInput) => Promise<IpcResult<ExportObservationDto[]>>
  }
}
