import { isValidItemId, type ItemId } from './catalogue'

/**
 * Village state model: what a player owns and what is happening in their
 * village right now. Every stored value carries provenance (where it came
 * from, how confident we are, and whether a person confirmed it) so the app
 * never presents an estimate as fact.
 */

export const STATE_SOURCES = [
  'manual',
  'data-export',
  'screenshot',
  'live-capture',
  'timer-estimate'
] as const
export type StateSource = (typeof STATE_SOURCES)[number]

export type Provenance = {
  source: StateSource
  /** 0 (no confidence) to 1 (certain). */
  confidence: number
  /** When a person confirmed the value; null means unconfirmed or estimated. */
  confirmedAt: Date | null
}

export class VillageStateValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VillageStateValidationError'
  }
}

export function isStateSource(value: string): value is StateSource {
  return (STATE_SOURCES as readonly string[]).includes(value)
}

export function validateProvenance(input: Provenance): void {
  if (!isStateSource(input.source)) {
    throw new VillageStateValidationError('source is invalid')
  }
  if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) {
    throw new VillageStateValidationError('confidence must be between 0 and 1')
  }
  if (input.confirmedAt !== null && Number.isNaN(input.confirmedAt.getTime())) {
    throw new VillageStateValidationError('confirmedAt is invalid')
  }
}

/** Sources that come from game data rather than a person typing values in. */
export const IMPORTED_SOURCES: readonly StateSource[] = ['data-export', 'screenshot', 'live-capture']

/**
 * How sure we are which builder is doing an upgrade:
 * - `confirmed`: a person entered or confirmed the builder.
 * - `assigned`:  a builder is recorded but nobody has confirmed it.
 * - `unknown`:   no builder is recorded (imported data only; the export
 *                never says which builder is busy).
 */
export const BUILDER_ASSIGNMENTS = ['confirmed', 'assigned', 'unknown'] as const
export type BuilderAssignment = (typeof BUILDER_ASSIGNMENTS)[number]

/** Provenance for a value a person entered or confirmed by hand. */
export function manualProvenance(now: Date = new Date()): Provenance {
  return { source: 'manual', confidence: 1, confirmedAt: now }
}

function validateUpgradeWindow(
  label: string,
  level: number,
  targetLevel: number | null,
  startedAt: Date | null,
  endsAt: Date | null
): void {
  if (targetLevel === null) {
    if (startedAt !== null || endsAt !== null) {
      throw new VillageStateValidationError(`${label} timestamps require an active upgrade`)
    }
    return
  }
  if (targetLevel !== level + 1) {
    throw new VillageStateValidationError('targetLevel must be exactly one above level')
  }
  for (const [name, value] of [
    ['startedAt', startedAt],
    ['endsAt', endsAt]
  ] as const) {
    if (value !== null && Number.isNaN(value.getTime())) {
      throw new VillageStateValidationError(`${label} ${name} is invalid`)
    }
  }
  if (startedAt && endsAt && endsAt.getTime() < startedAt.getTime()) {
    throw new VillageStateValidationError(`${label} end cannot be before its start`)
  }
}

function validateItemReference(itemId: string, level: number): void {
  if (!isValidItemId(itemId)) {
    throw new VillageStateValidationError('itemId is not a valid catalogue item id')
  }
  if (!Number.isInteger(level) || level < 1) {
    throw new VillageStateValidationError('level must be a positive integer')
  }
}

// ---------------------------------------------------------------------------
// Item instances (buildings, defenses, traps, walls, heroes: builder upgrades)
// ---------------------------------------------------------------------------

export type VillageItemInstance = Provenance & {
  id: number
  villageId: number
  itemId: ItemId
  /** 1-based position among this village's instances of the same item. */
  instanceNumber: number
  level: number
  /** Level being upgraded to, or null when idle. Always level + 1. */
  targetLevel: number | null
  upgradeStartedAt: Date | null
  /** Expected completion; null when the timer is unknown. */
  upgradeEndsAt: Date | null
  /** Builder working on the upgrade; null when idle or when the builder is unknown. */
  builderId: number | null
  /** Set exactly when upgrading. */
  builderAssignment: BuilderAssignment | null
  /** Raw imported timer (seconds, as exported); null unless the upgrade came from an export. */
  upgradeObservedTimer: number | null
  /** Export time the timer was observed at; set together with upgradeObservedTimer. */
  upgradeObservedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export type VillageItemPersistInput = Omit<VillageItemInstance, 'id' | 'createdAt' | 'updatedAt'>

export function isUpgrading(instance: Pick<VillageItemInstance, 'targetLevel'>): boolean {
  return instance.targetLevel !== null
}

export function validateVillageItemInput(input: VillageItemPersistInput): void {
  if (!Number.isInteger(input.villageId) || input.villageId < 1) {
    throw new VillageStateValidationError('villageId must be at least 1')
  }
  validateItemReference(input.itemId, input.level)
  if (!Number.isInteger(input.instanceNumber) || input.instanceNumber < 1) {
    throw new VillageStateValidationError('instanceNumber must be a positive integer')
  }
  validateUpgradeWindow(
    'upgrade',
    input.level,
    input.targetLevel,
    input.upgradeStartedAt,
    input.upgradeEndsAt
  )
  validateProvenance(input)
  validateBuilderAssignment(input)
}

function validateBuilderAssignment(input: VillageItemPersistInput): void {
  const observed = input.upgradeObservedTimer !== null || input.upgradeObservedAt !== null
  if (input.targetLevel === null) {
    if (input.builderId !== null) {
      throw new VillageStateValidationError('only an active upgrade can have a builder')
    }
    if (input.builderAssignment !== null) {
      throw new VillageStateValidationError('only an active upgrade can have a builder assignment')
    }
    if (observed) {
      throw new VillageStateValidationError('only an active upgrade can have an observed timer')
    }
    return
  }

  if (input.builderAssignment === null) {
    throw new VillageStateValidationError('an active upgrade must state its builder assignment')
  }
  if (!(BUILDER_ASSIGNMENTS as readonly string[]).includes(input.builderAssignment)) {
    throw new VillageStateValidationError('builderAssignment is invalid')
  }
  if (input.builderAssignment === 'unknown') {
    if (input.builderId !== null) {
      throw new VillageStateValidationError('an unknown builder assignment cannot name a builder')
    }
    if (!IMPORTED_SOURCES.includes(input.source)) {
      throw new VillageStateValidationError('only imported data may leave the builder unknown')
    }
  } else if (input.builderId === null) {
    throw new VillageStateValidationError('an active upgrade must be assigned to a builder')
  }
  if (input.source === 'manual' && input.builderAssignment !== 'confirmed') {
    throw new VillageStateValidationError('a manual upgrade must have a confirmed builder')
  }

  if ((input.upgradeObservedTimer === null) !== (input.upgradeObservedAt === null)) {
    throw new VillageStateValidationError('an observed timer needs its observation time, and vice versa')
  }
  if (
    input.upgradeObservedTimer !== null &&
    (!Number.isInteger(input.upgradeObservedTimer) || input.upgradeObservedTimer < 0)
  ) {
    throw new VillageStateValidationError('upgradeObservedTimer must be a non-negative integer')
  }
  if (input.upgradeObservedAt !== null && Number.isNaN(input.upgradeObservedAt.getTime())) {
    throw new VillageStateValidationError('upgradeObservedAt is invalid')
  }
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

export type Builder = Provenance & {
  id: number
  villageId: number
  /** 1-based builder number shown to the player. */
  slot: number
  createdAt: Date
  updatedAt: Date
}

export type BuilderPersistInput = Omit<Builder, 'id' | 'createdAt' | 'updatedAt'>

export function validateBuilderInput(input: BuilderPersistInput): void {
  if (!Number.isInteger(input.villageId) || input.villageId < 1) {
    throw new VillageStateValidationError('villageId must be at least 1')
  }
  if (!Number.isInteger(input.slot) || input.slot < 1) {
    throw new VillageStateValidationError('slot must be a positive integer')
  }
  validateProvenance(input)
}

// ---------------------------------------------------------------------------
// Laboratory research (troops, spells, siege machines)
// ---------------------------------------------------------------------------

export type ResearchState = Provenance & {
  id: number
  villageId: number
  itemId: ItemId
  level: number
  targetLevel: number | null
  researchStartedAt: Date | null
  researchEndsAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export type ResearchStatePersistInput = Omit<ResearchState, 'id' | 'createdAt' | 'updatedAt'>

export function validateResearchStateInput(input: ResearchStatePersistInput): void {
  if (!Number.isInteger(input.villageId) || input.villageId < 1) {
    throw new VillageStateValidationError('villageId must be at least 1')
  }
  validateItemReference(input.itemId, input.level)
  validateUpgradeWindow(
    'research',
    input.level,
    input.targetLevel,
    input.researchStartedAt,
    input.researchEndsAt
  )
  validateProvenance(input)
}

// ---------------------------------------------------------------------------
// Snapshots: immutable records of the village state at a point in time
// ---------------------------------------------------------------------------

export const SNAPSHOT_SCHEMA_VERSION = 1

/** Plain, JSON-serialisable copy of the village state. Timestamps are ISO strings. */
export type VillageSnapshotPayload = {
  village: {
    townHallLevel: number
    gold: number
    elixir: number
    darkElixir: number
    goldCapacity: number
    elixirCapacity: number
    darkElixirCapacity: number
    lastScannedAt: string | null
    source: StateSource
    confidence: number
    confirmedAt: string | null
  }
  builders: Array<{
    slot: number
    source: StateSource
    confidence: number
    confirmedAt: string | null
  }>
  items: Array<{
    itemId: ItemId
    instanceNumber: number
    level: number
    targetLevel: number | null
    upgradeStartedAt: string | null
    upgradeEndsAt: string | null
    builderSlot: number | null
    source: StateSource
    confidence: number
    confirmedAt: string | null
  }>
  research: Array<{
    itemId: ItemId
    level: number
    targetLevel: number | null
    researchStartedAt: string | null
    researchEndsAt: string | null
    source: StateSource
    confidence: number
    confirmedAt: string | null
  }>
}

export type VillageSnapshot = {
  id: number
  villageId: number
  capturedAt: Date
  /** What prompted the snapshot (e.g. a manual save or a data export import). */
  source: StateSource
  /** Game dataset version in use when the snapshot was taken. */
  dataVersion: string
  schemaVersion: number
  payload: VillageSnapshotPayload
  createdAt: Date
}

/**
 * Builds the JSON payload for a snapshot from the current state. Pure: the
 * result shares no references with its inputs, so later changes to the live
 * state can never alter a snapshot.
 */
export function buildSnapshotPayload(state: {
  village: Omit<VillageSnapshotPayload['village'], 'lastScannedAt' | 'confirmedAt'> & {
    lastScannedAt: Date | null
    confirmedAt: Date | null
  }
  builders: Builder[]
  items: VillageItemInstance[]
  research: ResearchState[]
}): VillageSnapshotPayload {
  const iso = (date: Date | null): string | null => (date ? date.toISOString() : null)
  const slotById = new Map(state.builders.map((builder) => [builder.id, builder.slot]))

  return {
    village: {
      townHallLevel: state.village.townHallLevel,
      gold: state.village.gold,
      elixir: state.village.elixir,
      darkElixir: state.village.darkElixir,
      goldCapacity: state.village.goldCapacity,
      elixirCapacity: state.village.elixirCapacity,
      darkElixirCapacity: state.village.darkElixirCapacity,
      lastScannedAt: iso(state.village.lastScannedAt),
      source: state.village.source,
      confidence: state.village.confidence,
      confirmedAt: iso(state.village.confirmedAt)
    },
    builders: state.builders.map((builder) => ({
      slot: builder.slot,
      source: builder.source,
      confidence: builder.confidence,
      confirmedAt: iso(builder.confirmedAt)
    })),
    items: state.items.map((item) => ({
      itemId: item.itemId,
      instanceNumber: item.instanceNumber,
      level: item.level,
      targetLevel: item.targetLevel,
      upgradeStartedAt: iso(item.upgradeStartedAt),
      upgradeEndsAt: iso(item.upgradeEndsAt),
      builderSlot: item.builderId === null ? null : (slotById.get(item.builderId) ?? null),
      source: item.source,
      confidence: item.confidence,
      confirmedAt: iso(item.confirmedAt)
    })),
    research: state.research.map((entry) => ({
      itemId: entry.itemId,
      level: entry.level,
      targetLevel: entry.targetLevel,
      researchStartedAt: iso(entry.researchStartedAt),
      researchEndsAt: iso(entry.researchEndsAt),
      source: entry.source,
      confidence: entry.confidence,
      confirmedAt: iso(entry.confirmedAt)
    }))
  }
}
