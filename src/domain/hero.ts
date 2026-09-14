export type Hero = {
  id: number
  villageId: number
  name: string
  level: number
  isUpgrading: boolean
  upgradeStartedAt: Date | null
  upgradeEndsAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export type HeroPersistInput = Omit<Hero, 'id' | 'createdAt' | 'updatedAt'>

export class HeroValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HeroValidationError'
  }
}

export function validateHeroPersistInput(input: HeroPersistInput): void {
  if (input.villageId < 1) {
    throw new HeroValidationError('villageId must be at least 1')
  }
  if (!input.name.trim()) {
    throw new HeroValidationError('name is required')
  }
  if (input.level < 0) {
    throw new HeroValidationError('level cannot be negative')
  }
  validateUpgradeTimestamps(input.isUpgrading, input.upgradeStartedAt, input.upgradeEndsAt)
}

function validateUpgradeTimestamps(
  active: boolean,
  startedAt: Date | null,
  endsAt: Date | null
): void {
  if (startedAt && endsAt && endsAt.getTime() < startedAt.getTime()) {
    throw new HeroValidationError('upgradeEndsAt cannot be before upgradeStartedAt')
  }
  if (active && !startedAt && !endsAt) {
    throw new HeroValidationError('isUpgrading requires upgradeStartedAt or upgradeEndsAt')
  }
}
