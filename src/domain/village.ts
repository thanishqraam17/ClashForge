/** Stable identifier for the single local ClashForge village. */
export const LOCAL_VILLAGE_ID = 1

export type Village = {
  id: number
  townHallLevel: number
  gold: number
  elixir: number
  darkElixir: number
  goldCapacity: number
  elixirCapacity: number
  darkElixirCapacity: number
  builderCount: number
  availableBuilders: number
  lastScannedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export type VillagePersistInput = {
  townHallLevel: number
  gold: number
  elixir: number
  darkElixir: number
  goldCapacity: number
  elixirCapacity: number
  darkElixirCapacity: number
  builderCount: number
  availableBuilders: number
  lastScannedAt: Date | null
}

export class VillageValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VillageValidationError'
  }
}

export function validateVillagePersistInput(input: VillagePersistInput): void {
  if (input.townHallLevel < 1) {
    throw new VillageValidationError('townHallLevel must be at least 1')
  }
  if (input.gold < 0) {
    throw new VillageValidationError('gold cannot be negative')
  }
  if (input.elixir < 0) {
    throw new VillageValidationError('elixir cannot be negative')
  }
  if (input.darkElixir < 0) {
    throw new VillageValidationError('darkElixir cannot be negative')
  }
  if (input.goldCapacity < 0) {
    throw new VillageValidationError('goldCapacity cannot be negative')
  }
  if (input.elixirCapacity < 0) {
    throw new VillageValidationError('elixirCapacity cannot be negative')
  }
  if (input.darkElixirCapacity < 0) {
    throw new VillageValidationError('darkElixirCapacity cannot be negative')
  }
  if (input.builderCount < 0) {
    throw new VillageValidationError('builderCount cannot be negative')
  }
  if (input.availableBuilders < 0) {
    throw new VillageValidationError('availableBuilders cannot be negative')
  }
}
