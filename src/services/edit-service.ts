import { randomUUID } from 'crypto'
import type { ClashForgeDatabase } from '../database/client/database'
import {
  EDIT_NOTE_MAX_LENGTH,
  EditLogValidationError,
  type EditAction,
  type EditEntityType,
  type EditLogInput,
  type JsonValue
} from '../domain/edit-log'
import type { GameCatalogue } from '../domain/catalogue'
import { LOCAL_VILLAGE_ID, type Village, type VillagePersistInput } from '../domain/village'
import {
  manualProvenance,
  validateVillageItemInput,
  VillageStateValidationError,
  type VillageItemPersistInput,
  type Builder,
  type ResearchState,
  type VillageItemInstance
} from '../domain/village-state'
import { findTownHallViolations } from '../import/import-planner'
import type { LegacyKind, LegacyRecord } from '../database/repositories/legacy-record-repository'
import type { TownHallService } from './town-hall-service'
import {
  CatalogueCoverageError,
  INSTANCE_CATEGORIES,
  VillageNotInitialisedError,
  VillageStateNotFoundError,
  type BuilderState,
  type ItemInstanceInput,
  type ResearchInput,
  type VillageStateService
} from './village-state-service'

/**
 * The single entry point for manual village edits. Each operation runs in one
 * transaction on the app's one SQLite connection: read the record before,
 * apply the change through the existing validation (village-state service,
 * Town Hall limits, builder rules), read it after, and append one edit-log
 * entry. If anything throws, including the log write, everything rolls back.
 * Saves that change nothing persisted write no entry.
 *
 * Imports and the automatic legacy conversion are not logged here; they keep
 * their own records.
 */

export type VillageEditInput = Omit<VillagePersistInput, 'source' | 'confidence' | 'confirmedAt'>

export type EditService = {
  saveVillage: (input: VillageEditInput, note?: string | null) => Village
  saveItemInstance: (input: ItemInstanceInput, note?: string | null) => VillageItemInstance
  removeItemInstance: (id: number, note?: string | null) => void
  setBuilderCount: (count: number, note?: string | null) => BuilderState[]
  saveResearch: (input: ResearchInput, note?: string | null) => ResearchState
  removeResearch: (itemId: string, note?: string | null) => void
  /**
   * Sets one level on chosen (or all) instances of one item. Upgrading
   * instances must be listed in includeActiveUpgrades; their upgrade is ended.
   * Setting an upgrading instance to its target level (finishing it) is never
   * allowed in a bulk edit.
   */
  setItemLevels: (input: BulkLevelInput) => BulkEditResult
  /**
   * Adds or removes instances of one item to reach `count`. Additions are idle,
   * at levelForAdditions, numbered from the lowest free number. Removals are
   * the named instances, or by default idle instances, lowest level first,
   * then highest instance number; upgrading instances only when named and
   * included.
   */
  setItemCount: (input: BulkCountInput) => BulkEditResult
  /**
   * Converts a pending legacy record into manual, confirmed catalogue records:
   * `quantity` idle instances for a building, one idle hero, or one idle
   * research row. The archived record itself only changes reconciliation fields.
   */
  mapLegacyRecord: (input: LegacyMapInput) => LegacyMapResult
  /** pending -> dismissed. */
  dismissLegacyRecord: (input: LegacyRecordRef) => void
  /** dismissed -> pending. Converted records cannot be restored. */
  restoreLegacyRecord: (input: LegacyRecordRef) => void
}

export type LegacyRecordRef = { kind: LegacyKind; id: number; note?: string | null }

export type LegacyMapInput = LegacyRecordRef & {
  itemId: string
  /** Defaults to the archived level. */
  level?: number
}

export type LegacyMapResult = {
  batchId: string
  entity: 'item-instance' | 'research'
  created: number[]
}

export type BulkLevelInput = {
  itemId: string
  level: number
  instances: number[] | 'all'
  includeActiveUpgrades?: number[]
  note?: string | null
}

export type BulkCountInput = {
  itemId: string
  count: number
  levelForAdditions?: number
  removeInstances?: number[]
  includeActiveUpgrades?: number[]
  note?: string | null
}

/** batchId is null when nothing changed. */
export type BulkEditResult = {
  batchId: string | null
  created: number[]
  updated: number[]
  removed: number[]
}

export type EditServiceDependencies = {
  database: ClashForgeDatabase
  villageState: VillageStateService
  catalogue: GameCatalogue
  townHall: TownHallService
}

const iso = (date: Date | null): string | null => (date ? date.toISOString() : null)

// ---------------------------------------------------------------------------
// Logged states: every persisted field that can change, as plain JSON.
// Row ids and created/updated timestamps are bookkeeping and left out, so a
// save that changes nothing else compares equal.
// ---------------------------------------------------------------------------

export function villageLogState(village: Village): JsonValue {
  return {
    townHallLevel: village.townHallLevel,
    gold: village.gold,
    elixir: village.elixir,
    darkElixir: village.darkElixir,
    goldCapacity: village.goldCapacity,
    elixirCapacity: village.elixirCapacity,
    darkElixirCapacity: village.darkElixirCapacity,
    lastScannedAt: iso(village.lastScannedAt),
    source: village.source,
    confidence: village.confidence,
    confirmedAt: iso(village.confirmedAt)
  }
}

export function itemLogState(item: VillageItemInstance): JsonValue {
  return {
    itemId: item.itemId,
    instanceNumber: item.instanceNumber,
    level: item.level,
    targetLevel: item.targetLevel,
    upgradeStartedAt: iso(item.upgradeStartedAt),
    upgradeEndsAt: iso(item.upgradeEndsAt),
    builderId: item.builderId,
    builderAssignment: item.builderAssignment,
    upgradeObservedTimer: item.upgradeObservedTimer,
    upgradeObservedAt: iso(item.upgradeObservedAt),
    source: item.source,
    confidence: item.confidence,
    confirmedAt: iso(item.confirmedAt)
  }
}

export function researchLogState(research: ResearchState): JsonValue {
  return {
    itemId: research.itemId,
    level: research.level,
    targetLevel: research.targetLevel,
    researchStartedAt: iso(research.researchStartedAt),
    researchEndsAt: iso(research.researchEndsAt),
    source: research.source,
    confidence: research.confidence,
    confirmedAt: iso(research.confirmedAt)
  }
}

export function buildersLogState(builders: Builder[]): JsonValue {
  return {
    count: builders.length,
    builders: [...builders]
      .sort((a, b) => a.slot - b.slot)
      .map((b) => ({ id: b.id, slot: b.slot, source: b.source, confidence: b.confidence, confirmedAt: iso(b.confirmedAt) }))
  }
}

export function legacyLogState(record: LegacyRecord): JsonValue {
  return {
    kind: record.kind,
    name: record.name,
    category: record.category,
    level: record.level,
    quantity: record.quantity,
    isUpgrading: record.isUpgrading,
    upgradeStartedAt: iso(record.upgradeStartedAt),
    upgradeEndsAt: iso(record.upgradeEndsAt),
    status: record.status,
    mappedItemId: record.mappedItemId,
    note: record.note,
    reconciledAt: iso(record.reconciledAt),
    archivedAt: iso(record.archivedAt)
  }
}

const LEGACY_ENTITY = {
  building: 'legacy-building',
  hero: 'legacy-hero',
  research: 'legacy-research'
} as const

const RESEARCH_CATEGORIES: readonly string[] = ['troop', 'spell', 'siege-machine']

const same = (a: JsonValue | null, b: JsonValue | null): boolean => JSON.stringify(a) === JSON.stringify(b)

/** Clears every upgrade field: the recorded upgrade is ended, not finished. */
const endedUpgrade = () => ({
  targetLevel: null,
  upgradeStartedAt: null,
  upgradeEndsAt: null,
  builderId: null,
  builderAssignment: null,
  upgradeObservedTimer: null,
  upgradeObservedAt: null
})

/** Checked before anything is written, so an invalid note fails even when nothing changes. */
function checkNote(note: string | null): void {
  if (note === null) return
  if (typeof note !== 'string' || !note.trim()) throw new EditLogValidationError('note must be null or non-empty text')
  if (note.length > EDIT_NOTE_MAX_LENGTH) {
    throw new EditLogValidationError(`note must be at most ${EDIT_NOTE_MAX_LENGTH} characters`)
  }
}

export function createEditService({ database, villageState, catalogue, townHall }: EditServiceDependencies): EditService {
  const villageId = LOCAL_VILLAGE_ID
  const nameOf = (id: string) => catalogue.items.find((i) => i.id === id)?.name ?? id

  /** Appends one entry unless the persisted state did not change. */
  const log = (entry: {
    entityType: EditEntityType
    entityId: number | null
    itemId: string | null
    action: EditAction
    before: JsonValue | null
    after: JsonValue | null
    note: string | null
  }): void => {
    if (same(entry.before, entry.after)) return
    database.editLog.append({ villageId, batchId: null, ...entry })
  }

  /** A legacy record of this village, in the required status. */
  const requireLegacy = (kind: LegacyKind, id: number, status: LegacyRecord['status']): LegacyRecord => {
    if (!Object.hasOwn(LEGACY_ENTITY, kind)) {
      throw new VillageStateValidationError('kind must be building, hero or research')
    }
    if (!Number.isSafeInteger(id)) throw new VillageStateValidationError('id must be an integer')
    const record = database.legacyRecords.get(kind, id)
    if (record === null || record.villageId !== villageId) {
      throw new VillageStateNotFoundError(`No archived ${kind} record ${id}`)
    }
    if (record.status !== status) {
      throw new VillageStateValidationError(`Archived ${kind} "${record.name}" is ${record.status}, not ${status}`)
    }
    return record
  }

  // ---------------------------------------------------------------- bulk helpers

  /** The item's current instances, after checking it can be bulk-edited at all. */
  const requireBulkItem = (itemId: string): VillageItemInstance[] => {
    const village = database.villages.getVillage()
    if (village === null) throw new VillageNotInitialisedError()
    const coverage = villageState.getCoverage()
    if (!coverage.canRecordItems) throw new CatalogueCoverageError(coverage.reason!)
    const item = catalogue.items.find((i) => i.id === itemId)
    if (!item) throw new VillageStateValidationError(`"${itemId}" is not in the game catalogue`)
    if (item.gameMode !== 'home-village') {
      throw new VillageStateValidationError('Builder Base items are not tracked yet')
    }
    if (!INSTANCE_CATEGORIES.includes(item.category)) {
      throw new VillageStateValidationError(`${item.name} is not recorded as building instances`)
    }
    const limits = townHall.getItemAt(item.id, village.townHallLevel)
    if (limits === null) throw new CatalogueCoverageError(`No Town Hall rules exist for ${item.name}`)
    if (!limits.available) {
      throw new VillageStateValidationError(`${item.name} unlocks at Town Hall ${limits.unlocksAtTownHall}`)
    }
    return database.villageItems.listByItem(villageId, itemId)
  }

  /** Resolves a selection to instances of this item, rejecting duplicates and foreign ids. */
  const selectInstances = (current: VillageItemInstance[], ids: number[] | 'all'): VillageItemInstance[] => {
    if (ids === 'all') return current
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new VillageStateValidationError('instances must be "all" or a non-empty list of instance ids')
    }
    if (new Set(ids).size !== ids.length) throw new VillageStateValidationError('instances contains duplicates')
    const byId = new Map(current.map((i) => [i.id, i]))
    const foreign = ids.filter((id) => !byId.has(id))
    if (foreign.length > 0) {
      throw new VillageStateValidationError(`Not instances of this item: ${foreign.join(', ')}`)
    }
    return ids.map((id) => byId.get(id)!)
  }

  /** Validates the explicit active-upgrade opt-in list. */
  const checkIncluded = (current: VillageItemInstance[], ids: number[]): Set<number> => {
    if (!Array.isArray(ids)) throw new VillageStateValidationError('includeActiveUpgrades must be a list of instance ids')
    const byId = new Map(current.map((i) => [i.id, i]))
    for (const id of ids) {
      const instance = byId.get(id)
      if (!instance) throw new VillageStateValidationError(`includeActiveUpgrades: ${id} is not an instance of this item`)
      if (instance.targetLevel === null) {
        throw new VillageStateValidationError(`includeActiveUpgrades: #${instance.instanceNumber} has no active upgrade`)
      }
    }
    return new Set(ids)
  }

  /** Validates the complete resulting village, then writes everything and logs one batch. */
  const applyBulk = (
    itemId: string,
    plan: { updated: VillageItemInstance[]; created: VillageItemPersistInput[]; removed: VillageItemInstance[] },
    note: string | null
  ): BulkEditResult => {
    if (plan.updated.length + plan.created.length + plan.removed.length === 0) {
      return { batchId: null, created: [], updated: [], removed: [] }
    }
    for (const record of [...plan.updated, ...plan.created]) validateVillageItemInput(record)

    // The whole village as it would be after the edit, checked before any write.
    const removedIds = new Set(plan.removed.map((i) => i.id))
    const updatedById = new Map(plan.updated.map((i) => [i.id, i]))
    const resultingItems = [
      ...database.villageItems
        .listByVillage(villageId)
        .filter((i) => !removedIds.has(i.id))
        .map((i) => updatedById.get(i.id) ?? i),
      ...plan.created
    ]
    const village = database.villages.getVillage()!
    const violations = findTownHallViolations(
      resultingItems,
      database.researchStates.listByVillage(villageId),
      townHall,
      village.townHallLevel,
      nameOf
    )
    if (violations.length > 0) {
      throw new VillageStateValidationError(
        `This edit would leave the village above Town Hall ${village.townHallLevel} limits: ${violations.join('; ')}`
      )
    }

    const batchId = randomUUID()
    const entries: EditLogInput[] = []
    const result: BulkEditResult = { batchId, created: [], updated: [], removed: [] }
    const base = { villageId, entityType: 'item-instance' as const, itemId, batchId, note }

    for (const next of plan.updated) {
      const before = database.villageItems.getById(next.id)!
      const after = database.villageItems.update(next)
      entries.push({ ...base, entityId: after.id, action: 'update', before: itemLogState(before), after: itemLogState(after) })
      result.updated.push(after.id)
    }
    for (const gone of plan.removed) {
      database.villageItems.delete(gone.id)
      entries.push({ ...base, entityId: gone.id, action: 'delete', before: itemLogState(gone), after: null })
      result.removed.push(gone.id)
    }
    for (const input of plan.created) {
      const created = database.villageItems.create(input)
      entries.push({ ...base, entityId: created.id, action: 'create', before: null, after: itemLogState(created) })
      result.created.push(created.id)
    }
    database.editLog.appendMany(entries)
    return result
  }

  return {
    saveVillage(input, note = null) {
      checkNote(note)
      return database.transaction(() => {
        const existing = database.villages.getVillage()
        // A Town Hall decrease must not leave the village above the new limits (same rule as imports).
        if (existing && input.townHallLevel < existing.townHallLevel) {
          const violations = findTownHallViolations(
            database.villageItems.listByVillage(villageId),
            database.researchStates.listByVillage(villageId),
            townHall,
            input.townHallLevel,
            nameOf
          )
          if (violations.length > 0) {
            throw new VillageStateValidationError(
              `Town Hall ${input.townHallLevel} would leave the village above its limits: ${violations.join('; ')}`
            )
          }
        }
        const saved = database.villages.upsertVillage({ ...input, ...manualProvenance() })
        log({
          entityType: 'village',
          entityId: saved.id,
          itemId: null,
          action: existing ? 'update' : 'create',
          before: existing ? villageLogState(existing) : null,
          after: villageLogState(saved),
          note
        })
        return saved
      })
    },

    saveItemInstance(input, note = null) {
      checkNote(note)
      return database.transaction(() => {
        const existing = input.id === undefined ? null : database.villageItems.getById(input.id)
        const saved = villageState.saveItemInstance(input)
        log({
          entityType: 'item-instance',
          entityId: saved.id,
          itemId: saved.itemId,
          action: existing ? 'update' : 'create',
          before: existing ? itemLogState(existing) : null,
          after: itemLogState(saved),
          note
        })
        return saved
      })
    },

    removeItemInstance(id, note = null) {
      checkNote(note)
      database.transaction(() => {
        const existing = database.villageItems.getById(id)
        if (existing === null || existing.villageId !== villageId) {
          throw new VillageStateNotFoundError(`Item instance ${id} does not exist`)
        }
        villageState.removeItemInstance(id)
        log({
          entityType: 'item-instance',
          entityId: existing.id,
          itemId: existing.itemId,
          action: 'delete',
          before: itemLogState(existing),
          after: null,
          note
        })
      })
    },

    setBuilderCount(count, note = null) {
      checkNote(note)
      return database.transaction(() => {
        const before = buildersLogState(database.builders.listByVillage(villageId))
        const result = villageState.setBuilderCount(count)
        log({
          entityType: 'builders',
          entityId: null,
          itemId: null,
          action: 'set-count',
          before,
          after: buildersLogState(database.builders.listByVillage(villageId)),
          note
        })
        return result
      })
    },

    saveResearch(input, note = null) {
      checkNote(note)
      return database.transaction(() => {
        const existing = database.researchStates.getByItem(villageId, input.itemId)
        const saved = villageState.saveResearch(input)
        log({
          entityType: 'research',
          entityId: saved.id,
          itemId: saved.itemId,
          action: existing ? 'update' : 'create',
          before: existing ? researchLogState(existing) : null,
          after: researchLogState(saved),
          note
        })
        return saved
      })
    },

    removeResearch(itemId, note = null) {
      checkNote(note)
      database.transaction(() => {
        const existing = database.researchStates.getByItem(villageId, itemId)
        if (existing === null) {
          throw new VillageStateNotFoundError(`No research is recorded for "${itemId}"`)
        }
        villageState.removeResearch(itemId)
        log({
          entityType: 'research',
          entityId: existing.id,
          itemId: existing.itemId,
          action: 'delete',
          before: researchLogState(existing),
          after: null,
          note
        })
      })
    },

    setItemLevels({ itemId, level, instances, includeActiveUpgrades = [], note = null }) {
      checkNote(note)
      return database.transaction(() => {
        const current = requireBulkItem(itemId)
        if (!Number.isSafeInteger(level) || level < 1) {
          throw new VillageStateValidationError('level must be a positive integer')
        }
        const selected = selectInstances(current, instances)
        const included = checkIncluded(current, includeActiveUpgrades)

        const changed: VillageItemInstance[] = []
        const blockedUpgrades: number[] = []
        for (const instance of selected) {
          if (instance.targetLevel === null) {
            if (instance.level !== level) changed.push({ ...instance, level, ...manualProvenance() })
            continue
          }
          if (!included.has(instance.id)) {
            blockedUpgrades.push(instance.instanceNumber)
            continue
          }
          if (level === instance.targetLevel) {
            throw new VillageStateValidationError(
              `${nameOf(itemId)} #${instance.instanceNumber}: a bulk edit never finishes an upgrade; edit it on its own`
            )
          }
          changed.push({ ...instance, ...endedUpgrade(), level, ...manualProvenance() })
        }
        if (blockedUpgrades.length > 0) {
          throw new VillageStateValidationError(
            `${nameOf(itemId)} ${blockedUpgrades.map((n) => `#${n}`).join(', ')} ${blockedUpgrades.length === 1 ? 'has' : 'have'} an active upgrade; include ${blockedUpgrades.length === 1 ? 'it' : 'them'} explicitly to end the upgrade`
          )
        }

        return applyBulk(itemId, { updated: changed, created: [], removed: [] }, note)
      })
    },

    setItemCount({ itemId, count, levelForAdditions, removeInstances, includeActiveUpgrades = [], note = null }) {
      checkNote(note)
      return database.transaction(() => {
        const current = requireBulkItem(itemId)
        if (!Number.isSafeInteger(count) || count < 0) {
          throw new VillageStateValidationError('count must be a non-negative integer')
        }
        const included = checkIncluded(current, includeActiveUpgrades)

        if (count > current.length) {
          if (removeInstances !== undefined) {
            throw new VillageStateValidationError('removeInstances only applies when the count decreases')
          }
          if (levelForAdditions === undefined || !Number.isSafeInteger(levelForAdditions) || levelForAdditions < 1) {
            throw new VillageStateValidationError('levelForAdditions must be a positive integer when the count increases')
          }
          const used = new Set(current.map((i) => i.instanceNumber))
          const created: VillageItemPersistInput[] = []
          for (let n = 1; created.length < count - current.length; n += 1) {
            if (used.has(n)) continue
            created.push({
              villageId,
              itemId,
              instanceNumber: n,
              level: levelForAdditions,
              targetLevel: null,
              upgradeStartedAt: null,
              upgradeEndsAt: null,
              builderId: null,
              builderAssignment: null,
              upgradeObservedTimer: null,
              upgradeObservedAt: null,
              ...manualProvenance()
            })
          }
          return applyBulk(itemId, { updated: [], created, removed: [] }, note)
        }

        if (count === current.length) {
          if (removeInstances !== undefined && removeInstances.length > 0) {
            throw new VillageStateValidationError('removeInstances only applies when the count decreases')
          }
          return { batchId: null, created: [], updated: [], removed: [] }
        }

        const toRemove = current.length - count
        let removed: VillageItemInstance[]
        if (removeInstances !== undefined) {
          removed = selectInstances(current, removeInstances)
          if (removed.length !== toRemove) {
            throw new VillageStateValidationError(
              `removeInstances must name exactly ${toRemove} instance${toRemove === 1 ? '' : 's'}`
            )
          }
          const blocked = removed.filter((i) => i.targetLevel !== null && !included.has(i.id))
          if (blocked.length > 0) {
            throw new VillageStateValidationError(
              `${nameOf(itemId)} ${blocked.map((i) => `#${i.instanceNumber}`).join(', ')} ${blocked.length === 1 ? 'has' : 'have'} an active upgrade; include ${blocked.length === 1 ? 'it' : 'them'} explicitly to remove ${blocked.length === 1 ? 'it' : 'them'}`
            )
          }
        } else {
          // Default: idle instances only, lowest level first, then highest instance number.
          const idle = current
            .filter((i) => i.targetLevel === null)
            .sort((a, b) => a.level - b.level || b.instanceNumber - a.instanceNumber)
          if (idle.length < toRemove) {
            throw new VillageStateValidationError(
              `Only ${idle.length} ${nameOf(itemId)} ${idle.length === 1 ? 'is' : 'are'} idle; name the instances to remove explicitly`
            )
          }
          removed = idle.slice(0, toRemove)
        }
        return applyBulk(itemId, { updated: [], created: [], removed }, note)
      })
    },

    mapLegacyRecord({ kind, id, itemId, level, note = null }) {
      checkNote(note)
      return database.transaction(() => {
        const record = requireLegacy(kind, id, 'pending')
        const village = database.villages.getVillage()
        if (village === null) throw new VillageNotInitialisedError()
        const coverage = villageState.getCoverage()
        if (!coverage.canRecordItems) throw new CatalogueCoverageError(coverage.reason!)
        const item = catalogue.items.find((i) => i.id === itemId)
        if (!item) throw new VillageStateValidationError(`"${itemId}" is not in the game catalogue`)
        if (item.gameMode !== 'home-village') {
          throw new VillageStateValidationError('Builder Base items are not tracked yet')
        }
        const fits =
          kind === 'hero'
            ? item.category === 'hero'
            : kind === 'research'
              ? RESEARCH_CATEGORIES.includes(item.category)
              : item.category !== 'hero' && INSTANCE_CATEGORIES.includes(item.category)
        if (!fits) throw new VillageStateValidationError(`${item.name} cannot be mapped from an archived ${kind}`)
        const limits = townHall.getItemAt(item.id, village.townHallLevel)
        if (limits === null) throw new CatalogueCoverageError(`No Town Hall rules exist for ${item.name}`)
        if (!limits.available) {
          throw new VillageStateValidationError(`${item.name} unlocks at Town Hall ${limits.unlocksAtTownHall}`)
        }
        const targetLevel = level ?? record.level
        if (!Number.isSafeInteger(targetLevel) || targetLevel < 1) {
          throw new VillageStateValidationError('level must be a positive integer')
        }

        const batchId = randomUUID()
        const before = legacyLogState(record)
        const entries: EditLogInput[] = []
        const created: number[] = []
        const base = { villageId, itemId: item.id, batchId, note }
        let entity: LegacyMapResult['entity']

        if (kind === 'research') {
          entity = 'research'
          if (database.researchStates.getByItem(villageId, item.id) !== null) {
            throw new VillageStateValidationError(`Research for ${item.name} is already recorded`)
          }
          // Idle at the chosen level; the existing research validation applies.
          const saved = villageState.saveResearch({
            itemId: item.id,
            level: targetLevel,
            targetLevel: null,
            researchStartedAt: null,
            researchEndsAt: null
          })
          created.push(saved.id)
          entries.push({ ...base, entityType: 'research', entityId: saved.id, action: 'create', before: null, after: researchLogState(saved) })
        } else {
          entity = 'item-instance'
          const used = new Set(database.villageItems.listByItem(villageId, item.id).map((i) => i.instanceNumber))
          const inputs: VillageItemPersistInput[] = []
          for (let n = 1; inputs.length < record.quantity; n += 1) {
            if (used.has(n)) continue
            inputs.push({ villageId, itemId: item.id, instanceNumber: n, level: targetLevel, ...endedUpgrade(), ...manualProvenance() })
          }
          for (const input of inputs) validateVillageItemInput(input)
          const violations = findTownHallViolations(
            [...database.villageItems.listByVillage(villageId), ...inputs],
            database.researchStates.listByVillage(villageId),
            townHall,
            village.townHallLevel,
            nameOf
          )
          if (violations.length > 0) {
            throw new VillageStateValidationError(
              `This mapping would leave the village above Town Hall ${village.townHallLevel} limits: ${violations.join('; ')}`
            )
          }
          for (const input of inputs) {
            const saved = database.villageItems.create(input)
            created.push(saved.id)
            entries.push({ ...base, entityType: 'item-instance', entityId: saved.id, action: 'create', before: null, after: itemLogState(saved) })
          }
        }

        database.legacyRecords.markConverted(kind, id, item.id, note ?? `Mapped manually to ${item.name}`)
        const converted = database.legacyRecords.get(kind, id)!
        entries.unshift({
          ...base,
          entityType: LEGACY_ENTITY[kind],
          entityId: id,
          action: 'map',
          before,
          after: {
            ...(legacyLogState(converted) as { [key: string]: JsonValue }),
            created: { entity, ids: created },
            legacyWasUpgrading: record.isUpgrading
          }
        })
        database.editLog.appendMany(entries)
        return { batchId, entity, created }
      })
    },

    dismissLegacyRecord({ kind, id, note = null }) {
      checkNote(note)
      database.transaction(() => {
        const record = requireLegacy(kind, id, 'pending')
        database.legacyRecords.markDismissed(kind, id, note)
        log({
          entityType: LEGACY_ENTITY[kind],
          entityId: id,
          itemId: null,
          action: 'dismiss',
          before: legacyLogState(record),
          after: legacyLogState(database.legacyRecords.get(kind, id)!),
          note
        })
      })
    },

    restoreLegacyRecord({ kind, id, note = null }) {
      checkNote(note)
      database.transaction(() => {
        const record = requireLegacy(kind, id, 'dismissed')
        database.legacyRecords.markRestored(kind, id, note)
        log({
          entityType: LEGACY_ENTITY[kind],
          entityId: id,
          itemId: null,
          action: 'update',
          before: legacyLogState(record),
          after: legacyLogState(database.legacyRecords.get(kind, id)!),
          note
        })
      })
    }
  }
}
