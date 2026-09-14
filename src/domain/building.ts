export type Building = {
  id: number
  villageId: number
  name: string
  category: string
  level: number
  quantity: number
  isUpgrading: boolean
  upgradeStartedAt: Date | null
  upgradeEndsAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export type BuildingPersistInput = Omit<Building, 'id' | 'createdAt' | 'updatedAt'>

export class BuildingValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BuildingValidationError'
  }
}

export function validateBuildingPersistInput(input: BuildingPersistInput): void {
  if (input.villageId < 1) {
    throw new BuildingValidationError('villageId must be at least 1')
  }
  if (!input.name.trim()) {
    throw new BuildingValidationError('name is required')
  }
  if (!input.category.trim()) {
    throw new BuildingValidationError('category is required')
  }
  if (input.level < 0) {
    throw new BuildingValidationError('level cannot be negative')
  }
  if (input.quantity < 0) {
    throw new BuildingValidationError('quantity cannot be negative')
  }
  validateUpgradeTimestamps(input.isUpgrading, input.upgradeStartedAt, input.upgradeEndsAt)
}

function validateUpgradeTimestamps(
  active: boolean,
  startedAt: Date | null,
  endsAt: Date | null
): void {
  if (startedAt && endsAt && endsAt.getTime() < startedAt.getTime()) {
    throw new BuildingValidationError('upgradeEndsAt cannot be before upgradeStartedAt')
  }
  if (active && !startedAt && !endsAt) {
    throw new BuildingValidationError(
      'isUpgrading requires upgradeStartedAt or upgradeEndsAt'
    )
  }
}
