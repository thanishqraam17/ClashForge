import type {
  BuilderAvailabilityDto,
  BuilderDto,
  CatalogueItemDto,
  ItemAtTownHallDto,
  VillageItemDto,
  VillageStateDto
} from '../../../shared/ipc/contracts'

/**
 * Pure presentation logic for the My Village page. Everything here derives
 * from the server's state DTO; nothing decides whether an edit is allowed.
 * The edit service stays the authority and its rejections are shown as given.
 */

/** Town Hall limits per item id; undefined means not fetched yet. */
export type ItemLimits = Readonly<Record<string, ItemAtTownHallDto | null | undefined>>

export type ItemLimitView =
  | { status: 'unknown' }
  | { status: 'locked'; unlocksAtTownHall: number }
  | { status: 'available'; maxLevel: number; maxQuantity: number }

export type ItemGroup = {
  item: CatalogueItemDto
  /** Sorted by instance number. */
  instances: VillageItemDto[]
  count: number
  limit: ItemLimitView
  /** Only when the limit is known, unlocked and the count is below it. */
  canAdd: boolean
  /** Lowest positive instance number not in use. */
  nextFreeInstanceNumber: number
}

/** Categories recorded as building instances (mirrors INSTANCE_CATEGORIES in the service). */
export const INSTANCE_ITEM_CATEGORIES: readonly string[] = [
  'town-hall',
  'resource',
  'army',
  'defense',
  'trap',
  'wall',
  'hero',
  'other'
]

/** 5 gem-purchased ordinary Home Village Builder Huts. */
export const ORDINARY_BUILDER_HUT_MAX = 5
/** 5 ordinary huts + B.O.B. There is no other way to have more. */
export const HOME_VILLAGE_BUILDER_MAX = 6

/**
 * Confirmed Home Village builder ownership, separated from legacy rows that
 * have not been classified yet. Mirrors
 * summariseHomeVillageBuilderOwnership in village-state-service.ts, computed
 * here from the DTO the server already sends rather than needing its own
 * IPC round trip.
 */
export type HomeVillageBuilderOwnership = {
  ordinaryConfirmed: number
  bobConfirmed: boolean
  legacyUnclassified: number
  /** Every row, confirmed or not: what availability is computed from. */
  totalSlots: number
  /** True when confirmed + legacy rows exceed the 6 that are ever possible. */
  exceedsLimit: boolean
}

export function summariseHomeVillageBuilderOwnership(builders: readonly BuilderDto[]): HomeVillageBuilderOwnership {
  const ordinaryConfirmed = builders.filter((b) => b.kind === 'ordinary').length
  const bobConfirmed = builders.some((b) => b.kind === 'bob')
  const legacyUnclassified = builders.filter((b) => b.kind === 'legacy-unclassified').length
  return {
    ordinaryConfirmed,
    bobConfirmed,
    legacyUnclassified,
    totalSlots: builders.length,
    exceedsLimit: ordinaryConfirmed + (bobConfirmed ? 1 : 0) + legacyUnclassified > HOME_VILLAGE_BUILDER_MAX
  }
}

/**
 * Legacy-unclassified rows, for display and individual removal. The server
 * (reclassifyLegacyBuilders) decides consumption order on its own; this is
 * sorted by slot purely for a stable display.
 */
export function legacyUnclassifiedBuilders(builders: readonly BuilderDto[]): BuilderDto[] {
  return builders.filter((b) => b.kind === 'legacy-unclassified').sort((a, b) => a.slot - b.slot)
}

export function toLimitView(limit: ItemAtTownHallDto | null | undefined): ItemLimitView {
  if (limit === undefined || limit === null) return { status: 'unknown' }
  if (!limit.available) return { status: 'locked', unlocksAtTownHall: limit.unlocksAtTownHall }
  return { status: 'available', maxLevel: limit.maxLevel, maxQuantity: limit.maxQuantity }
}

export function nextFreeInstanceNumber(instances: readonly VillageItemDto[]): number {
  const used = new Set(instances.map((i) => i.instanceNumber))
  let n = 1
  while (used.has(n)) n += 1
  return n
}

/**
 * One group per Home Village catalogue item that is recorded as building
 * instances, in catalogue order. Instances of items missing from the catalogue
 * are left out (the service never creates them).
 */
export function buildItemGroups(
  state: VillageStateDto,
  catalogueItems: readonly CatalogueItemDto[],
  limits: ItemLimits
): ItemGroup[] {
  const byItem = new Map<string, VillageItemDto[]>()
  for (const instance of state.items) {
    const list = byItem.get(instance.itemId) ?? []
    list.push(instance)
    byItem.set(instance.itemId, list)
  }
  return catalogueItems
    .filter((item) => item.gameMode === 'home-village' && INSTANCE_ITEM_CATEGORIES.includes(item.category))
    .map((item) => {
      const instances = [...(byItem.get(item.id) ?? [])].sort((a, b) => a.instanceNumber - b.instanceNumber)
      const limit = toLimitView(limits[item.id])
      return {
        item,
        instances,
        count: instances.length,
        limit,
        canAdd: limit.status === 'available' && instances.length < limit.maxQuantity,
        nextFreeInstanceNumber: nextFreeInstanceNumber(instances)
      }
    })
}

/**
 * Builders the backend reports as certainly free. Possibly-busy builders are
 * never offered: an upgrade with an unknown builder may be using them.
 */
export function certainlyFreeBuilders(state: Pick<VillageStateDto, 'builders'>): BuilderDto[] {
  return state.builders.filter((b) => b.status === 'free').sort((a, b) => a.slot - b.slot)
}

/** Active upgrades whose builder is not known, which the player can assign. */
export function unknownBuilderUpgrades(state: Pick<VillageStateDto, 'items'>): VillageItemDto[] {
  return state.items
    .filter((i) => i.targetLevel !== null && i.builderAssignment === 'unknown')
    .sort((a, b) => a.itemId.localeCompare(b.itemId) || a.instanceNumber - b.instanceNumber)
}

export type AvailabilityLabel = {
  text: string
  estimated: boolean
  inconsistent: boolean
}

export function availabilityLabel(a: BuilderAvailabilityDto): AvailabilityLabel {
  const free = a.freeMin === a.freeMax ? `${a.freeMin}` : `${a.freeMin}–${a.freeMax}`
  const estimated = !a.isConfirmed
  return {
    text: `${estimated ? 'Estimated ' : ''}${free} of ${a.total} free`,
    estimated,
    inconsistent: a.inconsistent
  }
}

/** The instance a builder is working on, for slot rows. */
export function assignedInstance(state: Pick<VillageStateDto, 'items'>, builder: BuilderDto): VillageItemDto | null {
  if (builder.assignedItemInstanceId === null) return null
  return state.items.find((i) => i.id === builder.assignedItemInstanceId) ?? null
}
