import type { ClashForgeDatabase } from '../../database/client/database'
import type { CatalogueService } from '../../services/catalogue-service'
import { BuildingValidationError } from '../../domain/building'
import { HeroValidationError } from '../../domain/hero'
import { ResearchValidationError } from '../../domain/research'
import { UpgradeHistoryValidationError } from '../../domain/upgrade-history'
import { LOCAL_VILLAGE_ID, VillageValidationError } from '../../domain/village'
import {
  HISTORY_RECENT_DEFAULT_LIMIT,
  type IpcChannel,
  type IpcErrorCode,
  type IpcResponse,
  type IpcResult
} from '../../shared/ipc/contracts'
import {
  IpcInputError,
  parseBuildingSaveInput,
  parseCatalogueGetItemInput,
  parseCatalogueGetItemsInput,
  parseEmptyInput,
  parseHeroSaveInput,
  parseHistoryGetRecentInput,
  parseHistoryRecordInput,
  parseResearchSaveInput,
  parseVillageSaveInput
} from '../../shared/ipc/validation'
import {
  toBuildingDto,
  toHeroDto,
  toResearchDto,
  toUpgradeHistoryDto,
  toVillageDto
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
  BuildingValidationError,
  HeroValidationError,
  ResearchValidationError,
  UpgradeHistoryValidationError
]

function toDate(value: string): Date {
  return new Date(value)
}

function toDateOrNull(value: string | null): Date | null {
  return value === null ? null : new Date(value)
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
  logger?: IpcLogger
}

export function createIpcHandlers({
  database,
  catalogue,
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

  /** Ensures an update targets an existing record that belongs to the local village. */
  function requireOwnedRecord(
    record: { villageId: number } | null,
    kind: string,
    id: number
  ): void {
    if (record === null || record.villageId !== LOCAL_VILLAGE_ID) {
      throw new IpcHandlerError('NOT_FOUND', `${kind} ${id} does not exist`)
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
        lastScannedAt: toDateOrNull(input.lastScannedAt)
      })
      return toVillageDto(village)
    }),

    'buildings:list': wrap('buildings:list', logger, (payload) => {
      parseEmptyInput(payload)
      return database.buildings.getByVillageId(LOCAL_VILLAGE_ID).map(toBuildingDto)
    }),

    'buildings:save': wrap('buildings:save', logger, (payload) => {
      const { id, ...input } = parseBuildingSaveInput(payload)
      requireVillage()
      const fields = {
        ...input,
        villageId: LOCAL_VILLAGE_ID,
        upgradeStartedAt: toDateOrNull(input.upgradeStartedAt),
        upgradeEndsAt: toDateOrNull(input.upgradeEndsAt)
      }
      if (id === undefined) {
        return toBuildingDto(database.buildings.create(fields))
      }
      const existing = database.buildings.getById(id)
      requireOwnedRecord(existing, 'Building', id)
      return toBuildingDto(database.buildings.update({ ...existing!, ...fields }))
    }),

    'heroes:list': wrap('heroes:list', logger, (payload) => {
      parseEmptyInput(payload)
      return database.heroes.getByVillageId(LOCAL_VILLAGE_ID).map(toHeroDto)
    }),

    'heroes:save': wrap('heroes:save', logger, (payload) => {
      const { id, ...input } = parseHeroSaveInput(payload)
      requireVillage()
      const fields = {
        ...input,
        villageId: LOCAL_VILLAGE_ID,
        upgradeStartedAt: toDateOrNull(input.upgradeStartedAt),
        upgradeEndsAt: toDateOrNull(input.upgradeEndsAt)
      }
      if (id === undefined) {
        return toHeroDto(database.heroes.create(fields))
      }
      const existing = database.heroes.getById(id)
      requireOwnedRecord(existing, 'Hero', id)
      return toHeroDto(database.heroes.update({ ...existing!, ...fields }))
    }),

    'research:list': wrap('research:list', logger, (payload) => {
      parseEmptyInput(payload)
      return database.research.getByVillageId(LOCAL_VILLAGE_ID).map(toResearchDto)
    }),

    'research:save': wrap('research:save', logger, (payload) => {
      const { id, ...input } = parseResearchSaveInput(payload)
      requireVillage()
      const fields = {
        ...input,
        villageId: LOCAL_VILLAGE_ID,
        researchStartedAt: toDateOrNull(input.researchStartedAt),
        researchEndsAt: toDateOrNull(input.researchEndsAt)
      }
      if (id === undefined) {
        return toResearchDto(database.research.create(fields))
      }
      const existing = database.research.getById(id)
      requireOwnedRecord(existing, 'Research', id)
      return toResearchDto(database.research.update({ ...existing!, ...fields }))
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
    })
  }
}
