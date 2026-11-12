import { describe, expect, it } from 'vitest'
import {
  manualProvenance,
  validateBuilderInput,
  validateProvenance,
  validateResearchStateInput,
  validateVillageItemInput,
  VillageStateValidationError,
  type ResearchStatePersistInput,
  type VillageItemPersistInput
} from './village-state'

const confirmed = manualProvenance(new Date('2026-11-12T10:00:00.000Z'))

function item(overrides: Partial<VillageItemPersistInput> = {}): VillageItemPersistInput {
  return {
    villageId: 1,
    itemId: 'test-cannon',
    instanceNumber: 1,
    level: 3,
    targetLevel: null,
    upgradeStartedAt: null,
    upgradeEndsAt: null,
    builderId: null,
    ...confirmed,
    ...overrides
  }
}

function research(overrides: Partial<ResearchStatePersistInput> = {}): ResearchStatePersistInput {
  return {
    villageId: 1,
    itemId: 'test-archer',
    level: 2,
    targetLevel: null,
    researchStartedAt: null,
    researchEndsAt: null,
    ...confirmed,
    ...overrides
  }
}

function message(fn: () => void): string {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(VillageStateValidationError)
    return (error as Error).message
  }
  return 'no error'
}

describe('validateProvenance', () => {
  it('accepts manual provenance and rejects bad values', () => {
    expect(() => validateProvenance(confirmed)).not.toThrow()
    expect(() =>
      validateProvenance({ source: 'timer-estimate', confidence: 0.4, confirmedAt: null })
    ).not.toThrow()
    expect(message(() => validateProvenance({ ...confirmed, confidence: 1.5 }))).toBe(
      'confidence must be between 0 and 1'
    )
    expect(message(() => validateProvenance({ ...confirmed, confidence: Number.NaN }))).toBe(
      'confidence must be between 0 and 1'
    )
    expect(
      message(() => validateProvenance({ ...confirmed, source: 'guess' as never }))
    ).toBe('source is invalid')
  })
})

describe('validateVillageItemInput', () => {
  const start = new Date('2026-11-12T08:00:00.000Z')
  const end = new Date('2026-11-13T08:00:00.000Z')

  it('accepts idle and upgrading instances', () => {
    expect(() => validateVillageItemInput(item())).not.toThrow()
    expect(() =>
      validateVillageItemInput(
        item({ targetLevel: 4, builderId: 2, upgradeStartedAt: start, upgradeEndsAt: end })
      )
    ).not.toThrow()
    expect(() => validateVillageItemInput(item({ targetLevel: 4, builderId: 2 }))).not.toThrow()
  })

  it('rejects malformed ids, levels and instance numbers', () => {
    expect(message(() => validateVillageItemInput(item({ itemId: 'Cannon' })))).toBe(
      'itemId is not a valid catalogue item id'
    )
    expect(message(() => validateVillageItemInput(item({ level: 0 })))).toBe(
      'level must be a positive integer'
    )
    expect(message(() => validateVillageItemInput(item({ instanceNumber: 0 })))).toBe(
      'instanceNumber must be a positive integer'
    )
  })

  it('enforces one-level upgrades with an assigned builder', () => {
    expect(message(() => validateVillageItemInput(item({ targetLevel: 5, builderId: 1 })))).toBe(
      'targetLevel must be exactly one above level'
    )
    expect(message(() => validateVillageItemInput(item({ targetLevel: 4 })))).toBe(
      'an active upgrade must be assigned to a builder'
    )
    expect(message(() => validateVillageItemInput(item({ builderId: 1 })))).toBe(
      'only an active upgrade can have a builder'
    )
    expect(message(() => validateVillageItemInput(item({ upgradeEndsAt: end })))).toBe(
      'upgrade timestamps require an active upgrade'
    )
    expect(
      message(() =>
        validateVillageItemInput(
          item({ targetLevel: 4, builderId: 1, upgradeStartedAt: end, upgradeEndsAt: start })
        )
      )
    ).toBe('upgrade end cannot be before its start')
  })
})

describe('validateBuilderInput', () => {
  it('requires a positive slot', () => {
    expect(() => validateBuilderInput({ villageId: 1, slot: 1, ...confirmed })).not.toThrow()
    expect(message(() => validateBuilderInput({ villageId: 1, slot: 0, ...confirmed }))).toBe(
      'slot must be a positive integer'
    )
  })
})

describe('validateResearchStateInput', () => {
  it('accepts idle and active research and enforces one-level steps', () => {
    expect(() => validateResearchStateInput(research())).not.toThrow()
    expect(() => validateResearchStateInput(research({ targetLevel: 3 }))).not.toThrow()
    expect(message(() => validateResearchStateInput(research({ targetLevel: 2 })))).toBe(
      'targetLevel must be exactly one above level'
    )
    expect(
      message(() =>
        validateResearchStateInput(research({ researchStartedAt: new Date('2026-11-12') }))
      )
    ).toBe('research timestamps require an active upgrade')
  })
})
