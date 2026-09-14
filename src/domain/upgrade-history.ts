export const UPGRADE_HISTORY_ENTITY_TYPES = ['building', 'hero', 'research'] as const

export type UpgradeHistoryEntityType = (typeof UPGRADE_HISTORY_ENTITY_TYPES)[number]

export type UpgradeHistory = {
  id: number
  villageId: number
  entityType: UpgradeHistoryEntityType
  entityName: string
  fromLevel: number
  toLevel: number
  startedAt: Date
  completedAt: Date | null
  createdAt: Date
}

export type UpgradeHistoryRecordInput = {
  villageId: number
  entityType: UpgradeHistoryEntityType
  entityName: string
  fromLevel: number
  toLevel: number
  startedAt: Date
  completedAt: Date | null
}

export class UpgradeHistoryValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UpgradeHistoryValidationError'
  }
}

export function isUpgradeHistoryEntityType(value: string): value is UpgradeHistoryEntityType {
  return (UPGRADE_HISTORY_ENTITY_TYPES as readonly string[]).includes(value)
}

export function validateUpgradeHistoryRecordInput(input: UpgradeHistoryRecordInput): void {
  if (input.villageId < 1) {
    throw new UpgradeHistoryValidationError('villageId must be at least 1')
  }
  if (!input.entityName.trim()) {
    throw new UpgradeHistoryValidationError('entityName is required')
  }
  if (!isUpgradeHistoryEntityType(input.entityType)) {
    throw new UpgradeHistoryValidationError('entityType is invalid')
  }
  if (input.fromLevel < 0) {
    throw new UpgradeHistoryValidationError('fromLevel cannot be negative')
  }
  if (input.toLevel < 0) {
    throw new UpgradeHistoryValidationError('toLevel cannot be negative')
  }
  if (input.toLevel < input.fromLevel) {
    throw new UpgradeHistoryValidationError('toLevel cannot be lower than fromLevel')
  }
  if (Number.isNaN(input.startedAt.getTime())) {
    throw new UpgradeHistoryValidationError('startedAt is invalid')
  }
  if (input.completedAt !== null && Number.isNaN(input.completedAt.getTime())) {
    throw new UpgradeHistoryValidationError('completedAt is invalid')
  }
  if (
    input.completedAt !== null &&
    input.completedAt.getTime() < input.startedAt.getTime()
  ) {
    throw new UpgradeHistoryValidationError('completedAt cannot be before startedAt')
  }
}
