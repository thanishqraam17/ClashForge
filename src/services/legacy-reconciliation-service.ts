import type { ClashForgeDatabase } from '../database/client/database'
import type { LegacyKind, LegacyRecord } from '../database/repositories/legacy-record-repository'
import type { CatalogueItem, GameCatalogue, ItemCategory } from '../domain/catalogue'
import { LOCAL_VILLAGE_ID } from '../domain/village'
import type { Provenance } from '../domain/village-state'
import type { VillageStateService } from './village-state-service'

/**
 * Converts archived legacy records (free-text names from before Phase 5) into
 * catalogue-based village state, but only when the mapping is reliable:
 *
 * - the name matches exactly one Home Village catalogue item of the right kind;
 * - the record was not mid-upgrade (the old model never stored which builder or
 *   target level, so that state cannot be reconstructed);
 * - the result passes the same validation as a manual save (Town Hall limits,
 *   free instance numbers, catalogue coverage).
 *
 * Anything else stays pending with a note explaining why, for the player to
 * reconcile by hand. Records are never deleted; converted ones stay archived.
 * Safe to run repeatedly.
 */

export type ReconciliationReport = {
  converted: number
  pending: number
  results: Array<{
    kind: LegacyKind
    id: number
    name: string
    outcome: 'converted' | 'pending'
    note: string
  }>
}

/** Values carried over from player-entered data, but not yet re-confirmed. */
const LEGACY_PROVENANCE: Provenance = { source: 'manual', confidence: 1, confirmedAt: null }

const KIND_CATEGORIES: Record<LegacyKind, readonly ItemCategory[]> = {
  building: ['town-hall', 'resource', 'army', 'defense', 'trap', 'wall', 'other'],
  hero: ['hero'],
  research: ['troop', 'spell', 'siege-machine']
}

function normalise(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ')
}

export type LegacyReconciliationDependencies = {
  database: ClashForgeDatabase
  catalogue: GameCatalogue
  villageState: VillageStateService
}

export function reconcileLegacyRecords({
  database,
  catalogue,
  villageState
}: LegacyReconciliationDependencies): ReconciliationReport {
  const report: ReconciliationReport = { converted: 0, pending: 0, results: [] }
  const pending = database.legacyRecords.list({ villageId: LOCAL_VILLAGE_ID, status: 'pending' })
  if (pending.length === 0) return report

  const coverage = villageState.getCoverage()
  const byName = new Map<string, CatalogueItem[]>()
  for (const item of catalogue.items) {
    if (item.gameMode !== 'home-village') continue
    const key = normalise(item.name)
    byName.set(key, [...(byName.get(key) ?? []), item])
  }

  const keepPending = (record: LegacyRecord, note: string): void => {
    database.legacyRecords.setPendingNote(record.kind, record.id, note)
    report.pending += 1
    report.results.push({ kind: record.kind, id: record.id, name: record.name, outcome: 'pending', note })
  }

  for (const record of pending) {
    if (!coverage.canRecordItems) {
      keepPending(record, `Waiting for game data: ${coverage.reason}`)
      continue
    }
    const matches = (byName.get(normalise(record.name)) ?? []).filter((item) =>
      KIND_CATEGORIES[record.kind].includes(item.category)
    )
    if (matches.length !== 1) {
      keepPending(
        record,
        matches.length === 0
          ? 'No catalogue item matches this name; reconcile it manually.'
          : 'Several catalogue items match this name; reconcile it manually.'
      )
      continue
    }
    if (record.isUpgrading) {
      keepPending(
        record,
        'Was mid-upgrade; the builder and target level were never recorded, so confirm it manually.'
      )
      continue
    }
    if (record.quantity < 1) {
      keepPending(record, 'Recorded quantity is zero; reconcile it manually.')
      continue
    }

    const item = matches[0]!
    try {
      database.transaction(() => {
        if (record.kind === 'research') {
          if (database.researchStates.getByItem(LOCAL_VILLAGE_ID, item.id) !== null) {
            throw new Error(`Research for ${item.name} is already recorded`)
          }
          villageState.saveResearch(
            {
              itemId: item.id,
              level: record.level,
              targetLevel: null,
              researchStartedAt: null,
              researchEndsAt: null
            },
            LEGACY_PROVENANCE
          )
        } else {
          const used = new Set(
            database.villageItems.listByItem(LOCAL_VILLAGE_ID, item.id).map((i) => i.instanceNumber)
          )
          let next = 1
          for (let created = 0; created < record.quantity; created += 1) {
            while (used.has(next)) next += 1
            villageState.saveItemInstance(
              {
                itemId: item.id,
                instanceNumber: next,
                level: record.level,
                targetLevel: null,
                upgradeStartedAt: null,
                upgradeEndsAt: null,
                builderId: null
              },
              LEGACY_PROVENANCE
            )
            used.add(next)
          }
        }
        database.legacyRecords.markConverted(
          record.kind,
          record.id,
          item.id,
          `Matched "${record.name}" to ${item.id}; values await confirmation.`
        )
      })
      report.converted += 1
      report.results.push({
        kind: record.kind,
        id: record.id,
        name: record.name,
        outcome: 'converted',
        note: `Converted to ${item.id}`
      })
    } catch (error) {
      keepPending(record, `Could not convert automatically: ${(error as Error).message}`)
    }
  }
  return report
}
