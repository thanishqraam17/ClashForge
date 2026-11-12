import type { Building } from '../../domain/building'
import type { Hero } from '../../domain/hero'
import type { Research } from '../../domain/research'
import type { UpgradeHistory } from '../../domain/upgrade-history'
import type { Village } from '../../domain/village'
import type {
  BuildingDto,
  HeroDto,
  ResearchDto,
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
    builderCount: village.builderCount,
    availableBuilders: village.availableBuilders,
    lastScannedAt: isoOrNull(village.lastScannedAt),
    createdAt: iso(village.createdAt),
    updatedAt: iso(village.updatedAt)
  }
}

export function toBuildingDto(building: Building): BuildingDto {
  return {
    id: building.id,
    villageId: building.villageId,
    name: building.name,
    category: building.category,
    level: building.level,
    quantity: building.quantity,
    isUpgrading: building.isUpgrading,
    upgradeStartedAt: isoOrNull(building.upgradeStartedAt),
    upgradeEndsAt: isoOrNull(building.upgradeEndsAt),
    createdAt: iso(building.createdAt),
    updatedAt: iso(building.updatedAt)
  }
}

export function toHeroDto(hero: Hero): HeroDto {
  return {
    id: hero.id,
    villageId: hero.villageId,
    name: hero.name,
    level: hero.level,
    isUpgrading: hero.isUpgrading,
    upgradeStartedAt: isoOrNull(hero.upgradeStartedAt),
    upgradeEndsAt: isoOrNull(hero.upgradeEndsAt),
    createdAt: iso(hero.createdAt),
    updatedAt: iso(hero.updatedAt)
  }
}

export function toResearchDto(research: Research): ResearchDto {
  return {
    id: research.id,
    villageId: research.villageId,
    name: research.name,
    level: research.level,
    category: research.category,
    isResearching: research.isResearching,
    researchStartedAt: isoOrNull(research.researchStartedAt),
    researchEndsAt: isoOrNull(research.researchEndsAt),
    createdAt: iso(research.createdAt),
    updatedAt: iso(research.updatedAt)
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
