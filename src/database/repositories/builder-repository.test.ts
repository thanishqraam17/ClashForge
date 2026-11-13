import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LOCAL_VILLAGE_ID } from '../../domain/village'
import { VillageStateValidationError } from '../../domain/village-state'
import { createTestDatabase, TEST_CONFIRMED, type TestDatabase } from './test-helpers'

describe('BuilderRepository', () => {
  let t: TestDatabase

  beforeEach(() => {
    t = createTestDatabase({ withVillage: true })
  })

  afterEach(() => t.cleanup())

  function builder(slot: number) {
    return t.database.builders.create({ villageId: LOCAL_VILLAGE_ID, slot, kind: 'legacy-unclassified', ...TEST_CONFIRMED })
  }

  it('creates and lists builders by slot', () => {
    builder(2)
    builder(1)
    expect(t.database.builders.listByVillage(LOCAL_VILLAGE_ID).map((b) => b.slot)).toEqual([1, 2])
    expect(() => builder(1)).toThrow(/UNIQUE/)
    expect(() => builder(0)).toThrow(VillageStateValidationError)
  })

  it('updates provenance and refuses to move a builder between villages', () => {
    const created = builder(1)
    const updated = t.database.builders.update({ ...created, confidence: 0.7, confirmedAt: null })
    expect(updated).toMatchObject({ confidence: 0.7, confirmedAt: null })
    expect(() => t.database.builders.update({ ...created, villageId: 2 })).toThrow(
      'A builder cannot move between villages'
    )
  })

  it('links to the item it is upgrading and cannot be deleted while busy', () => {
    const b = builder(1)
    const item = t.database.villageItems.create({
      villageId: LOCAL_VILLAGE_ID,
      itemId: 'test-cannon',
      instanceNumber: 1,
      level: 3,
      targetLevel: 4,
      upgradeStartedAt: new Date('2026-11-12T08:00:00.000Z'),
      upgradeEndsAt: new Date('2026-11-13T08:00:00.000Z'),
      builderId: b.id,
      builderAssignment: 'confirmed',
      upgradeObservedTimer: null,
      upgradeObservedAt: null,
      ...TEST_CONFIRMED
    })
    expect(t.database.villageItems.getByBuilder(b.id)?.id).toBe(item.id)
    expect(() => t.database.builders.delete(b.id)).toThrow(/FOREIGN KEY/)

    t.database.villageItems.update({
      ...item,
      level: 4,
      targetLevel: null,
      upgradeStartedAt: null,
      upgradeEndsAt: null,
      builderId: null,
      builderAssignment: null
    })
    expect(t.database.villageItems.getByBuilder(b.id)).toBeNull()
    expect(t.database.builders.delete(b.id)).toBe(true)
  })

  it('lists one kind at a time, oldest first', () => {
    const a = t.database.builders.create({ villageId: LOCAL_VILLAGE_ID, slot: 1, kind: 'legacy-unclassified', ...TEST_CONFIRMED })
    const b = t.database.builders.create({ villageId: LOCAL_VILLAGE_ID, slot: 2, kind: 'ordinary', ...TEST_CONFIRMED })
    const c = t.database.builders.create({ villageId: LOCAL_VILLAGE_ID, slot: 3, kind: 'legacy-unclassified', ...TEST_CONFIRMED })
    expect(t.database.builders.listByVillageAndKind(LOCAL_VILLAGE_ID, 'legacy-unclassified').map((x) => x.id)).toEqual([
      a.id,
      c.id
    ])
    expect(t.database.builders.listByVillageAndKind(LOCAL_VILLAGE_ID, 'ordinary').map((x) => x.id)).toEqual([b.id])
    expect(t.database.builders.listByVillageAndKind(LOCAL_VILLAGE_ID, 'bob')).toEqual([])
  })

  it('relabels a builder without changing its id, slot or assignment', () => {
    const b = builder(1)
    const item = t.database.villageItems.create({
      villageId: LOCAL_VILLAGE_ID,
      itemId: 'test-cannon',
      instanceNumber: 1,
      level: 3,
      targetLevel: 4,
      upgradeStartedAt: new Date('2026-11-12T08:00:00.000Z'),
      upgradeEndsAt: new Date('2026-11-13T08:00:00.000Z'),
      builderId: b.id,
      builderAssignment: 'confirmed',
      upgradeObservedTimer: null,
      upgradeObservedAt: null,
      ...TEST_CONFIRMED
    })

    const relabelled = t.database.builders.relabel(b.id, 'bob')
    expect(relabelled).toMatchObject({ id: b.id, slot: b.slot, kind: 'bob' })
    expect(t.database.villageItems.getByBuilder(b.id)?.id).toBe(item.id)
    expect(t.database.villageItems.getById(item.id)?.builderId).toBe(b.id)
    expect(() => t.database.builders.relabel(999, 'ordinary')).toThrow(VillageStateValidationError)
  })

  it('refuses more than one bob row per village at the database level', () => {
    t.database.builders.create({ villageId: LOCAL_VILLAGE_ID, slot: 1, kind: 'bob', ...TEST_CONFIRMED })
    expect(() =>
      t.database.builders.create({ villageId: LOCAL_VILLAGE_ID, slot: 2, kind: 'bob', ...TEST_CONFIRMED })
    ).toThrow(/UNIQUE/)
  })
})
