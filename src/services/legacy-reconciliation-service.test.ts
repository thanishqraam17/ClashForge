import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createLegacyTestDatabase, TEST_CONFIRMED, type TestDatabase } from '../database/repositories/test-helpers'
import { parseGameCatalogue } from '../domain/catalogue-validation'
import type { GameCatalogue } from '../domain/catalogue'
import { parseTownHallRules } from '../domain/town-hall-rules-validation'
import { LOCAL_VILLAGE_ID } from '../domain/village'
import { SAMPLE_ITEMS, SAMPLE_MANIFEST } from '../game-data/fixtures/sample-catalogue'
import { SAMPLE_TOWN_HALL_RULES } from '../game-data/fixtures/sample-town-hall-rules'
import { reconcileLegacyRecords } from './legacy-reconciliation-service'
import { createTownHallService } from './town-hall-service'
import { createVillageStateService } from './village-state-service'

const sampleCatalogue = parseGameCatalogue(SAMPLE_MANIFEST, SAMPLE_ITEMS)
const sampleRules = parseTownHallRules(SAMPLE_TOWN_HALL_RULES, sampleCatalogue)
const emptyCatalogue = parseGameCatalogue(SAMPLE_MANIFEST, [])
const emptyRules = parseTownHallRules(
  { maxTownHall: { 'home-village': null, 'builder-base': null }, items: [] },
  emptyCatalogue
)

function run(t: TestDatabase, catalogue: GameCatalogue, rules = sampleRules) {
  const townHall = createTownHallService(catalogue, rules)
  const villageState = createVillageStateService({ database: t.database, catalogue, townHall })
  return reconcileLegacyRecords({ database: t.database, catalogue, villageState })
}

describe('reconcileLegacyRecords', () => {
  let t: TestDatabase

  beforeEach(() => {
    // Town Hall 5 village with: Test Cannon x2 (lvl 3), Mystery Tower (upgrading),
    // hero Test Knight (lvl 4), research Test Archer (researching).
    t = createLegacyTestDatabase()
  })

  afterEach(() => t.cleanup())

  it('keeps everything pending while the catalogue is empty', () => {
    const report = run(t, emptyCatalogue, emptyRules)
    expect(report).toMatchObject({ converted: 0, pending: 4 })
    expect(report.results.every((r) => r.note.startsWith('Waiting for game data'))).toBe(true)
    expect(t.database.villageItems.listByVillage(LOCAL_VILLAGE_ID)).toEqual([])
    expect(t.database.legacyRecords.countByStatus(LOCAL_VILLAGE_ID)).toEqual({
      pending: 4,
      converted: 0,
      dismissed: 0
    })
  })

  it('converts only reliable mappings and explains the rest', () => {
    const report = run(t, sampleCatalogue)
    const byName = Object.fromEntries(report.results.map((r) => [r.name, r]))

    expect(byName['Test Cannon']).toMatchObject({ outcome: 'converted' })
    expect(byName['Mystery Tower']).toMatchObject({
      outcome: 'pending',
      note: 'No catalogue item matches this name; reconcile it manually.'
    })
    expect(byName['Test Knight']).toMatchObject({
      outcome: 'pending',
      note: 'Could not convert automatically: Test Knight unlocks at Town Hall 7'
    })
    expect(byName['Test Archer']!.note).toMatch(/^Was mid-upgrade/)
    expect(report).toMatchObject({ converted: 1, pending: 3 })

    const cannons = t.database.villageItems.listByItem(LOCAL_VILLAGE_ID, 'test-cannon')
    expect(cannons.map((c) => [c.instanceNumber, c.level])).toEqual([
      [1, 3],
      [2, 3]
    ])
    // Carried over from player data, but not yet re-confirmed.
    expect(cannons.every((c) => c.source === 'manual' && c.confirmedAt === null)).toBe(true)

    const archived = t.database.legacyRecords.get('building', 1)!
    expect(archived).toMatchObject({ status: 'converted', mappedItemId: 'test-cannon', name: 'Test Cannon', quantity: 2 })
    expect(t.database.legacyRecords.get('building', 2)?.note).toBe(
      'No catalogue item matches this name; reconcile it manually.'
    )
  })

  it('is idempotent', () => {
    run(t, sampleCatalogue)
    const second = run(t, sampleCatalogue)
    expect(second.converted).toBe(0)
    expect(t.database.villageItems.listByItem(LOCAL_VILLAGE_ID, 'test-cannon')).toHaveLength(2)
  })

  it('converts all instances of a record or none of them', () => {
    // Two cannons already recorded; the legacy pair would make four, above the limit of three.
    for (const instanceNumber of [1, 2]) {
      t.database.villageItems.create({
        villageId: LOCAL_VILLAGE_ID,
        itemId: 'test-cannon',
        instanceNumber,
        level: 5,
        targetLevel: null,
        upgradeStartedAt: null,
        upgradeEndsAt: null,
        builderId: null,
        ...TEST_CONFIRMED
      })
    }
    const report = run(t, sampleCatalogue)
    expect(report.results.find((r) => r.name === 'Test Cannon')).toMatchObject({
      outcome: 'pending',
      note: 'Could not convert automatically: Town Hall 5 allows at most 3 Test Cannon'
    })
    const cannons = t.database.villageItems.listByItem(LOCAL_VILLAGE_ID, 'test-cannon')
    expect(cannons.map((c) => c.level)).toEqual([5, 5])
    expect(t.database.legacyRecords.get('building', 1)?.status).toBe('pending')
  })
})
