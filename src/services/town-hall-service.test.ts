import { describe, expect, it } from 'vitest'
import { parseGameCatalogue } from '../domain/catalogue-validation'
import { parseTownHallRules } from '../domain/town-hall-rules-validation'
import { SAMPLE_ITEMS, SAMPLE_MANIFEST } from '../game-data/fixtures/sample-catalogue'
import { SAMPLE_TOWN_HALL_RULES } from '../game-data/fixtures/sample-town-hall-rules'
import { createTownHallService, stepAt, TownHallRangeError } from './town-hall-service'

const catalogue = parseGameCatalogue(SAMPLE_MANIFEST, SAMPLE_ITEMS)
const service = createTownHallService(
  catalogue,
  parseTownHallRules(SAMPLE_TOWN_HALL_RULES, catalogue)
)

describe('stepAt', () => {
  const steps = [
    { townHall: 2, maxLevel: 1, maxQuantity: 1 },
    { townHall: 5, maxLevel: 3, maxQuantity: 2 }
  ]
  it('returns the step in force at a Town Hall', () => {
    expect(stepAt(steps, 1)).toBeNull()
    expect(stepAt(steps, 2)?.maxLevel).toBe(1)
    expect(stepAt(steps, 4)?.maxLevel).toBe(1)
    expect(stepAt(steps, 5)?.maxLevel).toBe(3)
    expect(stepAt(steps, 30)?.maxLevel).toBe(3)
  })
})

describe('TownHallService.getItemAt', () => {
  it('resolves max level and quantity, carrying values forward between steps', () => {
    expect(service.getItemAt('test-cannon', 4)).toEqual({
      available: true,
      itemId: 'test-cannon',
      townHall: 4,
      maxLevel: 4,
      maxQuantity: 2,
      unlockRequires: []
    })
    expect(service.getItemAt('test-cannon', 8)).toMatchObject({ maxLevel: 6, maxQuantity: 3 })
  })

  it('reports locked items with their unlock Town Hall', () => {
    expect(service.getItemAt('test-knight', 6)).toEqual({
      available: false,
      itemId: 'test-knight',
      townHall: 6,
      unlocksAtTownHall: 7
    })
    expect(service.getItemAt('test-knight', 7)).toMatchObject({
      available: true,
      unlockRequires: [{ itemId: 'test-hall', level: 7 }]
    })
  })

  it('returns null for unknown items and rejects out-of-range Town Halls', () => {
    expect(service.getItemAt('nope', 3)).toBeNull()
    expect(() => service.getItemAt('test-cannon', 0)).toThrow(TownHallRangeError)
    expect(() => service.getItemAt('test-cannon', 9)).toThrow(TownHallRangeError)
    expect(() => service.getItemAt('bb-test-cannon', 4)).toThrow(TownHallRangeError)
    expect(service.getItemAt('bb-test-cannon', 3)).toMatchObject({ maxLevel: 4 })
  })
})

describe('TownHallService.getSummary', () => {
  it('lists everything as new at Town Hall 1', () => {
    const summary = service.getSummary(1)
    expect(summary.available.map((entry) => entry.itemId)).toEqual([
      'test-hall',
      'test-gold-mine',
      'test-cannon',
      'test-archer',
      'test-decoration'
    ])
    expect(summary.available.every((entry) => entry.isNewlyUnlocked)).toBe(true)
    expect(summary.locked).toEqual([
      { itemId: 'test-mortar', unlocksAtTownHall: 3 },
      { itemId: 'test-spike-trap', unlocksAtTownHall: 4 },
      { itemId: 'test-knight', unlocksAtTownHall: 7 },
      { itemId: 'test-heal-spell', unlocksAtTownHall: 6 }
    ])
  })

  it('reports new unlocks, added levels and added quantities', () => {
    const summary = service.getSummary(5)
    const byId = Object.fromEntries(summary.available.map((entry) => [entry.itemId, entry]))
    expect(byId['test-cannon']).toMatchObject({
      isNewlyUnlocked: false,
      levelsAdded: 2,
      quantityAdded: 1
    })
    expect(byId['test-mortar']).toMatchObject({ levelsAdded: 2, quantityAdded: 1 })
    expect(byId['test-gold-mine']).toMatchObject({ levelsAdded: 0, quantityAdded: 0 })
    expect(service.getSummary(7).available.find((e) => e.itemId === 'test-knight')).toMatchObject(
      { isNewlyUnlocked: true, levelsAdded: 5, quantityAdded: 1 }
    )
  })

  it('keeps Builder Base separate', () => {
    expect(service.getSummary(1, 'builder-base').available.map((e) => e.itemId)).toEqual([
      'bb-test-cannon'
    ])
  })

  it('exposes max Town Hall per mode', () => {
    expect(service.getMaxTownHall('home-village')).toBe(8)
    expect(service.getMaxTownHall('builder-base')).toBe(3)
  })
})

describe('TownHallService.compare', () => {
  it('splits items into unlocked, improved, unchanged and still locked', () => {
    expect(service.compare(4, 6)).toEqual({
      gameMode: 'home-village',
      fromTownHall: 4,
      toTownHall: 6,
      newlyUnlocked: [{ itemId: 'test-heal-spell', maxLevel: 2, maxQuantity: 1 }],
      improved: [
        { itemId: 'test-hall', fromMaxLevel: 4, toMaxLevel: 6, fromMaxQuantity: 1, toMaxQuantity: 1 },
        { itemId: 'test-cannon', fromMaxLevel: 4, toMaxLevel: 6, fromMaxQuantity: 2, toMaxQuantity: 3 },
        { itemId: 'test-mortar', fromMaxLevel: 1, toMaxLevel: 3, fromMaxQuantity: 1, toMaxQuantity: 2 },
        { itemId: 'test-archer', fromMaxLevel: 2, toMaxLevel: 3, fromMaxQuantity: 1, toMaxQuantity: 1 }
      ],
      unchanged: ['test-gold-mine', 'test-spike-trap', 'test-decoration'],
      stillLocked: [{ itemId: 'test-knight', unlocksAtTownHall: 7 }]
    })
  })

  it('treats comparing a Town Hall with itself as all unchanged', () => {
    const same = service.compare(3, 3)
    expect(same.newlyUnlocked).toEqual([])
    expect(same.improved).toEqual([])
    expect(same.unchanged).toEqual([
      'test-hall',
      'test-gold-mine',
      'test-cannon',
      'test-mortar',
      'test-archer',
      'test-decoration'
    ])
  })

  it('rejects reversed or out-of-range comparisons', () => {
    expect(() => service.compare(5, 4)).toThrow(TownHallRangeError)
    expect(() => service.compare(1, 9)).toThrow(TownHallRangeError)
  })
})
