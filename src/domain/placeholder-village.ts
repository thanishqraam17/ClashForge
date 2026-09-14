/**
 * Phase 1 placeholder village state — replaced by persisted data in Phase 2.
 */

export type ResourceSnapshot = {
  current: number
  capacity: number
}

export type BuilderQueueItem =
  | {
      kind: 'working'
      builderIndex: number
      label: string
      fromLevel: number
      toLevel: number
      remainingMinutes: number
    }
  | {
      kind: 'available'
      builderIndex: number
      recommended: {
        label: string
        fromLevel: number
        toLevel: number
      }
    }

export type PlaceholderVillageOverview = {
  townHallLevel: number
  buildersTotal: number
  buildersAvailable: number
  lastScannedAt: Date
  gold: ResourceSnapshot
  elixir: ResourceSnapshot
  darkElixir: ResourceSnapshot
  builderQueue: BuilderQueueItem[]
}

export const PLACEHOLDER_VILLAGE: PlaceholderVillageOverview = {
  townHallLevel: 9,
  buildersTotal: 4,
  buildersAvailable: 2,
  lastScannedAt: new Date(Date.now() - 4 * 60_000),
  gold: { current: 8_000_000, capacity: 8_000_000 },
  elixir: { current: 6_200_000, capacity: 8_000_000 },
  darkElixir: { current: 40_000, capacity: 300_000 },
  builderQueue: [
    {
      kind: 'working',
      builderIndex: 1,
      label: 'Archer Queen',
      fromLevel: 30,
      toLevel: 31,
      remainingMinutes: 13 * 60 + 42
    },
    {
      kind: 'working',
      builderIndex: 2,
      label: 'Army Camp',
      fromLevel: 7,
      toLevel: 8,
      remainingMinutes: 28 * 60 + 15
    },
    {
      kind: 'available',
      builderIndex: 3,
      recommended: { label: 'Clan Castle', fromLevel: 4, toLevel: 5 }
    },
    {
      kind: 'available',
      builderIndex: 4,
      recommended: { label: 'X-Bow', fromLevel: 1, toLevel: 2 }
    }
  ]
}
