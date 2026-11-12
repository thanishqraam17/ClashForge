import type { ClashForgeDatabase } from '../database/client/database'
import {
  EDIT_NOTE_MAX_LENGTH,
  EditLogValidationError,
  type EditAction,
  type EditEntityType,
  type JsonValue
} from '../domain/edit-log'
import type { GameCatalogue } from '../domain/catalogue'
import { LOCAL_VILLAGE_ID, type Village, type VillagePersistInput } from '../domain/village'
import {
  manualProvenance,
  VillageStateValidationError,
  type Builder,
  type ResearchState,
  type VillageItemInstance
} from '../domain/village-state'
import { findTownHallViolations } from '../import/import-planner'
import type { TownHallService } from './town-hall-service'
import {
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

const same = (a: JsonValue | null, b: JsonValue | null): boolean => JSON.stringify(a) === JSON.stringify(b)

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
    }
  }
}
