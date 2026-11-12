import type { UpgradeHistory } from '../../domain/upgrade-history'
import type { Village } from '../../domain/village'
import type {
  UpgradeHistoryDto,
  VillageDto
} from '../../shared/ipc/contracts'

function iso(date: Date): string {
  return date.toISOString()
}

function isoOrNull(date: Date | null): string | null {
  return date ? date.toISOString() : null
}

export function toVillageDto(village: Village): VillageDto {
  return {
    id: village.id,
    townHallLevel: village.townHallLevel,
    gold: village.gold,
    elixir: village.elixir,
    darkElixir: village.darkElixir,
    goldCapacity: village.goldCapacity,
    elixirCapacity: village.elixirCapacity,
    darkElixirCapacity: village.darkElixirCapacity,
    lastScannedAt: isoOrNull(village.lastScannedAt),
    createdAt: iso(village.createdAt),
    updatedAt: iso(village.updatedAt)
  }
}

export function toUpgradeHistoryDto(entry: UpgradeHistory): UpgradeHistoryDto {
  return {
    id: entry.id,
    villageId: entry.villageId,
    entityType: entry.entityType,
    entityName: entry.entityName,
    fromLevel: entry.fromLevel,
    toLevel: entry.toLevel,
    startedAt: iso(entry.startedAt),
    completedAt: isoOrNull(entry.completedAt),
    createdAt: iso(entry.createdAt)
  }
}
