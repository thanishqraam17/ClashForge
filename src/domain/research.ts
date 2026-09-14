export type Research = {
  id: number
  villageId: number
  name: string
  level: number
  category: string
  isResearching: boolean
  researchStartedAt: Date | null
  researchEndsAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export type ResearchPersistInput = Omit<Research, 'id' | 'createdAt' | 'updatedAt'>

export class ResearchValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ResearchValidationError'
  }
}

export function validateResearchPersistInput(input: ResearchPersistInput): void {
  if (input.villageId < 1) {
    throw new ResearchValidationError('villageId must be at least 1')
  }
  if (!input.name.trim()) {
    throw new ResearchValidationError('name is required')
  }
  if (!input.category.trim()) {
    throw new ResearchValidationError('category is required')
  }
  if (input.level < 0) {
    throw new ResearchValidationError('level cannot be negative')
  }
  validateResearchTimestamps(
    input.isResearching,
    input.researchStartedAt,
    input.researchEndsAt
  )
}

function validateResearchTimestamps(
  active: boolean,
  startedAt: Date | null,
  endsAt: Date | null
): void {
  if (startedAt && endsAt && endsAt.getTime() < startedAt.getTime()) {
    throw new ResearchValidationError('researchEndsAt cannot be before researchStartedAt')
  }
  if (active && !startedAt && !endsAt) {
    throw new ResearchValidationError(
      'isResearching requires researchStartedAt or researchEndsAt'
    )
  }
}
