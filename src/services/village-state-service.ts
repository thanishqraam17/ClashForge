import type { ClashForgeDatabase } from '../database/client/database'
import type { ReconciliationStatus } from '../database/repositories/legacy-record-repository'
import type { CatalogueItem, GameCatalogue, ItemCategory, ValidationStatus } from '../domain/catalogue'
import { LOCAL_VILLAGE_ID, type Village } from '../domain/village'
import {
  manualProvenance,
  VillageStateValidationError,
  type Builder,
  type Provenance,
  type ResearchState,
  type StateSource,
  type VillageItemInstance,
  type VillageSnapshot
} from '../domain/village-state'
import type { TownHallService } from './town-hall-service'

// ---------------------------------------------------------------------------
// Errors with distinct meanings for callers
// ---------------------------------------------------------------------------

/** The bundled game data cannot support this operation yet (not a user mistake). */
export class CatalogueCoverageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CatalogueCoverageError'
  }
}

export class VillageNotInitialisedError extends Error {
  constructor() {
    super('Save the village before recording its state.')
    this.name = 'VillageNotInitialisedError'
  }
}

export class VillageStateNotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VillageStateNotFoundError'
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Builder-upgraded categories stored as item instances. */
const INSTANCE_CATEGORIES: readonly ItemCategory[] = [
  'town-hall',
  'resource',
  'army',
  'defense',
  'trap',
  'wall',
  'hero',
  'other'
]
/** Laboratory categories stored as research. */
const RESEARCH_CATEGORIES: readonly ItemCategory[] = ['troop', 'spell', 'siege-machine']

export const MAX_BUILDERS = 10

export type CatalogueCoverage = {
  datasetVersion: string
  validationStatus: ValidationStatus
  /** Home Village items in the bundled catalogue. */
  catalogueItemCount: number
  /** Highest Home Village Town Hall with rules, or null when unknown. */
  maxTownHall: number | null
  villageTownHall: number | null
  /** Whether item instances and research can be recorded right now. */
  canRecordItems: boolean
  /** Why recording is unavailable; null when it is available. */
  reason: string | null
}

export type BuilderState = Builder & {
  /** Item instance this builder is upgrading, or null when idle. */
  assignedItemInstanceId: number | null
}

export type VillageState = {
  village: Village
  coverage: CatalogueCoverage
  builders: BuilderState[]
  items: VillageItemInstance[]
  research: ResearchState[]
  activeResearch: ResearchState | null
  latestSnapshot: { id: number; capturedAt: Date; source: StateSource } | null
  legacyRecords: Record<ReconciliationStatus, number>
}

export type ItemInstanceInput = {
  /** Omit to create a new instance. */
  id?: number
  itemId: string
  instanceNumber: number
  level: number
  targetLevel: number | null
  upgradeStartedAt: Date | null
  upgradeEndsAt: Date | null
  builderId: number | null
}

export type ResearchInput = {
  itemId: string
  level: number
  targetLevel: number | null
  researchStartedAt: Date | null
  researchEndsAt: Date | null
}

export type VillageStateService = {
  getCoverage: () => CatalogueCoverage
  /** Null until the village has been saved. */
  getState: () => VillageState | null
  saveItemInstance: (input: ItemInstanceInput, provenance?: Provenance) => VillageItemInstance
  removeItemInstance: (id: number) => void
  setBuilderCount: (count: number, provenance?: Provenance) => BuilderState[]
  saveResearch: (input: ResearchInput, provenance?: Provenance) => ResearchState
  removeResearch: (itemId: string) => void
  captureSnapshot: (source?: StateSource) => VillageSnapshot
  listSnapshots: (limit?: number) => VillageSnapshot[]
  getSnapshot: (id: number) => VillageSnapshot | null
}

export type VillageStateServiceDependencies = {
  database: ClashForgeDatabase
  catalogue: GameCatalogue
  townHall: TownHallService
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export function createVillageStateService({
  database,
  catalogue,
  townHall
}: VillageStateServiceDependencies): VillageStateService {
  const villageId = LOCAL_VILLAGE_ID
  const homeItems = new Map(
    catalogue.items.filter((item) => item.gameMode === 'home-village').map((item) => [item.id, item])
  )
  const allItems = new Map(catalogue.items.map((item) => [item.id, item]))

  function getCoverage(): CatalogueCoverage {
    const village = database.villages.getVillage()
    const maxTownHall = townHall.getMaxTownHall('home-village')
    const base = {
      datasetVersion: catalogue.manifest.datasetVersion,
      validationStatus: catalogue.manifest.validationStatus,
      catalogueItemCount: homeItems.size,
      maxTownHall,
      villageTownHall: village?.townHallLevel ?? null
    }
    let reason: string | null = null
    if (homeItems.size === 0 || maxTownHall === null) {
      reason =
        'The bundled game catalogue has no Home Village items yet, so item levels and research cannot be recorded. Village resources, builders and snapshots still work.'
    } else if (village && village.townHallLevel > maxTownHall) {
      reason = `Town Hall ${village.townHallLevel} is newer than the bundled game data, which covers up to Town Hall ${maxTownHall}.`
    }
    return { ...base, canRecordItems: reason === null, reason }
  }

  function requireVillage(): Village {
    const village = database.villages.getVillage()
    if (village === null) throw new VillageNotInitialisedError()
    return village
  }

  /** Resolves a catalogue item and its limits at the village's Town Hall. */
  function requireRecordableItem(
    itemId: string,
    village: Village,
    allowed: readonly ItemCategory[],
    wrongKindMessage: string
  ): { item: CatalogueItem; maxLevel: number; maxQuantity: number } {
    const coverage = getCoverage()
    if (!coverage.canRecordItems) throw new CatalogueCoverageError(coverage.reason!)

    const item = allItems.get(itemId)
    if (!item) {
      throw new VillageStateValidationError(`"${itemId}" is not in the game catalogue`)
    }
    if (item.gameMode !== 'home-village') {
      throw new VillageStateValidationError('Builder Base items are not tracked yet')
    }
    if (!allowed.includes(item.category)) {
      throw new VillageStateValidationError(`${item.name} ${wrongKindMessage}`)
    }
    const limits = townHall.getItemAt(item.id, village.townHallLevel)
    if (limits === null) {
      throw new CatalogueCoverageError(`No Town Hall rules exist for ${item.name}`)
    }
    if (!limits.available) {
      throw new VillageStateValidationError(
        `${item.name} unlocks at Town Hall ${limits.unlocksAtTownHall}`
      )
    }
    return { item, maxLevel: limits.maxLevel, maxQuantity: limits.maxQuantity }
  }

  function checkLevels(name: string, level: number, targetLevel: number | null, maxLevel: number): void {
    if (level > maxLevel) {
      throw new VillageStateValidationError(
        `${name} cannot be above level ${maxLevel} at this Town Hall`
      )
    }
    if (targetLevel !== null && targetLevel > maxLevel) {
      throw new VillageStateValidationError(`${name} is already at its maximum level for this Town Hall`)
    }
  }

  function builderStates(items: VillageItemInstance[]): BuilderState[] {
    const assigned = new Map(
      items.filter((item) => item.builderId !== null).map((item) => [item.builderId!, item.id])
    )
    return database.builders.listByVillage(villageId).map((builder) => ({
      ...builder,
      assignedItemInstanceId: assigned.get(builder.id) ?? null
    }))
  }

  return {
    getCoverage,

    getState() {
      const village = database.villages.getVillage()
      if (village === null) return null
      const items = database.villageItems.listByVillage(villageId)
      const latest = database.snapshots.getLatest(villageId)
      return {
        village,
        coverage: getCoverage(),
        builders: builderStates(items),
        items,
        research: database.researchStates.listByVillage(villageId),
        activeResearch: database.researchStates.getActive(villageId),
        latestSnapshot: latest
          ? { id: latest.id, capturedAt: latest.capturedAt, source: latest.source }
          : null,
        legacyRecords: database.legacyRecords.countByStatus(villageId)
      }
    },

    saveItemInstance(input, provenance = manualProvenance()) {
      return database.transaction(() => {
        const village = requireVillage()
        const { item, maxLevel, maxQuantity } = requireRecordableItem(
          input.itemId,
          village,
          INSTANCE_CATEGORIES,
          'is upgraded in the Laboratory or another system; it cannot be recorded as a building'
        )
        if (input.instanceNumber > maxQuantity) {
          throw new VillageStateValidationError(
            `Town Hall ${village.townHallLevel} allows at most ${maxQuantity} ${item.name}`
          )
        }
        checkLevels(item.name, input.level, input.targetLevel, maxLevel)

        if (input.builderId !== null) {
          const builder = database.builders.getById(input.builderId)
          if (builder === null || builder.villageId !== villageId) {
            throw new VillageStateNotFoundError(`Builder ${input.builderId} does not exist`)
          }
          const busyWith = database.villageItems.getByBuilder(builder.id)
          if (busyWith !== null && busyWith.id !== input.id) {
            throw new VillageStateValidationError(
              `Builder ${builder.slot} is already upgrading another item`
            )
          }
        }

        const fields = {
          villageId,
          itemId: item.id,
          instanceNumber: input.instanceNumber,
          level: input.level,
          targetLevel: input.targetLevel,
          upgradeStartedAt: input.upgradeStartedAt,
          upgradeEndsAt: input.upgradeEndsAt,
          builderId: input.builderId,
          // A person entering an upgrade names its builder; other callers only record one.
          builderAssignment:
            input.targetLevel === null
              ? null
              : provenance.source === 'manual'
                ? ('confirmed' as const)
                : ('assigned' as const),
          upgradeObservedTimer: null,
          upgradeObservedAt: null,
          ...provenance
        }
        if (input.id === undefined) {
          const clash = database.villageItems
            .listByItem(villageId, item.id)
            .find((existing) => existing.instanceNumber === input.instanceNumber)
          if (clash) {
            throw new VillageStateValidationError(
              `${item.name} #${input.instanceNumber} is already recorded`
            )
          }
          return database.villageItems.create(fields)
        }
        const existing = database.villageItems.getById(input.id)
        if (existing === null || existing.villageId !== villageId) {
          throw new VillageStateNotFoundError(`Item instance ${input.id} does not exist`)
        }
        return database.villageItems.update({ ...existing, ...fields })
      })
    },

    removeItemInstance(id) {
      const existing = database.villageItems.getById(id)
      if (existing === null || existing.villageId !== villageId) {
        throw new VillageStateNotFoundError(`Item instance ${id} does not exist`)
      }
      database.villageItems.delete(id)
    },

    setBuilderCount(count, provenance = manualProvenance()) {
      if (!Number.isInteger(count) || count < 0 || count > MAX_BUILDERS) {
        throw new VillageStateValidationError(`Builder count must be between 0 and ${MAX_BUILDERS}`)
      }
      return database.transaction(() => {
        requireVillage()
        const current = database.builders.listByVillage(villageId)
        for (const builder of current) {
          if (builder.slot > count) {
            if (database.villageItems.getByBuilder(builder.id) !== null) {
              throw new VillageStateValidationError(
                `Builder ${builder.slot} is busy; finish or reassign its upgrade first`
              )
            }
            database.builders.delete(builder.id)
          } else {
            database.builders.update({ ...builder, ...provenance })
          }
        }
        const slots = new Set(current.map((builder) => builder.slot))
        for (let slot = 1; slot <= count; slot += 1) {
          if (!slots.has(slot)) database.builders.create({ villageId, slot, ...provenance })
        }
        return builderStates(database.villageItems.listByVillage(villageId))
      })
    },

    saveResearch(input, provenance = manualProvenance()) {
      return database.transaction(() => {
        const village = requireVillage()
        const { item, maxLevel } = requireRecordableItem(
          input.itemId,
          village,
          RESEARCH_CATEGORIES,
          'is not researched in the Laboratory'
        )
        checkLevels(item.name, input.level, input.targetLevel, maxLevel)

        if (input.targetLevel !== null) {
          const active = database.researchStates.getActive(villageId)
          if (active !== null && active.itemId !== item.id) {
            const activeName = allItems.get(active.itemId)?.name ?? active.itemId
            throw new VillageStateValidationError(`The Laboratory is already researching ${activeName}`)
          }
        }

        const fields = {
          villageId,
          itemId: item.id,
          level: input.level,
          targetLevel: input.targetLevel,
          researchStartedAt: input.researchStartedAt,
          researchEndsAt: input.researchEndsAt,
          ...provenance
        }
        const existing = database.researchStates.getByItem(villageId, item.id)
        return existing
          ? database.researchStates.update({ ...existing, ...fields })
          : database.researchStates.create(fields)
      })
    },

    removeResearch(itemId) {
      const existing = database.researchStates.getByItem(villageId, itemId)
      if (existing === null) {
        throw new VillageStateNotFoundError(`No research is recorded for "${itemId}"`)
      }
      database.researchStates.delete(existing.id)
    },

    captureSnapshot(source = 'manual') {
      requireVillage()
      return database.snapshots.capture({
        villageId,
        source,
        dataVersion: catalogue.manifest.datasetVersion
      })
    },

    listSnapshots(limit = 50) {
      return database.snapshots.list(villageId, limit)
    },

    getSnapshot(id) {
      const snapshot = database.snapshots.getById(id)
      return snapshot && snapshot.villageId === villageId ? snapshot : null
    }
  }
}
