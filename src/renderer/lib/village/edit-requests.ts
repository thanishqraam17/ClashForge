import type {
  BuildersReclassifyLegacyInput,
  BuildersRemoveUnclassifiedInput,
  BuildersSetBobInput,
  BuildersSetOrdinaryCountInput,
  VillageItemDto,
  VillageItemRemoveInput,
  VillageItemSaveInput,
  VillageItemsSetCountInput,
  VillageItemsSetLevelsInput
} from '../../../shared/ipc/contracts'
import { noteOf } from './village-form'

/**
 * Payload builders for the existing IPC channels. Each returns exactly the
 * channel's request type; the service validates and may reject any of them.
 */

/** The instance as it is now, in village-items:save form. */
export function currentInstanceInput(instance: VillageItemDto): VillageItemSaveInput {
  return {
    id: instance.id,
    itemId: instance.itemId,
    instanceNumber: instance.instanceNumber,
    level: instance.level,
    targetLevel: instance.targetLevel,
    upgradeStartedAt: instance.upgradeStartedAt,
    upgradeEndsAt: instance.upgradeEndsAt,
    builderId: instance.builderId
  }
}

const noUpgrade = {
  targetLevel: null,
  upgradeStartedAt: null,
  upgradeEndsAt: null,
  builderId: null
} as const

export function setLevelRequest(instance: VillageItemDto, level: number, note = ''): VillageItemSaveInput {
  return { ...currentInstanceInput(instance), level, ...noteOf(note) }
}

export function addInstanceRequest(itemId: string, instanceNumber: number, level: number, note = ''): VillageItemSaveInput {
  return { itemId, instanceNumber, level, ...noUpgrade, ...noteOf(note) }
}

export function removeInstanceRequest(instance: VillageItemDto, note = ''): VillageItemRemoveInput {
  return { id: instance.id, ...noteOf(note) }
}

/**
 * Starts an upgrade on an idle instance. The start time is not known (the
 * upgrade may have begun in game earlier), so it is left empty.
 */
export function startUpgradeRequest(
  instance: VillageItemDto,
  options: { targetLevel: number; builderId: number; upgradeEndsAt: string | null; note?: string }
): VillageItemSaveInput {
  return {
    ...currentInstanceInput(instance),
    targetLevel: options.targetLevel,
    upgradeStartedAt: null,
    upgradeEndsAt: options.upgradeEndsAt,
    builderId: options.builderId,
    ...noteOf(options.note ?? '')
  }
}

/** Finishing: the level becomes the target and every upgrade field is cleared. */
export function finishUpgradeRequest(instance: VillageItemDto, note = ''): VillageItemSaveInput {
  if (instance.targetLevel === null) throw new Error('This instance has no active upgrade')
  return { ...currentInstanceInput(instance), level: instance.targetLevel, ...noUpgrade, ...noteOf(note) }
}

/** Cancelling: every upgrade field is cleared and the current level is kept. */
export function cancelUpgradeRequest(instance: VillageItemDto, note = ''): VillageItemSaveInput {
  if (instance.targetLevel === null) throw new Error('This instance has no active upgrade')
  return { ...currentInstanceInput(instance), ...noUpgrade, ...noteOf(note) }
}

/** Records which builder works on an existing upgrade; the upgrade itself is unchanged. */
export function assignBuilderRequest(instance: VillageItemDto, builderId: number, note = ''): VillageItemSaveInput {
  if (instance.targetLevel === null) throw new Error('This instance has no active upgrade')
  return { ...currentInstanceInput(instance), builderId, ...noteOf(note) }
}

/**
 * Bulk level edit. includeActiveUpgrades holds only upgrading instances that
 * are selected and explicitly ticked; nothing is ever added implicitly.
 */
export function bulkSetLevelsRequest(
  instances: readonly VillageItemDto[],
  options: { itemId: string; level: number; selection: readonly number[] | 'all'; endUpgrades: ReadonlySet<number>; note?: string }
): VillageItemsSetLevelsInput {
  const ids = options.selection === 'all' ? null : options.selection
  const selected = ids === null ? instances : instances.filter((i) => ids.includes(i.id))
  const include = selected.filter((i) => i.targetLevel !== null && options.endUpgrades.has(i.id)).map((i) => i.id)
  return {
    itemId: options.itemId,
    level: options.level,
    instances: options.selection === 'all' ? 'all' : [...options.selection],
    ...(include.length > 0 ? { includeActiveUpgrades: include } : {}),
    ...noteOf(options.note ?? '')
  }
}

/** Bulk count edit, with the same explicit opt-in for removing upgrading instances. */
export function bulkSetCountRequest(
  instances: readonly VillageItemDto[],
  options: {
    itemId: string
    count: number
    levelForAdditions?: number
    removeInstances?: readonly number[]
    endUpgrades: ReadonlySet<number>
    note?: string
  }
): VillageItemsSetCountInput {
  const removing = options.removeInstances ?? []
  const include = instances
    .filter((i) => removing.includes(i.id) && i.targetLevel !== null && options.endUpgrades.has(i.id))
    .map((i) => i.id)
  return {
    itemId: options.itemId,
    count: options.count,
    ...(options.levelForAdditions === undefined ? {} : { levelForAdditions: options.levelForAdditions }),
    ...(options.removeInstances === undefined ? {} : { removeInstances: [...options.removeInstances] }),
    ...(include.length > 0 ? { includeActiveUpgrades: include } : {}),
    ...noteOf(options.note ?? '')
  }
}

// ---------------------------------------------------------------------------
// Home Village builder ownership (ordinary huts, B.O.B., legacy reclassification)
// ---------------------------------------------------------------------------

export function setOrdinaryHutsRequest(count: number, note = ''): BuildersSetOrdinaryCountInput {
  return { count, ...noteOf(note) }
}

export function setBobRequest(unlocked: boolean, note = ''): BuildersSetBobInput {
  return { unlocked, ...noteOf(note) }
}

export function reclassifyLegacyRequest(
  ordinaryCount: number,
  bob: boolean | 'unsure',
  note = ''
): BuildersReclassifyLegacyInput {
  return { ordinaryCount, bob, ...noteOf(note) }
}

export function removeUnclassifiedRequest(id: number, note = ''): BuildersRemoveUnclassifiedInput {
  return { id, ...noteOf(note) }
}
