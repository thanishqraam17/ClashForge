import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestDatabase, type TestDatabase } from '../database/repositories/test-helpers'
import { parseGameCatalogue } from '../domain/catalogue-validation'
import { parseTownHallRules } from '../domain/town-hall-rules-validation'
import { VillageStateValidationError } from '../domain/village-state'
import { SAMPLE_ITEMS, SAMPLE_MANIFEST } from '../game-data/fixtures/sample-catalogue'
import { SAMPLE_TOWN_HALL_RULES } from '../game-data/fixtures/sample-town-hall-rules'
import { createTownHallService } from './town-hall-service'
import {
  CatalogueCoverageError,
  createVillageStateService,
  VillageNotInitialisedError,
  VillageStateNotFoundError,
  type ItemInstanceInput,
  type VillageStateService
} from './village-state-service'

const sampleCatalogue = parseGameCatalogue(SAMPLE_MANIFEST, SAMPLE_ITEMS)
const sampleRules = parseTownHallRules(SAMPLE_TOWN_HALL_RULES, sampleCatalogue)
const emptyCatalogue = parseGameCatalogue(SAMPLE_MANIFEST, [])
const emptyRules = parseTownHallRules(
  { maxTownHall: { 'home-village': null, 'builder-base': null }, items: [] },
  emptyCatalogue
)

function item(overrides: Partial<ItemInstanceInput> = {}): ItemInstanceInput {
  return {
    itemId: 'test-cannon',
    instanceNumber: 1,
    level: 3,
    targetLevel: null,
    upgradeStartedAt: null,
    upgradeEndsAt: null,
    builderId: null,
    ...overrides
  }
}

describe('VillageStateService with sample data', () => {
  let t: TestDatabase
  let service: VillageStateService

  beforeEach(() => {
    t = createTestDatabase({ withVillage: true }) // Town Hall 5
    service = createVillageStateService({
      database: t.database,
      catalogue: sampleCatalogue,
      townHall: createTownHallService(sampleCatalogue, sampleRules)
    })
  })

  afterEach(() => t.cleanup())

  it('reports full coverage', () => {
    expect(service.getCoverage()).toEqual({
      datasetVersion: '0.0.1',
      validationStatus: 'unverified',
      catalogueItemCount: 9,
      maxTownHall: 8,
      villageTownHall: 5,
      canRecordItems: true,
      reason: null
    })
  })

  it('records item instances within Town Hall limits', () => {
    service.saveItemInstance(item())
    service.saveItemInstance(item({ instanceNumber: 3, level: 6 }))
    expect(() => service.saveItemInstance(item({ instanceNumber: 4 }))).toThrow(
      'Town Hall 5 allows at most 3 Test Cannon'
    )
    expect(() => service.saveItemInstance(item({ instanceNumber: 2, level: 7 }))).toThrow(
      'Test Cannon cannot be above level 6 at this Town Hall'
    )
    expect(() => service.saveItemInstance(item())).toThrow('Test Cannon #1 is already recorded')
    expect(service.getState()!.items.map((i) => i.instanceNumber)).toEqual([1, 3])
  })

  it('rejects unknown, locked, Builder Base and laboratory items', () => {
    const cases: Array<[string, string]> = [
      ['made-up-item', '"made-up-item" is not in the game catalogue'],
      ['test-knight', 'Test Knight unlocks at Town Hall 7'],
      ['bb-test-cannon', 'Builder Base items are not tracked yet'],
      ['test-archer', 'Test Archer is upgraded in the Laboratory']
    ]
    for (const [itemId, message] of cases) {
      expect(() => service.saveItemInstance(item({ itemId })), itemId).toThrow(message)
    }
  })

  it('assigns upgrades to free builders only', () => {
    const [b1, b2] = service.setBuilderCount(2)
    const upgrading = service.saveItemInstance(
      item({ targetLevel: 4, builderId: b1!.id, upgradeEndsAt: new Date('2026-11-13T00:00:00.000Z') })
    )
    expect(() =>
      service.saveItemInstance(item({ instanceNumber: 2, targetLevel: 4, builderId: b1!.id }))
    ).toThrow('Builder 1 is already upgrading another item')
    expect(() =>
      service.saveItemInstance(item({ instanceNumber: 2, targetLevel: 4, builderId: 999 }))
    ).toThrow(VillageStateNotFoundError)

    // Updating the same instance keeps its own builder.
    service.saveItemInstance(
      item({ id: upgrading.id, targetLevel: 4, builderId: b1!.id, upgradeEndsAt: null })
    )
    const state = service.getState()!
    expect(state.builders.map((b) => b.assignedItemInstanceId)).toEqual([upgrading.id, null])
    expect(b2!.slot).toBe(2)
  })

  it('changes builder count without dropping busy builders', () => {
    const builders = service.setBuilderCount(3)
    expect(builders.map((b) => b.slot)).toEqual([1, 2, 3])
    service.saveItemInstance(item({ targetLevel: 4, builderId: builders[2]!.id }))
    expect(() => service.setBuilderCount(2)).toThrow('Builder 3 is busy')
    expect(service.getState()!.builders).toHaveLength(3)
    expect(() => service.setBuilderCount(11)).toThrow(VillageStateValidationError)
  })

  it('records research with a single active laboratory job', () => {
    const village = t.database.villages.getVillage()!
    t.database.villages.updateVillage({ ...village, townHallLevel: 6 }) // heal spell unlocks at 6
    service.saveResearch({ itemId: 'test-archer', level: 2, targetLevel: 3, researchStartedAt: null, researchEndsAt: null })
    service.saveResearch({ itemId: 'test-heal-spell', level: 1, targetLevel: null, researchStartedAt: null, researchEndsAt: null })
    expect(() =>
      service.saveResearch({ itemId: 'test-heal-spell', level: 1, targetLevel: 2, researchStartedAt: null, researchEndsAt: null })
    ).toThrow('The Laboratory is already researching Test Archer')
    expect(() =>
      service.saveResearch({ itemId: 'test-cannon', level: 1, targetLevel: null, researchStartedAt: null, researchEndsAt: null })
    ).toThrow('Test Cannon is not researched in the Laboratory')
    expect(service.getState()!.activeResearch?.itemId).toBe('test-archer')

    // Updating replaces the row for that item.
    service.saveResearch({ itemId: 'test-archer', level: 3, targetLevel: null, researchStartedAt: null, researchEndsAt: null })
    expect(service.getState()!.research.map((r) => `${r.itemId}:${r.level}`)).toEqual([
      'test-archer:3',
      'test-heal-spell:1'
    ])
    service.removeResearch('test-heal-spell')
    expect(() => service.removeResearch('test-heal-spell')).toThrow(VillageStateNotFoundError)
  })

  it('captures snapshots and exposes the latest in the state', () => {
    service.saveItemInstance(item())
    const snapshot = service.captureSnapshot()
    expect(snapshot.dataVersion).toBe('0.0.1')
    expect(service.getState()!.latestSnapshot).toEqual({
      id: snapshot.id,
      capturedAt: snapshot.capturedAt,
      source: 'manual'
    })
    expect(service.getSnapshot(snapshot.id)?.payload.items).toHaveLength(1)
    expect(service.listSnapshots()).toHaveLength(1)
  })

  it('records manual provenance by default', () => {
    const saved = service.saveItemInstance(item())
    expect(saved).toMatchObject({ source: 'manual', confidence: 1 })
    expect(saved.confirmedAt).toBeInstanceOf(Date)
    const estimated = service.saveItemInstance(item({ instanceNumber: 2 }), {
      source: 'timer-estimate',
      confidence: 0.5,
      confirmedAt: null
    })
    expect(estimated).toMatchObject({ source: 'timer-estimate', confirmedAt: null })
  })
})

describe('VillageStateService with the empty bundled catalogue', () => {
  let t: TestDatabase
  let service: VillageStateService

  beforeEach(() => {
    t = createTestDatabase({ withVillage: true })
    service = createVillageStateService({
      database: t.database,
      catalogue: emptyCatalogue,
      townHall: createTownHallService(emptyCatalogue, emptyRules)
    })
  })

  afterEach(() => t.cleanup())

  it('explains that items cannot be recorded yet', () => {
    const coverage = service.getCoverage()
    expect(coverage).toMatchObject({ catalogueItemCount: 0, maxTownHall: null, canRecordItems: false })
    expect(coverage.reason).toMatch(/no Home Village items yet/)
    expect(service.getState()!.coverage.canRecordItems).toBe(false)
  })

  it('refuses item and research saves with a coverage error, never inventing ids', () => {
    expect(() => service.saveItemInstance(item())).toThrow(CatalogueCoverageError)
    expect(() =>
      service.saveResearch({ itemId: 'test-archer', level: 1, targetLevel: null, researchStartedAt: null, researchEndsAt: null })
    ).toThrow(CatalogueCoverageError)
    expect(service.getState()!.items).toEqual([])
  })

  it('still supports builders and snapshots', () => {
    expect(service.setBuilderCount(4)).toHaveLength(4)
    expect(service.captureSnapshot().payload.builders).toHaveLength(4)
  })
})

describe('VillageStateService coverage edge cases', () => {
  it('flags a Town Hall newer than the bundled data', () => {
    const t = createTestDatabase({ withVillage: true })
    try {
      const village = t.database.villages.getVillage()!
      t.database.villages.updateVillage({ ...village, townHallLevel: 12 })
      const service = createVillageStateService({
        database: t.database,
        catalogue: sampleCatalogue,
        townHall: createTownHallService(sampleCatalogue, sampleRules)
      })
      expect(service.getCoverage()).toMatchObject({
        canRecordItems: false,
        reason: 'Town Hall 12 is newer than the bundled game data, which covers up to Town Hall 8.'
      })
      expect(() => service.saveItemInstance(item())).toThrow(CatalogueCoverageError)
    } finally {
      t.cleanup()
    }
  })

  it('requires a saved village', () => {
    const t = createTestDatabase()
    try {
      const service = createVillageStateService({
        database: t.database,
        catalogue: sampleCatalogue,
        townHall: createTownHallService(sampleCatalogue, sampleRules)
      })
      expect(service.getState()).toBeNull()
      expect(() => service.saveItemInstance(item())).toThrow(VillageNotInitialisedError)
      expect(() => service.captureSnapshot()).toThrow(VillageNotInitialisedError)
    } finally {
      t.cleanup()
    }
  })
})
