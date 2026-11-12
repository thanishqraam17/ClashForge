import { randomUUID } from 'crypto'
import { describe, expect, it } from 'vitest'
import {
  IpcInputError,
  parseBuildersSetCountInput,
  parseEditLogGetBatchInput,
  parseEditLogListInput,
  parseLegacyMapInput,
  parseLegacyRecordRefInput,
  parseResearchRemoveInput,
  parseVillageItemRemoveInput,
  parseVillageItemsSetCountInput,
  parseVillageItemsSetLevelsInput
} from './validation'

const bad = (parse: (v: unknown) => unknown, value: unknown) =>
  expect(() => parse(value), JSON.stringify(value)).toThrow(IpcInputError)

describe('IPC validation for bulk edits, legacy reconciliation and the edit log', () => {
  it('parses notes only when sent, so old payloads parse exactly as before', () => {
    expect(parseBuildersSetCountInput({ count: 2 })).toEqual({ count: 2 })
    expect(parseBuildersSetCountInput({ count: 2, note: null })).toEqual({ count: 2, note: null })
    expect(parseResearchRemoveInput({ itemId: 'test-archer', note: 'typo' })).toEqual({ itemId: 'test-archer', note: 'typo' })
    expect(parseVillageItemRemoveInput({ id: 3, note: 'x'.repeat(500) }).note).toHaveLength(500)
    for (const note of ['', '   ', 'x'.repeat(501), 5, {}]) bad(parseVillageItemRemoveInput, { id: 3, note })
  })

  it('checks the shape and bounds of bulk level edits', () => {
    expect(parseVillageItemsSetLevelsInput({ itemId: 'test-cannon', level: 3, instances: 'all' })).toEqual({
      itemId: 'test-cannon', level: 3, instances: 'all'
    })
    expect(
      parseVillageItemsSetLevelsInput({ itemId: 'test-cannon', level: 3, instances: [1, 2], includeActiveUpgrades: [], note: 'n' })
    ).toEqual({ itemId: 'test-cannon', level: 3, instances: [1, 2], includeActiveUpgrades: [], note: 'n' })
    const ok = { itemId: 'test-cannon', level: 3, instances: [1] }
    for (const value of [
      null, [], { ...ok, extra: 1 }, { ...ok, itemId: 'Not An Id' }, { ...ok, level: 0 }, { ...ok, level: 1.5 },
      { ...ok, instances: 'some' }, { ...ok, instances: [] }, { ...ok, instances: [0] }, { ...ok, instances: [1, 1] },
      { ...ok, instances: ['1'] }, { ...ok, instances: Array.from({ length: 501 }, (_, i) => i + 1) },
      // eslint-disable-next-line no-sparse-arrays
      { ...ok, instances: [1, , 2] }, { ...ok, includeActiveUpgrades: 'all' }, { ...ok, includeActiveUpgrades: [2, 2] }
    ]) {
      bad(parseVillageItemsSetLevelsInput, value)
    }
  })

  it('checks the shape and bounds of bulk count edits', () => {
    expect(parseVillageItemsSetCountInput({ itemId: 'test-cannon', count: 0 })).toEqual({ itemId: 'test-cannon', count: 0 })
    expect(parseVillageItemsSetCountInput({ itemId: 'test-cannon', count: 1, removeInstances: [4], includeActiveUpgrades: [4] })).toEqual({
      itemId: 'test-cannon', count: 1, removeInstances: [4], includeActiveUpgrades: [4]
    })
    for (const value of [
      { itemId: 'test-cannon', count: -1 }, { itemId: 'test-cannon', count: 501 }, { itemId: 'test-cannon', count: 1, levelForAdditions: 0 },
      { itemId: 'test-cannon', count: 1, removeInstances: [1, 1] }, { itemId: 'test-cannon' }
    ]) {
      bad(parseVillageItemsSetCountInput, value)
    }
  })

  it('checks legacy record references and mappings', () => {
    expect(parseLegacyRecordRefInput({ kind: 'hero', id: 1 })).toEqual({ kind: 'hero', id: 1 })
    expect(parseLegacyMapInput({ kind: 'research', id: 2, itemId: 'test-archer', level: 2, note: 'n' })).toEqual({
      kind: 'research', id: 2, itemId: 'test-archer', level: 2, note: 'n'
    })
    for (const value of [{ kind: 'castle', id: 1 }, { kind: 'hero', id: 0 }, { kind: 'hero', id: '1' }, { kind: 'hero', id: 1, itemId: 'x' }]) {
      bad(parseLegacyRecordRefInput, value)
    }
    bad(parseLegacyMapInput, { kind: 'hero', id: 1 })
    bad(parseLegacyMapInput, { kind: 'hero', id: 1, itemId: 'test-knight', level: -2 })
  })

  it('accepts generated batch ids and checks edit-log queries', () => {
    for (let i = 0; i < 50; i += 1) {
      const batchId = randomUUID()
      expect(parseEditLogGetBatchInput({ batchId })).toEqual({ batchId })
      expect(parseEditLogListInput({ batchId })).toEqual({ batchId })
    }
    expect(parseEditLogListInput(undefined)).toEqual({})
    expect(parseEditLogListInput({ limit: 200, beforeId: 9, entityType: 'legacy-hero', itemId: 'test-knight' })).toEqual({
      limit: 200, beforeId: 9, entityType: 'legacy-hero', itemId: 'test-knight'
    })
    for (const value of [
      { limit: 0 }, { limit: 201 }, { beforeId: 0 }, { entityType: 'village-item' }, { itemId: 'Bad Id' },
      { batchId: '' }, { batchId: 'ABCDEF00-0000-4000-8000-000000000000' }, { batchId: 'x'.repeat(36) }, { other: 1 }
    ]) {
      bad(parseEditLogListInput, value)
    }
    bad(parseEditLogGetBatchInput, {})
  })
})
