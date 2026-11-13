import { describe, expect, it } from 'vitest'
import { INSTANCE_CATEGORIES } from '../../../services/village-state-service'
import { SAMPLE_ITEMS } from '../../../game-data/fixtures/sample-catalogue'
import type {
  BuilderDto,
  CatalogueItemDto,
  VillageDto,
  VillageItemDto,
  VillageStateDto
} from '../../../shared/ipc/contracts'
import { summariseBulkCount, summariseBulkLevels } from './bulk-summary'
import {
  addInstanceRequest,
  assignBuilderRequest,
  bulkSetCountRequest,
  bulkSetLevelsRequest,
  cancelUpgradeRequest,
  finishUpgradeRequest,
  removeInstanceRequest,
  setLevelRequest,
  startUpgradeRequest
} from './edit-requests'
import { DEFAULT_ITEM_FILTER, filterItemGroups, presentCategories } from './item-filters'
import { GENERIC_ERROR_MESSAGE, NO_BRIDGE_MESSAGE, toUserMessage } from './ipc-errors'
import { readDuration, upgradeEndsAt } from './upgrade-duration'
import {
  isTownHallDecrease,
  isVillageFormDirty,
  readVillageForm,
  villageFormFrom
} from './village-form'
import {
  availabilityLabel,
  buildItemGroups,
  certainlyFreeBuilders,
  INSTANCE_ITEM_CATEGORIES,
  nextFreeInstanceNumber,
  unknownBuilderUpgrades
} from './village-view-model'

const items = SAMPLE_ITEMS as unknown as CatalogueItemDto[]
const prov = { source: 'manual' as const, confidence: 1, confirmedAt: '2026-11-12T00:00:00.000Z' }

let nextId = 1
function instance(overrides: Partial<VillageItemDto> = {}): VillageItemDto {
  return {
    id: nextId++,
    itemId: 'test-cannon',
    instanceNumber: 1,
    level: 3,
    targetLevel: null,
    upgradeStartedAt: null,
    upgradeEndsAt: null,
    builderId: null,
    builderAssignment: null,
    upgradeObservedTimer: null,
    upgradeObservedAt: null,
    ...prov,
    ...overrides
  }
}

const builder = (slot: number, status: BuilderDto['status'], assigned: number | null = null): BuilderDto => ({
  id: 100 + slot, slot, kind: 'legacy-unclassified', status, assignedItemInstanceId: assigned, ...prov
})

const village: VillageDto = {
  id: 1, townHallLevel: 6, gold: 100, elixir: 200, darkElixir: 0, goldCapacity: 1000, elixirCapacity: 1000,
  darkElixirCapacity: 0, lastScannedAt: '2026-11-01T00:00:00.000Z', ...prov,
  createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z'
}

function stateWith(instances: VillageItemDto[], builders: BuilderDto[] = []): VillageStateDto {
  return {
    village,
    coverage: { datasetVersion: '0.0.1', validationStatus: 'verified', catalogueItemCount: 10, maxTownHall: 8, villageTownHall: 6, canRecordItems: true, reason: null },
    builders,
    builderAvailability: { total: builders.length, busyAssigned: 0, busyUnassigned: 0, freeMin: 0, freeMax: 0, isConfirmed: true, inconsistent: false },
    items: instances,
    research: [],
    activeResearchItemId: null,
    latestSnapshot: null,
    legacyRecords: { pending: 0, converted: 0, dismissed: 0 }
  }
}

describe('view model', () => {
  it('mirrors the service instance categories', () => {
    expect([...INSTANCE_ITEM_CATEGORIES].sort()).toEqual([...INSTANCE_CATEGORIES].sort())
  })

  it('groups instances per Home Village item with limits, counts and the next free number', () => {
    const state = stateWith([
      instance({ instanceNumber: 3 }),
      instance({ instanceNumber: 1 }),
      instance({ itemId: 'test-mortar', instanceNumber: 1, level: 1 })
    ])
    const groups = buildItemGroups(state, items, {
      'test-cannon': { available: true, itemId: 'test-cannon', townHall: 6, maxLevel: 6, maxQuantity: 3, unlockRequires: [] },
      'test-mortar': { available: true, itemId: 'test-mortar', townHall: 6, maxLevel: 3, maxQuantity: 1, unlockRequires: [] },
      'test-knight': { available: false, itemId: 'test-knight', townHall: 6, unlocksAtTownHall: 7 }
    })
    expect(groups.map((g) => g.item.id)).not.toContain('test-archer')
    expect(groups.map((g) => g.item.id)).not.toContain('bb-test-cannon')
    const cannon = groups.find((g) => g.item.id === 'test-cannon')!
    expect(cannon.instances.map((i) => i.instanceNumber)).toEqual([1, 3])
    expect(cannon).toMatchObject({ count: 2, canAdd: true, nextFreeInstanceNumber: 2, limit: { status: 'available', maxLevel: 6, maxQuantity: 3 } })
    expect(groups.find((g) => g.item.id === 'test-mortar')).toMatchObject({ count: 1, canAdd: false })
    expect(groups.find((g) => g.item.id === 'test-knight')).toMatchObject({ canAdd: false, limit: { status: 'locked', unlocksAtTownHall: 7 } })
    expect(groups.find((g) => g.item.id === 'test-gold-mine')).toMatchObject({ count: 0, canAdd: false, limit: { status: 'unknown' } })
    expect(nextFreeInstanceNumber([])).toBe(1)
  })

  it('offers only certainly free builders and lists unknown-builder upgrades', () => {
    const builders = [builder(2, 'free'), builder(1, 'possibly-busy'), builder(3, 'busy', 5), builder(4, 'free')]
    expect(certainlyFreeBuilders({ builders }).map((b) => b.slot)).toEqual([2, 4])
    const unknown = instance({ targetLevel: 4, builderAssignment: 'unknown' })
    const known = instance({ instanceNumber: 2, targetLevel: 4, builderId: 103, builderAssignment: 'confirmed' })
    expect(unknownBuilderUpgrades({ items: [known, unknown, instance()] })).toEqual([unknown])
  })

  it('labels availability as estimated unless confirmed', () => {
    const base = { total: 3, busyAssigned: 1, busyUnassigned: 1, inconsistent: false }
    expect(availabilityLabel({ ...base, freeMin: 1, freeMax: 2, isConfirmed: false })).toEqual({ text: 'Estimated 1–2 of 3 free', estimated: true, inconsistent: false })
    expect(availabilityLabel({ ...base, freeMin: 2, freeMax: 2, isConfirmed: true, inconsistent: true }).text).toBe('2 of 3 free')
  })

  it('filters by recorded state, category and search', () => {
    const groups = buildItemGroups(stateWith([instance(), instance({ itemId: 'test-gold-mine' })]), items, {})
    expect(filterItemGroups(groups, DEFAULT_ITEM_FILTER).map((g) => g.item.id)).toEqual(['test-gold-mine', 'test-cannon'])
    expect(filterItemGroups(groups, { ...DEFAULT_ITEM_FILTER, search: '  CANN ' }).map((g) => g.item.id)).toEqual(['test-cannon'])
    expect(filterItemGroups(groups, { ...DEFAULT_ITEM_FILTER, category: 'resource' }).map((g) => g.item.id)).toEqual(['test-gold-mine'])
    expect(filterItemGroups(groups, { search: 'mortar', category: null, showUnrecorded: true }).map((g) => g.item.id)).toEqual(['test-mortar'])
    expect(presentCategories(groups, false)).toEqual(['resource', 'defense'])
    expect(presentCategories(groups, true)).toEqual(['town-hall', 'resource', 'defense', 'trap', 'hero', 'other'])
  })
})

describe('village form', () => {
  const values = villageFormFrom(village)

  it('builds the village:save payload, keeping lastScannedAt and trimming the note', () => {
    expect(readVillageForm({ ...values, gold: ' 150 ', note: '  checked  ' }, village)).toEqual({
      ok: true,
      input: { townHallLevel: 6, gold: 150, elixir: 200, darkElixir: 0, goldCapacity: 1000, elixirCapacity: 1000, darkElixirCapacity: 0, lastScannedAt: '2026-11-01T00:00:00.000Z', note: 'checked' },
      warnings: []
    })
    expect(readVillageForm({ ...values, note: '   ' }, null)).toMatchObject({ ok: true, input: { lastScannedAt: null } })
    expect(readVillageForm({ ...values, note: '   ' }, null)).not.toHaveProperty('input.note')
  })

  it('reports field errors and capacity warnings', () => {
    const result = readVillageForm({ ...values, townHallLevel: '0', gold: '-1', elixir: '1.5', darkElixir: 'abc', note: 'x'.repeat(501) }, village)
    expect(result).toEqual({
      ok: false,
      errors: {
        townHallLevel: 'Town Hall must be at least 1',
        gold: 'Gold must be a whole number of 0 or more',
        elixir: 'Elixir must be a whole number of 0 or more',
        darkElixir: 'Dark Elixir must be a whole number of 0 or more',
        note: 'Note must be at most 500 characters'
      }
    })
    expect(readVillageForm({ ...values, gold: '2000' }, village)).toMatchObject({ ok: true, warnings: ['Gold is above its capacity'] })
  })

  it('applies the highest Town Hall in the game data only when it is known', () => {
    expect(readVillageForm({ ...values, townHallLevel: '9' }, village, 8)).toEqual({ ok: false, errors: { townHallLevel: 'Town Hall must be at most 8' } })
    expect(readVillageForm({ ...values, townHallLevel: '8' }, village, 8).ok).toBe(true)
    expect(readVillageForm({ ...values, townHallLevel: '17' }, village, null).ok).toBe(true)
  })

  it('detects Town Hall decreases and unsaved changes', () => {
    const lower = readVillageForm({ ...values, townHallLevel: '5' }, village)
    expect(lower.ok && isTownHallDecrease(village, lower.input)).toBe(true)
    const higher = readVillageForm({ ...values, townHallLevel: '7' }, village)
    expect(higher.ok && isTownHallDecrease(village, higher.input)).toBe(false)
    expect(isVillageFormDirty(values, village)).toBe(false)
    expect(isVillageFormDirty({ ...values, note: 'only a note' }, village)).toBe(false)
    expect(isVillageFormDirty({ ...values, gold: '101' }, village)).toBe(true)
    expect(isVillageFormDirty(values, null)).toBe(true)
  })
})

describe('upgrade time remaining', () => {
  const now = new Date('2026-11-12T10:00:00.000Z')

  it('treats all-empty as unknown and computes the end from the given clock', () => {
    expect(readDuration({ days: '', hours: ' ', minutes: '' })).toEqual({ ok: true, ms: null })
    expect(upgradeEndsAt(now, null)).toBeNull()
    const d = readDuration({ days: '1', hours: '2', minutes: '' })
    expect(d).toEqual({ ok: true, ms: 26 * 3_600_000 })
    expect(upgradeEndsAt(now, d.ok ? d.ms : null)).toBe('2026-11-13T12:00:00.000Z')
    expect(upgradeEndsAt(now, readDuration({ days: '', hours: '', minutes: '1' }).ok ? 60_000 : null)).toBe('2026-11-12T10:01:00.000Z')
    expect(readDuration({ days: '365', hours: '23', minutes: '59' })).toEqual({ ok: true, ms: 365 * 86_400_000 + 23 * 3_600_000 + 59 * 60_000 })
  })

  it('rejects zero and invalid values', () => {
    expect(readDuration({ days: '0', hours: '0', minutes: '0' })).toMatchObject({ ok: false, error: expect.stringMatching(/more than zero/) })
    expect(readDuration({ days: '', hours: '0', minutes: '' })).toMatchObject({ ok: false })
    for (const bad of [{ hours: '-1' }, { hours: '1.5' }, { minutes: '1e3' }, { days: 'two' }, { hours: '24' }, { minutes: '60' }, { days: '366' }]) {
      expect(readDuration({ days: '', hours: '', minutes: '', ...bad }), JSON.stringify(bad)).toMatchObject({ ok: false })
    }
    expect(() => upgradeEndsAt(new Date('invalid'), 1000)).toThrow('now must be a valid date')
  })
})

describe('edit requests', () => {
  const idle = instance({ id: 7, instanceNumber: 2, level: 3 })
  const upgrading = instance({ id: 8, instanceNumber: 3, level: 3, targetLevel: 4, upgradeEndsAt: '2026-11-13T00:00:00.000Z', builderId: 101, builderAssignment: 'confirmed' })

  it('builds per-instance payloads', () => {
    expect(setLevelRequest(idle, 5, ' fixed ')).toEqual({
      id: 7, itemId: 'test-cannon', instanceNumber: 2, level: 5, targetLevel: null, upgradeStartedAt: null, upgradeEndsAt: null, builderId: null, note: 'fixed'
    })
    expect(addInstanceRequest('test-cannon', 4, 1)).toEqual({
      itemId: 'test-cannon', instanceNumber: 4, level: 1, targetLevel: null, upgradeStartedAt: null, upgradeEndsAt: null, builderId: null
    })
    expect(removeInstanceRequest(idle)).toEqual({ id: 7 })
    expect(removeInstanceRequest(idle, 'sold')).toEqual({ id: 7, note: 'sold' })
    expect(startUpgradeRequest(idle, { targetLevel: 4, builderId: 102, upgradeEndsAt: '2026-11-14T00:00:00.000Z' })).toEqual({
      id: 7, itemId: 'test-cannon', instanceNumber: 2, level: 3, targetLevel: 4, upgradeStartedAt: null, upgradeEndsAt: '2026-11-14T00:00:00.000Z', builderId: 102
    })
  })

  it('finishes at the target and cancels at the current level, clearing every upgrade field', () => {
    const cleared = { targetLevel: null, upgradeStartedAt: null, upgradeEndsAt: null, builderId: null }
    expect(finishUpgradeRequest(upgrading)).toEqual({ id: 8, itemId: 'test-cannon', instanceNumber: 3, level: 4, ...cleared })
    expect(cancelUpgradeRequest(upgrading)).toEqual({ id: 8, itemId: 'test-cannon', instanceNumber: 3, level: 3, ...cleared })
    expect(() => finishUpgradeRequest(idle)).toThrow('no active upgrade')
    expect(() => cancelUpgradeRequest(idle)).toThrow('no active upgrade')
    expect(() => assignBuilderRequest(idle, 101)).toThrow('no active upgrade')
    const unknown = instance({ id: 9, targetLevel: 4, builderAssignment: 'unknown' })
    expect(assignBuilderRequest(unknown, 104)).toMatchObject({ id: 9, level: 3, targetLevel: 4, builderId: 104 })
  })

  it('includes active upgrades in bulk edits only when selected and ticked', () => {
    const all = [idle, upgrading]
    expect(bulkSetLevelsRequest(all, { itemId: 'test-cannon', level: 2, selection: 'all', endUpgrades: new Set() })).toEqual({
      itemId: 'test-cannon', level: 2, instances: 'all'
    })
    expect(bulkSetLevelsRequest(all, { itemId: 'test-cannon', level: 2, selection: 'all', endUpgrades: new Set([8]) }).includeActiveUpgrades).toEqual([8])
    // Ticked but not selected, or ticked but idle: never included.
    expect(bulkSetLevelsRequest(all, { itemId: 'test-cannon', level: 2, selection: [7], endUpgrades: new Set([7, 8]) })).toEqual({
      itemId: 'test-cannon', level: 2, instances: [7]
    })
    expect(bulkSetCountRequest(all, { itemId: 'test-cannon', count: 1, removeInstances: [7], endUpgrades: new Set([8]) })).toEqual({
      itemId: 'test-cannon', count: 1, removeInstances: [7]
    })
    expect(bulkSetCountRequest(all, { itemId: 'test-cannon', count: 1, removeInstances: [8], endUpgrades: new Set([8]), note: 'gone' })).toEqual({
      itemId: 'test-cannon', count: 1, removeInstances: [8], includeActiveUpgrades: [8], note: 'gone'
    })
    expect(bulkSetCountRequest(all, { itemId: 'test-cannon', count: 4, levelForAdditions: 1, endUpgrades: new Set() })).toEqual({
      itemId: 'test-cannon', count: 4, levelForAdditions: 1
    })
  })
})

describe('bulk summaries', () => {
  const a = instance({ id: 21, instanceNumber: 1, level: 3 })
  const b = instance({ id: 22, instanceNumber: 2, level: 2 })
  const c = instance({ id: 23, instanceNumber: 3, level: 2 })
  const up = instance({ id: 24, instanceNumber: 4, level: 3, targetLevel: 4, builderId: 101, builderAssignment: 'confirmed' })
  const all = [up, c, a, b]

  it('lists every changed instance and every ended upgrade, never implying an unticked one', () => {
    const blocked = summariseBulkLevels(all, { level: 3, selection: 'all', endUpgrades: new Set() })
    expect(blocked).toEqual({
      changes: [
        { id: 22, instanceNumber: 2, fromLevel: 2, toLevel: 3, endsUpgradeTo: null },
        { id: 23, instanceNumber: 3, fromLevel: 2, toLevel: 3, endsUpgradeTo: null }
      ],
      unchanged: [1],
      needsUpgradeChoice: [4],
      wouldFinish: [],
      canConfirm: false
    })
    const ticked = summariseBulkLevels(all, { level: 3, selection: 'all', endUpgrades: new Set([24]) })
    expect(ticked.changes.at(-1)).toEqual({ id: 24, instanceNumber: 4, fromLevel: 3, toLevel: 3, endsUpgradeTo: 4 })
    expect(ticked.canConfirm).toBe(true)
    expect(summariseBulkLevels(all, { level: 4, selection: [24], endUpgrades: new Set([24]) })).toMatchObject({ wouldFinish: [4], canConfirm: false })
    expect(summariseBulkLevels(all, { level: 3, selection: [21], endUpgrades: new Set([24]) })).toMatchObject({ changes: [], unchanged: [1], canConfirm: false })
  })

  it('predicts the service default removals: idle, lowest level first, then highest number', () => {
    const one = summariseBulkCount(all, { count: 3, endUpgrades: new Set() })
    expect(one).toEqual({ kind: 'remove', removals: [{ id: 23, instanceNumber: 3, level: 2, endsUpgradeTo: null }], needsUpgradeChoice: [], canConfirm: true, problem: null })
    const three = summariseBulkCount(all, { count: 1, endUpgrades: new Set([24]) })
    expect(three.kind === 'remove' && three.removals.map((r) => r.instanceNumber)).toEqual([3, 2, 1])
    expect(three.kind === 'remove' && three.removals.every((r) => r.endsUpgradeTo === null)).toBe(true)
    expect(summariseBulkCount(all, { count: 0, endUpgrades: new Set() })).toMatchObject({ kind: 'remove', canConfirm: false, problem: expect.stringMatching(/Not enough idle instances/) })
  })

  it('requires an explicit tick to remove an upgrading instance, and the exact number', () => {
    expect(summariseBulkCount(all, { count: 3, removeInstances: [24], endUpgrades: new Set() })).toMatchObject({
      kind: 'remove', removals: [{ id: 24, endsUpgradeTo: null }], needsUpgradeChoice: [4], canConfirm: false
    })
    expect(summariseBulkCount(all, { count: 3, removeInstances: [24], endUpgrades: new Set([24]) })).toMatchObject({
      removals: [{ id: 24, endsUpgradeTo: 4 }], canConfirm: true
    })
    expect(summariseBulkCount(all, { count: 2, removeInstances: [21], endUpgrades: new Set() })).toMatchObject({ canConfirm: false, problem: 'Choose exactly 2 instances to remove' })
  })

  it('lists additions at the lowest free numbers and needs a level', () => {
    const gappy = [instance({ instanceNumber: 2 }), instance({ instanceNumber: 4 })]
    expect(summariseBulkCount(gappy, { count: 5, levelForAdditions: 1, endUpgrades: new Set() })).toEqual({ kind: 'add', additions: [1, 3, 5], level: 1, canConfirm: true, problem: null })
    expect(summariseBulkCount(gappy, { count: 3, endUpgrades: new Set() })).toMatchObject({ canConfirm: false, problem: 'Choose a level for the new instances' })
    expect(summariseBulkCount(gappy, { count: 2, endUpgrades: new Set() })).toEqual({ kind: 'none', canConfirm: false })
  })
})

describe('error messages', () => {
  it('shows service messages and hides internal details', () => {
    expect(toUserMessage({ code: 'VALIDATION_ERROR', message: 'Test Cannon #1 has an active upgrade' })).toBe('Test Cannon #1 has an active upgrade')
    expect(toUserMessage({ code: 'NOT_FOUND', message: 'No archived hero record 4' })).toBe('No archived hero record 4')
    expect(toUserMessage({ code: 'INTERNAL_ERROR', message: 'SQLITE_CONSTRAINT' })).toBe(GENERIC_ERROR_MESSAGE)
    expect(toUserMessage({ code: 'FORBIDDEN', message: 'sender rejected' })).toBe(GENERIC_ERROR_MESSAGE)
    expect(toUserMessage({ code: 'VALIDATION_ERROR', message: ' ' })).toBe(GENERIC_ERROR_MESSAGE)
    expect(toUserMessage(new Error('ipc channel closed'))).toBe(GENERIC_ERROR_MESSAGE)
    expect(toUserMessage('no-bridge')).toBe(NO_BRIDGE_MESSAGE)
  })
})
