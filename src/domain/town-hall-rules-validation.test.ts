import { describe, expect, it } from 'vitest'
import { SAMPLE_ITEMS, SAMPLE_MANIFEST } from '../game-data/fixtures/sample-catalogue'
import { SAMPLE_TOWN_HALL_RULES } from '../game-data/fixtures/sample-town-hall-rules'
import { parseGameCatalogue } from './catalogue-validation'
import {
  parseTownHallRules,
  TownHallRulesValidationError,
  validateTownHallRules
} from './town-hall-rules-validation'

const catalogue = parseGameCatalogue(SAMPLE_MANIFEST, SAMPLE_ITEMS)

type RawRules = { maxTownHall: Record<string, unknown>; items: Array<Record<string, unknown>> }

function rules(): RawRules {
  return structuredClone(SAMPLE_TOWN_HALL_RULES) as RawRules
}

function withItem(itemId: string, patch: Record<string, unknown>): RawRules {
  const raw = rules()
  raw.items = raw.items.map((entry) => (entry['itemId'] === itemId ? { ...entry, ...patch } : entry))
  return raw
}

function issues(raw: unknown): string[] {
  const result = validateTownHallRules(raw, catalogue)
  return result.ok ? [] : result.issues.map((issue) => `${issue.path}: ${issue.message}`)
}

describe('validateTownHallRules', () => {
  it('accepts the sample rules', () => {
    expect(issues(rules())).toEqual([])
  })

  it('rejects non-objects and bad maxTownHall', () => {
    expect(issues(null)).toEqual(['rules: must be an object'])
    const raw = rules()
    raw.maxTownHall['builder-base'] = 0
    expect(issues(raw)).toContain(
      'rules.maxTownHall.builder-base: must be an integer between 1 and 30'
    )
  })

  it('requires rules for every catalogue item and only known items', () => {
    const missing = rules()
    missing.items = missing.items.filter((entry) => entry['itemId'] !== 'test-mortar')
    expect(issues(missing)).toEqual(['rules.items: missing rules for catalogue item "test-mortar"'])

    const unknown = rules()
    unknown.items.push({ itemId: 'ghost', steps: [], unlockRequires: [] })
    expect(issues(unknown)).toEqual(['rules.items[10].itemId: unknown catalogue item "ghost"'])

    const duplicate = rules()
    duplicate.items.push(duplicate.items[0]!)
    expect(issues(duplicate)).toEqual(['rules.items[10].itemId: duplicate rules for "test-hall"'])
  })

  it('requires the first step at the unlock Town Hall', () => {
    expect(
      issues(withItem('test-mortar', { steps: [{ townHall: 4, maxLevel: 1, maxQuantity: 1 }] }))
    ).toEqual(["rules.items[3].steps[0].townHall: first step must be the item's unlock Town Hall (3)"])
  })

  it('enforces ascending, non-decreasing, non-repeating steps within range', () => {
    const steps = (list: Array<[number, number, number]>) =>
      list.map(([townHall, maxLevel, maxQuantity]) => ({ townHall, maxLevel, maxQuantity }))

    expect(
      issues(withItem('test-cannon', { steps: steps([[1, 2, 2], [1, 3, 2]]) }))
    ).toEqual([
      'rules.items[2].steps[1].townHall: steps must be in strictly ascending Town Hall order'
    ])
    expect(
      issues(withItem('test-cannon', { steps: steps([[1, 3, 2], [2, 2, 1]]) }))
    ).toEqual([
      'rules.items[2].steps[1].maxLevel: cannot decrease at a higher Town Hall',
      'rules.items[2].steps[1].maxQuantity: cannot decrease at a higher Town Hall'
    ])
    expect(issues(withItem('test-cannon', { steps: steps([[1, 2, 2], [2, 2, 2]]) }))).toEqual([
      'rules.items[2].steps[1]: repeats the previous step; only list Town Halls where something changes'
    ])
    expect(issues(withItem('test-cannon', { steps: steps([[1, 2, 2], [9, 3, 2]]) }))).toEqual([
      'rules.items[2].steps[1].townHall: must be an integer between 1 and 8'
    ])
    expect(issues(withItem('test-cannon', { steps: [] }))).toEqual([
      'rules.items[2].steps: must be a non-empty array'
    ])
  })

  it('respects isUpgradeable and isRepeatable from the catalogue', () => {
    expect(
      issues(withItem('test-decoration', { steps: [{ townHall: 1, maxLevel: 2, maxQuantity: 1 }] }))
    ).toEqual(['rules.items[8].steps[0].maxLevel: must be 1 for an item that is not upgradeable'])
    expect(
      issues(withItem('test-knight', {
        steps: [{ townHall: 7, maxLevel: 5, maxQuantity: 2 }]
      }))
    ).toEqual(['rules.items[5].steps[0].maxQuantity: must be 1 for an item that is not repeatable'])
  })

  it('validates unlock requirements', () => {
    const req = (requirement: Record<string, unknown>) =>
      issues(withItem('test-knight', { unlockRequires: [requirement] }))

    expect(req({ itemId: 'nope', level: 1 })).toEqual([
      'rules.items[5].unlockRequires[0].itemId: unknown catalogue item "nope"'
    ])
    expect(req({ itemId: 'test-knight', level: 1 })).toEqual([
      'rules.items[5].unlockRequires[0].itemId: an item cannot require itself'
    ])
    expect(req({ itemId: 'bb-test-cannon', level: 1 })).toEqual([
      'rules.items[5].unlockRequires[0].itemId: must be in the same game mode'
    ])
    expect(req({ itemId: 'test-hall', level: 8 })).toEqual([
      'rules.items[5].unlockRequires[0]: "test-hall" cannot reach level 8 by Town Hall 7'
    ])
    expect(issues(withItem('test-knight', { unlockRequires: undefined }))).toEqual([
      'rules.items[5].unlockRequires: must be an array (use [] for none)'
    ])
  })

  it('rejects unknown fields', () => {
    expect(issues(withItem('test-hall', { notes: 'x' }))).toEqual([
      'rules.items[0].notes: is not a recognised field'
    ])
  })
})

describe('parseTownHallRules', () => {
  it('returns typed rules or throws with all issues', () => {
    expect(parseTownHallRules(rules(), catalogue).items).toHaveLength(10)
    expect(() => parseTownHallRules({}, catalogue)).toThrow(TownHallRulesValidationError)
  })
})
