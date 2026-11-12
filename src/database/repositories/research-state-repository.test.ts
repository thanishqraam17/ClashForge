import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LOCAL_VILLAGE_ID } from '../../domain/village'
import { VillageStateValidationError, type ResearchStatePersistInput } from '../../domain/village-state'
import { createTestDatabase, TEST_CONFIRMED, type TestDatabase } from './test-helpers'

function input(overrides: Partial<ResearchStatePersistInput> = {}): ResearchStatePersistInput {
  return {
    villageId: LOCAL_VILLAGE_ID,
    itemId: 'test-archer',
    level: 2,
    targetLevel: null,
    researchStartedAt: null,
    researchEndsAt: null,
    ...TEST_CONFIRMED,
    ...overrides
  }
}

describe('ResearchStateRepository', () => {
  let t: TestDatabase

  beforeEach(() => {
    t = createTestDatabase({ withVillage: true })
  })

  afterEach(() => t.cleanup())

  it('creates, finds by item and lists research', () => {
    const repo = t.database.researchStates
    repo.create(input({ itemId: 'test-heal-spell', level: 1 }))
    repo.create(input())
    expect(repo.listByVillage(LOCAL_VILLAGE_ID).map((r) => r.itemId)).toEqual([
      'test-archer',
      'test-heal-spell'
    ])
    expect(repo.getByItem(LOCAL_VILLAGE_ID, 'test-archer')?.level).toBe(2)
    expect(repo.getByItem(LOCAL_VILLAGE_ID, 'missing')).toBeNull()
    expect(() => repo.create(input())).toThrow(/UNIQUE/)
  })

  it('tracks the single active research', () => {
    const repo = t.database.researchStates
    const archer = repo.create(input())
    const spell = repo.create(input({ itemId: 'test-heal-spell', level: 1 }))
    expect(repo.getActive(LOCAL_VILLAGE_ID)).toBeNull()

    repo.update({
      ...archer,
      targetLevel: 3,
      researchEndsAt: new Date('2026-11-14T00:00:00.000Z')
    })
    expect(repo.getActive(LOCAL_VILLAGE_ID)?.itemId).toBe('test-archer')
    expect(() => repo.update({ ...spell, targetLevel: 2 })).toThrow(/UNIQUE/)
  })

  it('validates input and protects item identity', () => {
    const repo = t.database.researchStates
    expect(() => repo.create(input({ targetLevel: 4 }))).toThrow(VillageStateValidationError)
    const created = repo.create(input())
    expect(() => repo.update({ ...created, itemId: 'test-heal-spell' })).toThrow(
      'Research cannot change village or item'
    )
    expect(repo.delete(created.id)).toBe(true)
  })
})
