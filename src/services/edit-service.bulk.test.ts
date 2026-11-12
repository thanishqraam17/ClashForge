import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestDatabase, type TestDatabase } from '../database/repositories/test-helpers'
import { parseGameCatalogue } from '../domain/catalogue-validation'
import { parseTownHallRules } from '../domain/town-hall-rules-validation'
import { LOCAL_VILLAGE_ID } from '../domain/village'
import { VillageStateValidationError, type VillageItemInstance } from '../domain/village-state'
import { SAMPLE_ITEMS, SAMPLE_MANIFEST } from '../game-data/fixtures/sample-catalogue'
import { SAMPLE_TOWN_HALL_RULES } from '../game-data/fixtures/sample-town-hall-rules'
import { createEditService, type EditService } from './edit-service'
import { createTownHallService } from './town-hall-service'
import { createVillageStateService, type VillageStateService } from './village-state-service'

// Sample data plus a test-only wall item allowed 300 instances (synthetic values).
const WALL = {
  id: 'test-wall', name: 'Test Wall', category: 'wall', subcategory: null, gameMode: 'home-village',
  introducedAtTownHall: 1, isUpgradeable: true, isRepeatable: true, description: null, gameDataId: 900000099,
  assetId: null, sourceIds: ['test-fixture'], lastVerifiedAt: null
}
const catalogue = parseGameCatalogue(SAMPLE_MANIFEST, [...SAMPLE_ITEMS, WALL])
const rules = parseTownHallRules(
  {
    ...SAMPLE_TOWN_HALL_RULES,
    items: [...SAMPLE_TOWN_HALL_RULES.items, { itemId: 'test-wall', steps: [{ townHall: 1, maxLevel: 5, maxQuantity: 300 }], unlockRequires: [] }]
  },
  catalogue
)
const townHall = createTownHallService(catalogue, rules)

describe('EditService bulk correction', () => {
  let t: TestDatabase
  let villageState: VillageStateService
  let edits: EditService

  beforeEach(() => {
    t = createTestDatabase({ withVillage: true }) // Town Hall 5: cannon max level 6, max 3
    villageState = createVillageStateService({ database: t.database, catalogue, townHall })
    edits = createEditService({ database: t.database, villageState, catalogue, townHall })
  })

  afterEach(() => t.cleanup())

  const instances = (itemId = 'test-cannon') => t.database.villageItems.listByItem(LOCAL_VILLAGE_ID, itemId)
  const log = () => t.database.editLog.list(LOCAL_VILLAGE_ID, { limit: 200 })
  const add = (n: number, level: number, extra: Partial<VillageItemInstance> = {}) =>
    t.database.villageItems.create({
      villageId: 1, itemId: 'test-cannon', instanceNumber: n, level, targetLevel: null, upgradeStartedAt: null,
      upgradeEndsAt: null, builderId: null, builderAssignment: null, upgradeObservedTimer: null, upgradeObservedAt: null,
      source: 'data-export', confidence: 0.9, confirmedAt: null, ...extra
    })
  const upgrading = (n: number, level: number) => {
    const builder = t.database.builders.create({ villageId: 1, slot: n, source: 'manual', confidence: 1, confirmedAt: new Date(0) })
    return add(n, level, { targetLevel: level + 1, builderId: builder.id, builderAssignment: 'confirmed', source: 'manual', confidence: 1, confirmedAt: new Date(0) })
  }

  describe('setItemLevels', () => {
    it('changes only instances whose level differs, in place, with one shared batch', () => {
      const a = add(1, 3)
      const b = add(2, 4)
      const c = add(3, 3)
      const untouched = t.database.villageItems.getById(b.id)!
      const result = edits.setItemLevels({ itemId: 'test-cannon', level: 4, instances: 'all', note: 'corrected after checking' })
      expect(result.updated.sort()).toEqual([a.id, c.id].sort())
      expect(result.created).toEqual([])
      expect(result.removed).toEqual([])
      // Ids and instance numbers kept; changed ones are manual and confirmed now.
      expect(instances().map((i) => [i.id, i.instanceNumber, i.level, i.source])).toEqual([
        [a.id, 1, 4, 'manual'],
        [b.id, 2, 4, 'data-export'],
        [c.id, 3, 4, 'manual']
      ])
      expect(t.database.villageItems.getById(b.id)).toEqual(untouched)
      const entries = log()
      expect(entries).toHaveLength(2)
      expect(new Set(entries.map((e) => e.batchId))).toEqual(new Set([result.batchId]))
      expect(t.database.editLog.getBatch(result.batchId!).map((e) => e.entityId)).toEqual([a.id, c.id])
      expect(entries.every((e) => e.note === 'corrected after checking' && e.action === 'update')).toBe(true)
      const first = t.database.editLog.getBatch(result.batchId!)[0]!
      expect(first.before).toMatchObject({ level: 3, source: 'data-export', confidence: 0.9, confirmedAt: null })
      expect(first.after).toMatchObject({ level: 4, source: 'manual', confidence: 1 })
    })

    it('can target chosen instances only', () => {
      const a = add(1, 3)
      add(2, 3)
      const result = edits.setItemLevels({ itemId: 'test-cannon', level: 5, instances: [a.id] })
      expect(result.updated).toEqual([a.id])
      expect(instances().map((i) => i.level)).toEqual([5, 3])
    })

    it('writes nothing when every selected instance is already at the level', () => {
      add(1, 4)
      expect(edits.setItemLevels({ itemId: 'test-cannon', level: 4, instances: 'all' })).toEqual({
        batchId: null, created: [], updated: [], removed: []
      })
      expect(log()).toEqual([])
    })

    it('rejects invalid levels, selections and items', () => {
      const a = add(1, 3)
      const mortar = t.database.villageItems.create({ ...a, itemId: 'test-mortar', instanceNumber: 1 })
      const cases: Array<[() => unknown, RegExp | string]> = [
        [() => edits.setItemLevels({ itemId: 'test-cannon', level: 0, instances: 'all' }), 'level must be a positive integer'],
        [() => edits.setItemLevels({ itemId: 'test-cannon', level: 2.5, instances: 'all' }), 'level must be a positive integer'],
        [() => edits.setItemLevels({ itemId: 'test-cannon', level: 9, instances: 'all' }), /above Town Hall 5 limits: Test Cannon: level 9 recorded, limit 6/],
        [() => edits.setItemLevels({ itemId: 'test-cannon', level: 4, instances: [] }), /non-empty list/],
        [() => edits.setItemLevels({ itemId: 'test-cannon', level: 4, instances: [a.id, a.id] }), 'instances contains duplicates'],
        [() => edits.setItemLevels({ itemId: 'test-cannon', level: 4, instances: [mortar.id] }), `Not instances of this item: ${mortar.id}`],
        [() => edits.setItemLevels({ itemId: 'made-up', level: 1, instances: 'all' }), /not in the game catalogue/],
        [() => edits.setItemLevels({ itemId: 'test-archer', level: 1, instances: 'all' }), /not recorded as building instances/],
        [() => edits.setItemLevels({ itemId: 'bb-test-cannon', level: 1, instances: 'all' }), /Builder Base/],
        [() => edits.setItemLevels({ itemId: 'test-knight', level: 1, instances: 'all' }), /unlocks at Town Hall 7/]
      ]
      for (const [run, expected] of cases) expect(run).toThrow(expected)
      expect(instances().map((i) => i.level)).toEqual([3])
      expect(log()).toEqual([])
    })

    describe('active upgrades', () => {
      it('rejects an upgrading instance unless it is explicitly included', () => {
        const u = upgrading(1, 3)
        add(2, 3)
        expect(() => edits.setItemLevels({ itemId: 'test-cannon', level: 5, instances: 'all' })).toThrow(
          'Test Cannon #1 has an active upgrade; include it explicitly to end the upgrade'
        )
        expect(t.database.villageItems.getById(u.id)!.targetLevel).toBe(4)
        expect(log()).toEqual([])
      })

      it('ends an included upgrade and sets the level', () => {
        const u = upgrading(1, 3)
        edits.setItemLevels({ itemId: 'test-cannon', level: 5, instances: 'all', includeActiveUpgrades: [u.id] })
        expect(t.database.villageItems.getById(u.id)).toMatchObject({
          level: 5, targetLevel: null, builderId: null, builderAssignment: null, upgradeEndsAt: null
        })
      })

      it('never finishes an upgrade, even when included', () => {
        const u = upgrading(1, 3)
        expect(() =>
          edits.setItemLevels({ itemId: 'test-cannon', level: 4, instances: 'all', includeActiveUpgrades: [u.id] })
        ).toThrow('Test Cannon #1: a bulk edit never finishes an upgrade; edit it on its own')
        expect(t.database.villageItems.getById(u.id)).toMatchObject({ level: 3, targetLevel: 4 })
      })

      it('rejects inclusion lists that name idle or foreign instances', () => {
        const idle = add(1, 3)
        expect(() =>
          edits.setItemLevels({ itemId: 'test-cannon', level: 5, instances: 'all', includeActiveUpgrades: [idle.id] })
        ).toThrow('includeActiveUpgrades: #1 has no active upgrade')
        expect(() =>
          edits.setItemLevels({ itemId: 'test-cannon', level: 5, instances: 'all', includeActiveUpgrades: [999] })
        ).toThrow('includeActiveUpgrades: 999 is not an instance of this item')
      })
    })
  })

  describe('setItemCount', () => {
    it('adds idle, manual instances at the lowest free numbers and leaves existing ones untouched', () => {
      const existing = add(2, 4)
      const snapshot = t.database.villageItems.getById(existing.id)!
      const result = edits.setItemCount({ itemId: 'test-cannon', count: 3, levelForAdditions: 2 })
      expect(result.created).toHaveLength(2)
      expect(instances().map((i) => [i.instanceNumber, i.level, i.targetLevel, i.builderId, i.source])).toEqual([
        [1, 2, null, null, 'manual'],
        [2, 4, null, null, 'data-export'],
        [3, 2, null, null, 'manual']
      ])
      expect(t.database.villageItems.getById(existing.id)).toEqual(snapshot)
      expect(log().map((e) => [e.action, e.batchId === result.batchId])).toEqual([
        ['create', true],
        ['create', true]
      ])
    })

    it('needs a valid level for additions, and refuses removal lists when increasing', () => {
      expect(() => edits.setItemCount({ itemId: 'test-cannon', count: 1 })).toThrow(/levelForAdditions/)
      expect(() => edits.setItemCount({ itemId: 'test-cannon', count: 1, levelForAdditions: 0 })).toThrow(/levelForAdditions/)
      expect(() => edits.setItemCount({ itemId: 'test-cannon', count: 1, levelForAdditions: 7 })).toThrow(/level 7 recorded, limit 6/)
      expect(() => edits.setItemCount({ itemId: 'test-cannon', count: 1, levelForAdditions: 1, removeInstances: [1] })).toThrow(
        'removeInstances only applies when the count decreases'
      )
      expect(instances()).toEqual([])
    })

    it('rejects invalid counts and counts above the Town Hall limit', () => {
      expect(() => edits.setItemCount({ itemId: 'test-cannon', count: -1 })).toThrow('count must be a non-negative integer')
      expect(() => edits.setItemCount({ itemId: 'test-cannon', count: 1.5, levelForAdditions: 1 })).toThrow('count must be a non-negative integer')
      expect(() => edits.setItemCount({ itemId: 'test-cannon', count: 4, levelForAdditions: 1 })).toThrow(
        /above Town Hall 5 limits: Test Cannon: 4 recorded, limit 3/
      )
      expect(instances()).toEqual([])
      expect(log()).toEqual([])
    })

    it('does nothing for the same count', () => {
      add(1, 3)
      expect(edits.setItemCount({ itemId: 'test-cannon', count: 1 })).toEqual({ batchId: null, created: [], updated: [], removed: [] })
      expect(log()).toEqual([])
    })

    it('removes idle instances by default: lowest level first, then highest number', () => {
      add(1, 3)
      const b = add(2, 2)
      const c = add(3, 3)
      const result = edits.setItemCount({ itemId: 'test-cannon', count: 1 })
      expect(result.removed).toEqual([b.id, c.id])
      expect(instances().map((i) => i.instanceNumber)).toEqual([1])
      expect(log().map((e) => e.action)).toEqual(['delete', 'delete'])
      expect(t.database.editLog.getBatch(result.batchId!)[0]!.before).toMatchObject({ instanceNumber: 2, level: 2 })
    })

    it('never removes an upgrading instance by default', () => {
      upgrading(1, 3)
      add(2, 3)
      expect(() => edits.setItemCount({ itemId: 'test-cannon', count: 0 })).toThrow(
        'Only 1 Test Cannon is idle; name the instances to remove explicitly'
      )
      expect(instances()).toHaveLength(2)
    })

    it('removes named instances, requiring explicit inclusion for upgrading ones', () => {
      const u = upgrading(1, 3)
      add(2, 3)
      expect(() => edits.setItemCount({ itemId: 'test-cannon', count: 1, removeInstances: [u.id] })).toThrow(
        'Test Cannon #1 has an active upgrade; include it explicitly to remove it'
      )
      expect(() => edits.setItemCount({ itemId: 'test-cannon', count: 1, removeInstances: [] })).toThrow(/non-empty list/)
      expect(() => edits.setItemCount({ itemId: 'test-cannon', count: 0, removeInstances: [u.id] })).toThrow(
        'removeInstances must name exactly 2 instances'
      )
      const result = edits.setItemCount({ itemId: 'test-cannon', count: 1, removeInstances: [u.id], includeActiveUpgrades: [u.id] })
      expect(result.removed).toEqual([u.id])
      expect(instances().map((i) => i.instanceNumber)).toEqual([2])
    })
  })

  describe('scale, validation scope and rollback', () => {
    it('handles 300 walls within the limits', () => {
      const added = edits.setItemCount({ itemId: 'test-wall', count: 300, levelForAdditions: 1 })
      expect(added.created).toHaveLength(300)
      const raised = edits.setItemLevels({ itemId: 'test-wall', level: 5, instances: 'all' })
      expect(raised.updated).toHaveLength(300)
      expect(t.database.editLog.getBatch(raised.batchId!)).toHaveLength(300)
      expect(instances('test-wall').every((w) => w.level === 5)).toBe(true)
      expect(() => edits.setItemCount({ itemId: 'test-wall', count: 301, levelForAdditions: 1 })).toThrow(/limit 300/)
    })

    it('validates the whole resulting village, not just the edited item', () => {
      add(1, 3)
      // A pre-existing violation elsewhere (mortar above its TH5 limit of 3) blocks the edit (decision C).
      t.database.villageItems.create({
        villageId: 1, itemId: 'test-mortar', instanceNumber: 1, level: 5, targetLevel: null, upgradeStartedAt: null,
        upgradeEndsAt: null, builderId: null, builderAssignment: null, upgradeObservedTimer: null, upgradeObservedAt: null,
        source: 'manual', confidence: 1, confirmedAt: new Date(0)
      })
      expect(() => edits.setItemLevels({ itemId: 'test-cannon', level: 4, instances: 'all' })).toThrow(
        /Test Mortar: level 5 recorded, limit 3/
      )
      expect(instances()[0]!.level).toBe(3)
    })

    it('rolls back every instance change when the log write fails', () => {
      add(1, 3)
      add(2, 3)
      const failing = {
        ...t.database,
        editLog: {
          appendMany: () => {
            throw new Error('log write failed')
          }
        }
      } as unknown as typeof t.database
      const failingEdits = createEditService({
        database: failing,
        villageState: createVillageStateService({ database: failing, catalogue, townHall }),
        catalogue,
        townHall
      })
      expect(() => failingEdits.setItemLevels({ itemId: 'test-cannon', level: 5, instances: 'all' })).toThrow('log write failed')
      expect(() => failingEdits.setItemCount({ itemId: 'test-cannon', count: 3, levelForAdditions: 1 })).toThrow('log write failed')
      expect(() => failingEdits.setItemCount({ itemId: 'test-cannon', count: 0 })).toThrow('log write failed')
      expect(instances().map((i) => i.level)).toEqual([3, 3])
      expect(log()).toEqual([])
    })

    it('rolls back when a write fails part-way through', () => {
      const a = add(1, 3)
      add(2, 3)
      const failing = {
        ...t.database,
        villageItems: {
          ...Object.fromEntries(
            ['listByVillage', 'listByItem', 'getById', 'create', 'delete', 'getByBuilder'].map((m) => [
              m,
              (t.database.villageItems as unknown as Record<string, (...args: unknown[]) => unknown>)[m]!.bind(t.database.villageItems)
            ])
          ),
          update: (next: VillageItemInstance) => {
            if (next.id !== a.id) throw new Error('write failed part-way')
            return t.database.villageItems.update(next)
          }
        }
      } as unknown as typeof t.database
      const failingEdits = createEditService({
        database: failing,
        villageState: createVillageStateService({ database: failing, catalogue, townHall }),
        catalogue,
        townHall
      })
      expect(() => failingEdits.setItemLevels({ itemId: 'test-cannon', level: 5, instances: 'all' })).toThrow('write failed part-way')
      // The first instance had already been written; it is rolled back too.
      expect(instances().map((i) => i.level)).toEqual([3, 3])
      expect(log()).toEqual([])
    })

    it('throws validation errors of the expected type', () => {
      expect(() => edits.setItemCount({ itemId: 'test-cannon', count: -1 })).toThrow(VillageStateValidationError)
    })
  })
})
