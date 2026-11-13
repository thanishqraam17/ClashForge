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
export const INSTANCE_CATEGORIES: readonly ItemCategory[] = [
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

/** The 5 gem-purchased Home Village Builder Huts. */
export const ORDINARY_BUILDER_HUT_MAX = 5
/** 5 ordinary huts + B.O.B. There is no other way to have more. */
export const HOME_VILLAGE_BUILDER_MAX = 6

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

/**
 * - `busy`: working on a recorded upgrade.
 * - `free`: idle, and every active upgrade has a known builder.
 * - `possibly-busy`: idle on record, but some upgrade's builder is unknown,
 *   so this builder may be the one doing it.
 */
export type BuilderStatus = 'busy' | 'free' | 'possibly-busy'

export type BuilderState = Builder & {
  /** Item instance this builder is upgrading, or null when idle. */
  assignedItemInstanceId: number | null
  status: BuilderStatus
}

/**
 * Builder availability, separating what is confirmed from what is estimated.
 * Laboratory research never affects it.
 */
/**
 * Confirmed Home Village builder ownership, separated from legacy rows that
 * have not been classified yet. Legacy rows still count as builders for
 * availability purposes, but never toward ordinaryConfirmed or bobConfirmed.
 */
export type HomeVillageBuilderOwnership = {
  ordinaryConfirmed: number
  bobConfirmed: boolean
  legacyUnclassified: number
  /** True when confirmed + legacy rows exceed the 6 that are ever possible. */
  exceedsLimit: boolean
}

export type BuilderAvailability = {
  total: number
  /** Upgrades with a recorded builder (confirmed or assigned). */
  busyAssigned: number
  /** Upgrades whose builder is unknown (imported data). */
  busyUnassigned: number
  /** Lowest possible number of free builders. */
  freeMin: number
  /** Highest possible number of free builders. */
  freeMax: number
  /**
   * True only when nothing is estimated: no unknown builders, every builder
   * row confirmed, and every recorded assignment confirmed.
   */
  isConfirmed: boolean
  /** More unknown-builder upgrades than idle builders: the builder count is likely out of date. */
  inconsistent: boolean
}

export type VillageState = {
  village: Village
  coverage: CatalogueCoverage
  builders: BuilderState[]
  builderAvailability: BuilderAvailability
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
  /** 0-5. Only ever touches rows already kind 'ordinary'; never legacy or bob rows. */
  setOrdinaryBuilderHuts: (count: number, provenance?: Provenance) => BuilderState[]
  /** Only ever touches the single 'bob' row; never legacy or ordinary rows. */
  setBobUnlocked: (unlocked: boolean, provenance?: Provenance) => BuilderState[]
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

export function summariseHomeVillageBuilderOwnership(builders: Builder[]): HomeVillageBuilderOwnership {
  const ordinaryConfirmed = builders.filter((b) => b.kind === 'ordinary').length
  const bobConfirmed = builders.some((b) => b.kind === 'bob')
  const legacyUnclassified = builders.filter((b) => b.kind === 'legacy-unclassified').length
  return {
    ordinaryConfirmed,
    bobConfirmed,
    legacyUnclassified,
    exceedsLimit: ordinaryConfirmed + (bobConfirmed ? 1 : 0) + legacyUnclassified > HOME_VILLAGE_BUILDER_MAX
  }
}

export function summariseBuilderAvailability(
  builders: BuilderState[],
  items: VillageItemInstance[]
): BuilderAvailability {
  const upgrading = items.filter((item) => item.targetLevel !== null)
  const busyAssigned = upgrading.filter((item) => item.builderId !== null).length
  const busyUnassigned = upgrading.filter((item) => item.builderAssignment === 'unknown').length
  const idle = builders.length - busyAssigned
  return {
    total: builders.length,
    busyAssigned,
    busyUnassigned,
    freeMin: Math.max(0, idle - busyUnassigned),
    freeMax: Math.max(0, idle),
    isConfirmed:
      busyUnassigned === 0 &&
      builders.every((builder) => builder.confirmedAt !== null) &&
      upgrading.every((item) => item.builderAssignment === 'confirmed'),
    inconsistent: busyUnassigned > idle
  }
}

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

  /** Lowest positive slot not already used by any builder of this village. */
  function nextFreeSlot(): number {
    const used = new Set(database.builders.listByVillage(villageId).map((b) => b.slot))
    let slot = 1
    while (used.has(slot)) slot += 1
    return slot
  }

  /**
   * Refuses to create `additional` more Home Village builders if doing so
   * would exceed the 6 that are ever possible, counting every existing row
   * regardless of kind (confirmed or still-unclassified legacy). Must run
   * inside the same transaction as the write that follows it.
   */
  function assertCanAddHomeVillageBuilders(additional: number): void {
    const all = database.builders.listByVillage(villageId)
    const projected = all.length + additional
    if (projected > HOME_VILLAGE_BUILDER_MAX) {
      const legacyCount = all.filter((b) => b.kind === 'legacy-unclassified').length
      const legacyNote =
        legacyCount > 0
          ? ` (including ${legacyCount} unclassified legacy builder${legacyCount === 1 ? '' : 's'}; reclassify or remove ${legacyCount === 1 ? 'it' : 'them'} first)`
          : ''
      throw new VillageStateValidationError(
        `This would give the village ${projected} Home Village builders, more than the maximum of ${HOME_VILLAGE_BUILDER_MAX}${legacyNote}`
      )
    }
  }

  function builderStates(items: VillageItemInstance[]): BuilderState[] {
    const assigned = new Map(
      items.filter((item) => item.builderId !== null).map((item) => [item.builderId!, item.id])
    )
    const anyUnknown = items.some((item) => item.builderAssignment === 'unknown')
    return database.builders.listByVillage(villageId).map((builder) => {
      const assignedItemInstanceId = assigned.get(builder.id) ?? null
      return {
        ...builder,
        assignedItemInstanceId,
        status:
          assignedItemInstanceId !== null ? 'busy' : anyUnknown ? 'possibly-busy' : 'free'
      }
    })
  }

  return {
    getCoverage,

    getState() {
      const village = database.villages.getVillage()
      if (village === null) return null
      const items = database.villageItems.listByVillage(villageId)
      const latest = database.snapshots.getLatest(villageId)
      const builders = builderStates(items)
      return {
        village,
        coverage: getCoverage(),
        builders,
        builderAvailability: summariseBuilderAvailability(builders, items),
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

          // Starting a builder upgrade needs a builder that is certainly free:
          // upgrades with an unknown builder may be occupying any idle builder.
          const existing = input.id === undefined ? null : database.villageItems.getById(input.id)
          const alreadyHoldsBuilder = existing !== null && existing.builderId === builder.id
          if (!alreadyHoldsBuilder) {
            const others = database.villageItems
              .listByVillage(villageId)
              .filter((i) => i.id !== input.id && i.targetLevel !== null)
            const busyAssigned = others.filter((i) => i.builderId !== null).length
            const unknown = others.filter((i) => i.builderAssignment === 'unknown').length
            const total = database.builders.listByVillage(villageId).length
            if (busyAssigned + unknown + 1 > total) {
              throw new VillageStateValidationError(
                `No builder is certainly free: ${unknown} upgrade${unknown === 1 ? ' has' : 's have'} an unknown builder. Resolve ${unknown === 1 ? 'it' : 'them'} before starting another upgrade.`
              )
            }
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
        const upgrading = database.villageItems.listByVillage(villageId).filter((i) => i.targetLevel !== null)
        const needed =
          upgrading.filter((i) => i.builderId !== null).length +
          upgrading.filter((i) => i.builderAssignment === 'unknown').length
        if (count < needed) {
          throw new VillageStateValidationError(
            `${needed} upgrades are in progress, so the village has at least ${needed} builders`
          )
        }
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
          if (!slots.has(slot)) {
            database.builders.create({ villageId, slot, kind: 'legacy-unclassified', ...provenance })
          }
        }
        return builderStates(database.villageItems.listByVillage(villageId))
      })
    },

    setOrdinaryBuilderHuts(count, provenance = manualProvenance()) {
      if (!Number.isInteger(count) || count < 0 || count > ORDINARY_BUILDER_HUT_MAX) {
        throw new VillageStateValidationError(
          `Ordinary Builder Huts must be between 0 and ${ORDINARY_BUILDER_HUT_MAX}`
        )
      }
      return database.transaction(() => {
        requireVillage()
        const ordinary = [...database.builders.listByVillageAndKind(villageId, 'ordinary')].sort(
          (a, b) => a.slot - b.slot
        )
        if (count < ordinary.length) {
          const keep = ordinary.slice(0, count)
          const excess = ordinary.slice(count)
          for (const builder of excess) {
            if (database.villageItems.getByBuilder(builder.id) !== null) {
              throw new VillageStateValidationError(
                `Ordinary Builder Hut ${builder.slot} is busy; finish or reassign its upgrade first`
              )
            }
          }
          for (const builder of excess) database.builders.delete(builder.id)
          for (const builder of keep) database.builders.update({ ...builder, ...provenance })
        } else {
          for (const builder of ordinary) database.builders.update({ ...builder, ...provenance })
          const toAdd = count - ordinary.length
          if (toAdd > 0) {
            assertCanAddHomeVillageBuilders(toAdd)
            let slot = nextFreeSlot()
            for (let i = 0; i < toAdd; i += 1) {
              database.builders.create({ villageId, slot, kind: 'ordinary', ...provenance })
              slot = nextFreeSlot()
            }
          }
        }
        return builderStates(database.villageItems.listByVillage(villageId))
      })
    },

    setBobUnlocked(unlocked, provenance = manualProvenance()) {
      return database.transaction(() => {
        requireVillage()
        const [existingBob = null] = database.builders.listByVillageAndKind(villageId, 'bob')
        if (unlocked) {
          if (existingBob !== null) {
            database.builders.update({ ...existingBob, ...provenance })
          } else {
            assertCanAddHomeVillageBuilders(1)
            database.builders.create({ villageId, slot: nextFreeSlot(), kind: 'bob', ...provenance })
          }
        } else if (existingBob !== null) {
          if (database.villageItems.getByBuilder(existingBob.id) !== null) {
            throw new VillageStateValidationError('B.O.B. is busy; finish or reassign its upgrade first')
          }
          database.builders.delete(existingBob.id)
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
