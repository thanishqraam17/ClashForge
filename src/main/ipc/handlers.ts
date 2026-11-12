import type { ClashForgeDatabase } from '../../database/client/database'
import type { AssetService } from '../../services/asset-service'
import type { CatalogueService } from '../../services/catalogue-service'
import { toAssetUrl } from '../assets/asset-protocol'
import { TownHallRangeError, type TownHallService } from '../../services/town-hall-service'
import { UpgradeHistoryValidationError } from '../../domain/upgrade-history'
import { LOCAL_VILLAGE_ID, VillageValidationError } from '../../domain/village'
import { manualProvenance, VillageStateValidationError } from '../../domain/village-state'
import {
  CatalogueCoverageError,
  VillageNotInitialisedError,
  VillageStateNotFoundError,
  type VillageStateService
} from '../../services/village-state-service'
import {
  HISTORY_RECENT_DEFAULT_LIMIT,
  type IpcChannel,
  type IpcErrorCode,
  type IpcResponse,
  type IpcResult
} from '../../shared/ipc/contracts'
import {
  IpcInputError,
  parseAssetsResolveInput,
  parseBuildersSetCountInput,
  parseIdInput,
  parseLegacyListInput,
  parseResearchRemoveInput,
  parseResearchSaveInput,
  parseSnapshotsListInput,
  parseVillageItemSaveInput,
  parseCatalogueGetItemInput,
  parseCatalogueGetItemsInput,
  parseEmptyInput,
  parseHistoryGetRecentInput,
  parseHistoryRecordInput,
  parseTownHallCompareInput,
  parseTownHallGetItemInput,
  parseTownHallGetSummaryInput,
  parseVillageSaveInput
} from '../../shared/ipc/validation'
import {
  toBuilderDto,
  toCoverageDto,
  toLegacyRecordDto,
  toResearchStateDto,
  toSnapshotDto,
  toSnapshotSummaryDto,
  toUpgradeHistoryDto,
  toVillageDto,
  toVillageItemDto,
  toVillageStateDto
} from './dto-mappers'

/** Raised by handlers for expected failures that map to a specific error code. */
export class IpcHandlerError extends Error {
  constructor(
    readonly code: IpcErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'IpcHandlerError'
  }
}

export type IpcHandler<C extends IpcChannel> = (payload: unknown) => IpcResult<IpcResponse<C>>

export type IpcHandlerMap = { [C in IpcChannel]: IpcHandler<C> }

export type IpcLogger = {
  error: (message: string, error: unknown) => void
}

const DOMAIN_VALIDATION_ERRORS = [
  VillageValidationError,
  UpgradeHistoryValidationError,
  TownHallRangeError,
  VillageStateValidationError
]

function toDate(value: string): Date {
  return new Date(value)
}

function toDateOrNull(value: string | null): Date | null {
  return value === null ? null : new Date(value)
}

function mapServiceError(error: unknown): IpcErrorCode | null {
  if (error instanceof CatalogueCoverageError) return 'CATALOGUE_INCOMPLETE'
  if (error instanceof VillageNotInitialisedError) return 'VILLAGE_NOT_INITIALISED'
  if (error instanceof VillageStateNotFoundError) return 'NOT_FOUND'
  return null
}

/**
 * Wraps a handler body so that every outcome becomes an IpcResult. Expected
 * failures keep their message; unexpected ones are logged locally and returned
 * as a generic INTERNAL_ERROR so internals never leak to the renderer.
 */
function wrap<C extends IpcChannel>(
  channel: C,
  logger: IpcLogger,
  body: (payload: unknown) => IpcResponse<C>
): IpcHandler<C> {
  return (payload) => {
    try {
      return { ok: true, data: body(payload) }
    } catch (error) {
      if (error instanceof IpcHandlerError) {
        return { ok: false, error: { code: error.code, message: error.message } }
      }
      const mapped = mapServiceError(error)
      if (mapped) {
        return { ok: false, error: { code: mapped, message: (error as Error).message } }
      }
      if (
        error instanceof IpcInputError ||
        DOMAIN_VALIDATION_ERRORS.some((ErrorType) => error instanceof ErrorType)
      ) {
        return {
          ok: false,
          error: { code: 'VALIDATION_ERROR', message: (error as Error).message }
        }
      }
      logger.error(`[ClashForge] IPC handler "${channel}" failed`, error)
      return {
        ok: false,
        error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' }
      }
    }
  }
}

export type IpcHandlerDependencies = {
  database: ClashForgeDatabase
  catalogue: CatalogueService
  townHall: TownHallService
  assets: AssetService
  villageState: VillageStateService
  logger?: IpcLogger
}

export function createIpcHandlers({
  database,
  catalogue,
  townHall,
  assets,
  villageState,
  logger = console
}: IpcHandlerDependencies): IpcHandlerMap {
  function requireVillage(): void {
    if (database.villages.getVillage() === null) {
      throw new IpcHandlerError(
        'VILLAGE_NOT_INITIALISED',
        'Save the village before adding village items.'
      )
    }
  }

  return {
    'village:get-current': wrap('village:get-current', logger, (payload) => {
      parseEmptyInput(payload)
      const village = database.villages.getVillage()
      return village ? toVillageDto(village) : null
    }),

    'village:save': wrap('village:save', logger, (payload) => {
      const input = parseVillageSaveInput(payload)
      const village = database.villages.upsertVillage({
        ...input,
        lastScannedAt: toDateOrNull(input.lastScannedAt),
        ...manualProvenance()
      })
      return toVillageDto(village)
    }),

    'history:get-recent': wrap('history:get-recent', logger, (payload) => {
      const { limit = HISTORY_RECENT_DEFAULT_LIMIT } = parseHistoryGetRecentInput(payload)
      return database.upgradeHistory
        .getRecentByVillageId(LOCAL_VILLAGE_ID, limit)
        .map(toUpgradeHistoryDto)
    }),

    'history:record': wrap('history:record', logger, (payload) => {
      const input = parseHistoryRecordInput(payload)
      requireVillage()
      const entry = database.upgradeHistory.recordUpgrade({
        ...input,
        villageId: LOCAL_VILLAGE_ID,
        startedAt: toDate(input.startedAt),
        completedAt: toDateOrNull(input.completedAt)
      })
      return toUpgradeHistoryDto(entry)
    }),

    'catalogue:get-items': wrap('catalogue:get-items', logger, (payload) => {
      return catalogue.getItems(parseCatalogueGetItemsInput(payload))
    }),

    'catalogue:get-item': wrap('catalogue:get-item', logger, (payload) => {
      return catalogue.getItem(parseCatalogueGetItemInput(payload).id)
    }),

    'catalogue:get-dataset-info': wrap('catalogue:get-dataset-info', logger, (payload) => {
      parseEmptyInput(payload)
      return catalogue.getDatasetInfo()
    }),

    'town-hall:get-max': wrap('town-hall:get-max', logger, (payload) => {
      parseEmptyInput(payload)
      return {
        'home-village': townHall.getMaxTownHall('home-village'),
        'builder-base': townHall.getMaxTownHall('builder-base')
      }
    }),

    'town-hall:get-item': wrap('town-hall:get-item', logger, (payload) => {
      const input = parseTownHallGetItemInput(payload)
      return townHall.getItemAt(input.itemId, input.townHall)
    }),

    'town-hall:get-summary': wrap('town-hall:get-summary', logger, (payload) => {
      const input = parseTownHallGetSummaryInput(payload)
      return townHall.getSummary(input.townHall, input.gameMode)
    }),

    'town-hall:compare': wrap('town-hall:compare', logger, (payload) => {
      const input = parseTownHallCompareInput(payload)
      return townHall.compare(input.fromTownHall, input.toTownHall, input.gameMode)
    }),

    'assets:resolve': wrap('assets:resolve', logger, (payload) => {
      const input = parseAssetsResolveInput(payload)
      const resolution = assets.resolve(input.itemId, input.level ?? null)
      if (resolution.kind === 'placeholder') {
        return { kind: 'placeholder', itemId: resolution.itemId, url: null }
      }
      const { entry } = resolution
      return {
        kind: resolution.kind,
        itemId: resolution.itemId,
        url: toAssetUrl(entry.assetPath),
        level: entry.level,
        sourceName: entry.sourceName,
        sourceUrl: entry.sourceUrl,
        attribution: entry.attribution,
        lastVerifiedAt: entry.lastVerifiedAt
      }
    }),

    'assets:get-attributions': wrap('assets:get-attributions', logger, (payload) => {
      parseEmptyInput(payload)
      return assets.getAttributions()
    }),

    'village-state:get': wrap('village-state:get', logger, (payload) => {
      parseEmptyInput(payload)
      const state = villageState.getState()
      return state ? toVillageStateDto(state) : null
    }),

    'village-state:get-coverage': wrap('village-state:get-coverage', logger, (payload) => {
      parseEmptyInput(payload)
      return toCoverageDto(villageState.getCoverage())
    }),

    'village-items:save': wrap('village-items:save', logger, (payload) => {
      const input = parseVillageItemSaveInput(payload)
      const saved = villageState.saveItemInstance({
        ...input,
        upgradeStartedAt: toDateOrNull(input.upgradeStartedAt),
        upgradeEndsAt: toDateOrNull(input.upgradeEndsAt)
      })
      return toVillageItemDto(saved)
    }),

    'village-items:remove': wrap('village-items:remove', logger, (payload) => {
      villageState.removeItemInstance(parseIdInput(payload).id)
      return null
    }),

    'builders:set-count': wrap('builders:set-count', logger, (payload) => {
      return villageState.setBuilderCount(parseBuildersSetCountInput(payload).count).map(toBuilderDto)
    }),

    'research:save': wrap('research:save', logger, (payload) => {
      const input = parseResearchSaveInput(payload)
      const saved = villageState.saveResearch({
        ...input,
        researchStartedAt: toDateOrNull(input.researchStartedAt),
        researchEndsAt: toDateOrNull(input.researchEndsAt)
      })
      return toResearchStateDto(saved)
    }),

    'research:remove': wrap('research:remove', logger, (payload) => {
      villageState.removeResearch(parseResearchRemoveInput(payload).itemId)
      return null
    }),

    'snapshots:capture': wrap('snapshots:capture', logger, (payload) => {
      parseEmptyInput(payload)
      return toSnapshotDto(villageState.captureSnapshot('manual'))
    }),

    'snapshots:list': wrap('snapshots:list', logger, (payload) => {
      const { limit } = parseSnapshotsListInput(payload)
      return villageState.listSnapshots(limit).map(toSnapshotSummaryDto)
    }),

    'snapshots:get': wrap('snapshots:get', logger, (payload) => {
      const snapshot = villageState.getSnapshot(parseIdInput(payload).id)
      return snapshot ? toSnapshotDto(snapshot) : null
    }),

    'legacy:list': wrap('legacy:list', logger, (payload) => {
      const { status } = parseLegacyListInput(payload)
      return database.legacyRecords
        .list({ villageId: LOCAL_VILLAGE_ID, ...(status ? { status } : {}) })
        .map(toLegacyRecordDto)
    })
  }
}
