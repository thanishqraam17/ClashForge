import type { LegacyRecord } from '../../database/repositories/legacy-record-repository'
import type { UpgradeHistory } from '../../domain/upgrade-history'
import type {
  Provenance,
  ResearchState,
  VillageItemInstance,
  VillageSnapshot
} from '../../domain/village-state'
import type {
  BuilderState,
  CatalogueCoverage,
  VillageState
} from '../../services/village-state-service'
import type { Village } from '../../domain/village'
import type {
  BuilderDto,
  CatalogueCoverageDto,
  LegacyRecordDto,
  ProvenanceDto,
  ResearchStateDto,
  SnapshotDto,
  SnapshotSummaryDto,
  UpgradeHistoryDto,
  VillageDto,
  VillageItemDto,
  VillageStateDto
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
    source: village.source,
    confidence: village.confidence,
    confirmedAt: isoOrNull(village.confirmedAt),
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

function provenance(value: Provenance): ProvenanceDto {
  return { source: value.source, confidence: value.confidence, confirmedAt: isoOrNull(value.confirmedAt) }
}

export function toCoverageDto(coverage: CatalogueCoverage): CatalogueCoverageDto {
  return { ...coverage }
}

export function toBuilderDto(builder: BuilderState): BuilderDto {
  return {
    id: builder.id,
    slot: builder.slot,
    assignedItemInstanceId: builder.assignedItemInstanceId,
    status: builder.status,
    ...provenance(builder)
  }
}

export function toVillageItemDto(item: VillageItemInstance): VillageItemDto {
  return {
    id: item.id,
    itemId: item.itemId,
    instanceNumber: item.instanceNumber,
    level: item.level,
    targetLevel: item.targetLevel,
    upgradeStartedAt: isoOrNull(item.upgradeStartedAt),
    upgradeEndsAt: isoOrNull(item.upgradeEndsAt),
    builderId: item.builderId,
    builderAssignment: item.builderAssignment,
    upgradeObservedTimer: item.upgradeObservedTimer,
    upgradeObservedAt: isoOrNull(item.upgradeObservedAt),
    ...provenance(item)
  }
}

export function toResearchStateDto(research: ResearchState): ResearchStateDto {
  return {
    id: research.id,
    itemId: research.itemId,
    level: research.level,
    targetLevel: research.targetLevel,
    researchStartedAt: isoOrNull(research.researchStartedAt),
    researchEndsAt: isoOrNull(research.researchEndsAt),
    ...provenance(research)
  }
}

export function toSnapshotSummaryDto(snapshot: VillageSnapshot): SnapshotSummaryDto {
  return {
    id: snapshot.id,
    capturedAt: iso(snapshot.capturedAt),
    source: snapshot.source,
    dataVersion: snapshot.dataVersion,
    schemaVersion: snapshot.schemaVersion
  }
}

export function toSnapshotDto(snapshot: VillageSnapshot): SnapshotDto {
  return { ...toSnapshotSummaryDto(snapshot), payload: snapshot.payload }
}

export function toVillageStateDto(state: VillageState): VillageStateDto {
  return {
    village: toVillageDto(state.village),
    coverage: toCoverageDto(state.coverage),
    builders: state.builders.map(toBuilderDto),
    builderAvailability: { ...state.builderAvailability },
    items: state.items.map(toVillageItemDto),
    research: state.research.map(toResearchStateDto),
    activeResearchItemId: state.activeResearch?.itemId ?? null,
    latestSnapshot: state.latestSnapshot
      ? {
          id: state.latestSnapshot.id,
          capturedAt: iso(state.latestSnapshot.capturedAt),
          source: state.latestSnapshot.source
        }
      : null,
    legacyRecords: { ...state.legacyRecords }
  }
}

export function toLegacyRecordDto(record: LegacyRecord): LegacyRecordDto {
  return {
    kind: record.kind,
    id: record.id,
    name: record.name,
    category: record.category,
    level: record.level,
    quantity: record.quantity,
    isUpgrading: record.isUpgrading,
    upgradeStartedAt: isoOrNull(record.upgradeStartedAt),
    upgradeEndsAt: isoOrNull(record.upgradeEndsAt),
    status: record.status,
    mappedItemId: record.mappedItemId,
    note: record.note,
    reconciledAt: isoOrNull(record.reconciledAt),
    archivedAt: isoOrNull(record.archivedAt)
  }
}
