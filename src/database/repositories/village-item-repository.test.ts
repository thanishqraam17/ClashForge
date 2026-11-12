import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LOCAL_VILLAGE_ID } from '../../domain/village'
import { VillageStateValidationError, type VillageItemPersistInput } from '../../domain/village-state'
import { createTestDatabase, TEST_CONFIRMED, type TestDatabase } from './test-helpers'

function input(overrides: Partial<VillageItemPersistInput> = {}): VillageItemPersistInput {
  return {
    villageId: LOCAL_VILLAGE_ID,
    itemId: 'test-cannon',
    instanceNumber: 1,
    level: 3,
    targetLevel: null,
    upgradeStartedAt: null,
    upgradeEndsAt: null,
    builderId: null,
    ...TEST_CONFIRMED,
    ...overrides
  }
}

describe('VillageItemRepository', () => {
  let t: TestDatabase

  beforeEach(() => {
    t = createTestDatabase({ withVillage: true })
  })

  afterEach(() => t.cleanup())

  it('creates, reads and lists instances in item/instance order', () => {
    const items = t.database.villageItems
    items.create(input({ itemId: 'test-mortar' }))
    items.create(input({ instanceNumber: 2, level: 2 }))
    const first = items.create(input())

    expect(first).toMatchObject({
      villageId: 1,
      itemId: 'test-cannon',
      instanceNumber: 1,
      level: 3,
      targetLevel: null,
      builderId: null,
      source: 'manual',
      confidence: 1
    })
    expect(first.confirmedAt?.toISOString()).toBe('2026-11-12T10:00:00.000Z')
    expect(items.getById(first.id)?.itemId).toBe('test-cannon')
    expect(
      items.listByVillage(LOCAL_VILLAGE_ID).map((i) => `${i.itemId}#${i.instanceNumber}`)
    ).toEqual(['test-cannon#1', 'test-cannon#2', 'test-mortar#1'])
    expect(items.listByItem(LOCAL_VILLAGE_ID, 'test-cannon')).toHaveLength(2)
  })

  it('updates level and provenance, and deletes', () => {
    const items = t.database.villageItems
    const created = items.create(input())
    const updated = items.update({
      ...created,
      level: 4,
      source: 'timer-estimate',
      confidence: 0.5,
      confirmedAt: null
    })
    expect(updated).toMatchObject({ level: 4, source: 'timer-estimate', confidence: 0.5, confirmedAt: null })
    expect(items.delete(created.id)).toBe(true)
    expect(items.delete(created.id)).toBe(false)
    expect(items.getById(created.id)).toBeNull()
  })

  it('validates input and rejects duplicate instances', () => {
    const items = t.database.villageItems
    expect(() => items.create(input({ level: 0 }))).toThrow(VillageStateValidationError)
    items.create(input())
    expect(() => items.create(input())).toThrow(/UNIQUE/)
  })

  it('refuses to update missing instances or move them between villages', () => {
    const items = t.database.villageItems
    const created = items.create(input())
    expect(() => items.update({ ...created, id: 999 })).toThrow('Item instance 999 does not exist')
    expect(() => items.update({ ...created, villageId: 2 })).toThrow(
      'An item instance cannot move between villages'
    )
  })
})
