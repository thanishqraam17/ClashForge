import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LOCAL_VILLAGE_ID } from '../../domain/village'
import { VillageStateValidationError } from '../../domain/village-state'
import { createTestDatabase, TEST_CONFIRMED, type TestDatabase } from './test-helpers'

describe('SnapshotRepository', () => {
  let t: TestDatabase

  beforeEach(() => {
    t = createTestDatabase({ withVillage: true })
  })

  afterEach(() => t.cleanup())

  function seedState() {
    const { database } = t
    database.builders.create({ villageId: LOCAL_VILLAGE_ID, slot: 1, ...TEST_CONFIRMED })
    const b2 = database.builders.create({ villageId: LOCAL_VILLAGE_ID, slot: 2, ...TEST_CONFIRMED })
    database.villageItems.create({
      villageId: LOCAL_VILLAGE_ID,
      itemId: 'test-cannon',
      instanceNumber: 1,
      level: 3,
      targetLevel: 4,
      upgradeStartedAt: new Date('2026-11-12T08:00:00.000Z'),
      upgradeEndsAt: null,
      builderId: b2.id,
      source: 'timer-estimate',
      confidence: 0.6,
      confirmedAt: null
    })
    database.researchStates.create({
      villageId: LOCAL_VILLAGE_ID,
      itemId: 'test-archer',
      level: 2,
      targetLevel: null,
      researchStartedAt: null,
      researchEndsAt: null,
      ...TEST_CONFIRMED
    })
  }

  function capture(capturedAt: string) {
    return t.database.snapshots.capture({
      villageId: LOCAL_VILLAGE_ID,
      source: 'manual',
      dataVersion: '0.1.1',
      capturedAt: new Date(capturedAt)
    })
  }

  it('captures the complete current state as plain data', () => {
    seedState()
    const snapshot = capture('2026-11-12T12:00:00.000Z')
    expect(snapshot).toMatchObject({
      villageId: 1,
      source: 'manual',
      dataVersion: '0.1.1',
      schemaVersion: 1
    })
    expect(snapshot.capturedAt.toISOString()).toBe('2026-11-12T12:00:00.000Z')
    expect(snapshot.payload.village).toMatchObject({ townHallLevel: 5, source: 'manual', confidence: 1 })
    expect(snapshot.payload.builders.map((b) => b.slot)).toEqual([1, 2])
    expect(snapshot.payload.items).toEqual([
      {
        itemId: 'test-cannon',
        instanceNumber: 1,
        level: 3,
        targetLevel: 4,
        upgradeStartedAt: '2026-11-12T08:00:00.000Z',
        upgradeEndsAt: null,
        builderSlot: 2,
        source: 'timer-estimate',
        confidence: 0.6,
        confirmedAt: null
      }
    ])
    expect(snapshot.payload.research).toHaveLength(1)
  })

  it('never changes when the live village changes afterwards', () => {
    seedState()
    const first = capture('2026-11-12T12:00:00.000Z')

    const village = t.database.villages.getVillage()!
    t.database.villages.updateVillage({ ...village, townHallLevel: 6, gold: 999 })
    const item = t.database.villageItems.listByVillage(LOCAL_VILLAGE_ID)[0]!
    t.database.villageItems.update({
      ...item,
      level: 4,
      targetLevel: null,
      upgradeStartedAt: null,
      builderId: null
    })
    const second = capture('2026-11-13T12:00:00.000Z')

    const reread = t.database.snapshots.getById(first.id)!
    expect(reread.payload).toEqual(first.payload)
    expect(reread.payload.village.townHallLevel).toBe(5)
    expect(reread.payload.items[0]).toMatchObject({ level: 3, targetLevel: 4 })
    expect(second.payload.village.townHallLevel).toBe(6)
    expect(second.payload.items[0]).toMatchObject({ level: 4, targetLevel: null })
  })

  it('returns a fresh copy on every read', () => {
    const snapshot = capture('2026-11-12T12:00:00.000Z')
    snapshot.payload.village.gold = 123_456
    expect(t.database.snapshots.getById(snapshot.id)!.payload.village.gold).toBe(0)
  })

  it('finds the latest snapshot and lists newest first', () => {
    expect(t.database.snapshots.getLatest(LOCAL_VILLAGE_ID)).toBeNull()
    const older = capture('2026-11-10T00:00:00.000Z')
    const newer = capture('2026-11-12T00:00:00.000Z')
    capture('2026-11-11T00:00:00.000Z')
    expect(t.database.snapshots.getLatest(LOCAL_VILLAGE_ID)?.id).toBe(newer.id)
    expect(t.database.snapshots.list(LOCAL_VILLAGE_ID).map((s) => s.id).at(-1)).toBe(older.id)
    expect(t.database.snapshots.list(LOCAL_VILLAGE_ID, 1)).toHaveLength(1)
  })

  it('refuses to snapshot a missing village or with bad input', () => {
    expect(() =>
      t.database.snapshots.capture({ villageId: 2, source: 'manual', dataVersion: '0.1.1' })
    ).toThrow(VillageStateValidationError)
    expect(() =>
      t.database.snapshots.capture({ villageId: 1, source: 'manual', dataVersion: ' ' })
    ).toThrow('dataVersion is required')
  })
})
