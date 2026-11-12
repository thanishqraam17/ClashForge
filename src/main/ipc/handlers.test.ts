import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDatabase, type ClashForgeDatabase } from '../../database/client/database'
import {
  ALL_IPC_CHANNELS,
  type IpcResult,
  type VillageSaveInput
} from '../../shared/ipc/contracts'
import { parseGameCatalogue } from '../../domain/catalogue-validation'
import { SAMPLE_ITEMS, SAMPLE_MANIFEST } from '../../game-data/fixtures/sample-catalogue'
import { parseTownHallRules } from '../../domain/town-hall-rules-validation'
import { SAMPLE_TOWN_HALL_RULES } from '../../game-data/fixtures/sample-town-hall-rules'
import { createAssetService } from '../../services/asset-service'
import { createCatalogueService } from '../../services/catalogue-service'
import { createTownHallService } from '../../services/town-hall-service'
import { createIpcHandlers, type IpcHandlerMap } from './handlers'

const sampleCatalogue = parseGameCatalogue(SAMPLE_MANIFEST, SAMPLE_ITEMS)
const assets = createAssetService({
  assets: [
    {
      itemId: 'test-cannon',
      level: null,
      assetPath: 'defense/test-cannon.png',
      sourceName: 'Test source',
      sourceUrl: 'https://example.com/test',
      attribution: 'Test attribution',
      checksum: 'a'.repeat(64),
      lastVerifiedAt: '2026-11-12'
    }
  ]
})
const catalogue = createCatalogueService(sampleCatalogue)
const townHall = createTownHallService(
  sampleCatalogue,
  parseTownHallRules(SAMPLE_TOWN_HALL_RULES, sampleCatalogue)
)

const villageInput: VillageSaveInput = {
  townHallLevel: 9,
  gold: 1_000,
  elixir: 2_000,
  darkElixir: 30,
  goldCapacity: 8_000_000,
  elixirCapacity: 8_000_000,
  darkElixirCapacity: 300_000,
  builderCount: 4,
  availableBuilders: 2,
  lastScannedAt: '2026-09-14T10:30:00.000Z'
}

function expectOk<T>(result: IpcResult<T>): T {
  if (!result.ok) {
    throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`)
  }
  return result.data
}

describe('IPC handlers', () => {
  let dir: string
  let database: ClashForgeDatabase
  let handlers: IpcHandlerMap
  const logger = { error: vi.fn() }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clashforge-ipc-'))
    database = createDatabase({ dbPath: join(dir, 'test.db') })
    logger.error.mockReset()
    handlers = createIpcHandlers({ database, catalogue, townHall, assets, logger })
  })

  afterEach(() => {
    database.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('defines a handler for every contract channel', () => {
    expect(Object.keys(handlers).sort()).toEqual([...ALL_IPC_CHANNELS].sort())
  })

  it('returns null before a village exists, then saves and reads it as a DTO', () => {
    expect(expectOk(handlers['village:get-current'](undefined))).toBeNull()

    const saved = expectOk(handlers['village:save'](villageInput))
    expect(saved).toMatchObject({ id: 1, townHallLevel: 9, gold: 1_000 })
    expect(saved.lastScannedAt).toBe('2026-09-14T10:30:00.000Z')
    expect(typeof saved.createdAt).toBe('string')

    const updated = expectOk(handlers['village:save']({ ...villageInput, townHallLevel: 10 }))
    expect(updated.townHallLevel).toBe(10)
    expect(expectOk(handlers['village:get-current'](undefined))?.townHallLevel).toBe(10)
  })

  it('returns plain, structured-clone-safe data', () => {
    const saved = expectOk(handlers['village:save'](villageInput))
    expect(structuredClone(saved)).toEqual(saved)
    expect(JSON.parse(JSON.stringify(saved))).toEqual(saved)
  })

  it('rejects malformed payloads with VALIDATION_ERROR', () => {
    const cases: Array<[keyof IpcHandlerMap, unknown]> = [
      ['village:save', null],
      ['village:save', { ...villageInput, gold: -1 }],
      ['village:save', { ...villageInput, gold: 1.5 }],
      ['village:save', { ...villageInput, gold: '100' }],
      ['village:save', { ...villageInput, extra: true }],
      ['village:save', { ...villageInput, lastScannedAt: 'yesterday' }],
      ['village:get-current', { unexpected: 1 }],
      ['history:get-recent', { limit: 0 }],
      ['history:get-recent', { limit: 10_000 }]
    ]
    for (const [channel, payload] of cases) {
      const result = handlers[channel](payload)
      expect(result.ok, `${channel} ${JSON.stringify(payload)}`).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
      }
    }
  })

  it('surfaces domain validation errors as VALIDATION_ERROR', () => {
    expectOk(handlers['village:save'](villageInput))
    const result = handlers['buildings:save']({
      name: 'Army Camp',
      category: 'ARMY',
      level: 7,
      quantity: 1,
      isUpgrading: false,
      upgradeStartedAt: '2026-09-15T08:00:00.000Z',
      upgradeEndsAt: '2026-09-14T08:00:00.000Z'
    })
    expect(result).toEqual({
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'upgradeEndsAt cannot be before upgradeStartedAt'
      }
    })
  })

  it('requires a village before saving village items', () => {
    const result = handlers['heroes:save']({
      name: 'Barbarian King',
      level: 30,
      isUpgrading: false,
      upgradeStartedAt: null,
      upgradeEndsAt: null
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('VILLAGE_NOT_INITIALISED')
    }
  })

  it('creates and updates buildings, heroes and research', () => {
    expectOk(handlers['village:save'](villageInput))

    const building = expectOk(
      handlers['buildings:save']({
        name: 'Army Camp',
        category: 'ARMY',
        level: 7,
        quantity: 1,
        isUpgrading: true,
        upgradeStartedAt: '2026-09-14T08:00:00.000Z',
        upgradeEndsAt: '2026-09-15T08:00:00.000Z'
      })
    )
    expect(building.villageId).toBe(1)
    const updatedBuilding = expectOk(
      handlers['buildings:save']({
        id: building.id,
        name: 'Army Camp',
        category: 'ARMY',
        level: 8,
        quantity: 1,
        isUpgrading: false,
        upgradeStartedAt: null,
        upgradeEndsAt: null
      })
    )
    expect(updatedBuilding).toMatchObject({ id: building.id, level: 8, upgradeEndsAt: null })
    expect(expectOk(handlers['buildings:list'](undefined))).toHaveLength(1)

    const hero = expectOk(
      handlers['heroes:save']({
        name: 'Archer Queen',
        level: 30,
        isUpgrading: false,
        upgradeStartedAt: null,
        upgradeEndsAt: null
      })
    )
    expectOk(
      handlers['heroes:save']({
        id: hero.id,
        name: 'Archer Queen',
        level: 31,
        isUpgrading: false,
        upgradeStartedAt: null,
        upgradeEndsAt: null
      })
    )
    expect(expectOk(handlers['heroes:list'](undefined))[0]?.level).toBe(31)

    const research = expectOk(
      handlers['research:save']({
        name: 'Balloon',
        category: 'TROOP',
        level: 5,
        isResearching: true,
        researchStartedAt: null,
        researchEndsAt: '2026-09-20T00:00:00.000Z'
      })
    )
    expect(research.researchEndsAt).toBe('2026-09-20T00:00:00.000Z')
    expect(expectOk(handlers['research:list'](undefined))).toHaveLength(1)
  })

  it('returns NOT_FOUND when updating a record that does not exist', () => {
    expectOk(handlers['village:save'](villageInput))
    const result = handlers['buildings:save']({
      id: 999,
      name: 'Cannon',
      category: 'DEFENSE',
      level: 1,
      quantity: 1,
      isUpgrading: false,
      upgradeStartedAt: null,
      upgradeEndsAt: null
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND')
    }
    expect(expectOk(handlers['buildings:list'](undefined))).toHaveLength(0)
  })

  it('records history and returns the most recent entries with a limit', () => {
    expectOk(handlers['village:save'](villageInput))
    for (const toLevel of [2, 3, 4]) {
      expectOk(
        handlers['history:record']({
          entityType: 'building',
          entityName: 'Cannon',
          fromLevel: toLevel - 1,
          toLevel,
          startedAt: '2026-09-14T08:00:00.000Z',
          completedAt: null
        })
      )
    }
    expect(expectOk(handlers['history:get-recent'](undefined))).toHaveLength(3)
    const recent = expectOk(handlers['history:get-recent']({ limit: 2 }))
    expect(recent.map((entry) => entry.toLevel)).toEqual([4, 3])

    const invalidType = handlers['history:record']({
      entityType: 'wall',
      entityName: 'Wall',
      fromLevel: 1,
      toLevel: 2,
      startedAt: '2026-09-14T08:00:00.000Z',
      completedAt: null
    })
    expect(invalidType.ok).toBe(false)
  })

  it('queries the catalogue with validated filters', () => {
    const defenses = expectOk(
      handlers['catalogue:get-items']({ categories: ['defense'], maxTownHall: 2 })
    )
    expect(defenses.map((item) => item.id)).toEqual(['test-cannon'])
    expect(expectOk(handlers['catalogue:get-items'](undefined))).toHaveLength(9)
    expect(expectOk(handlers['catalogue:get-item']({ id: 'test-knight' }))?.name).toBe(
      'Test Knight'
    )
    expect(expectOk(handlers['catalogue:get-item']({ id: 'nope' }))).toBeNull()
    expect(expectOk(handlers['catalogue:get-dataset-info'](undefined)).itemCount).toBe(10)

    for (const payload of [
      { categories: ['castle'] },
      { categories: 'defense' },
      { gameMode: 'clan-capital' },
      { maxTownHall: 0 },
      { search: 5 },
      { sort: 'name' }
    ]) {
      const result = handlers['catalogue:get-items'](payload)
      expect(result.ok ? 'ok' : result.error.code, JSON.stringify(payload)).toBe(
        'VALIDATION_ERROR'
      )
    }
    const badId = handlers['catalogue:get-item']({ id: '../../etc' })
    expect(badId.ok ? 'ok' : badId.error.code).toBe('VALIDATION_ERROR')
  })

  it('serves Town Hall rules, summaries and comparisons', () => {
    expect(expectOk(handlers['town-hall:get-max'](undefined))).toEqual({
      'home-village': 8,
      'builder-base': 3
    })
    expect(
      expectOk(handlers['town-hall:get-item']({ itemId: 'test-cannon', townHall: 5 }))
    ).toMatchObject({ available: true, maxLevel: 6, maxQuantity: 3 })
    expect(
      expectOk(handlers['town-hall:get-item']({ itemId: 'unknown-item', townHall: 5 }))
    ).toBeNull()

    const summary = expectOk(handlers['town-hall:get-summary']({ townHall: 7 }))
    expect(summary.available.find((entry) => entry.itemId === 'test-knight')?.isNewlyUnlocked).toBe(
      true
    )
    const bb = expectOk(
      handlers['town-hall:get-summary']({ townHall: 1, gameMode: 'builder-base' })
    )
    expect(bb.available).toHaveLength(1)

    const comparison = expectOk(
      handlers['town-hall:compare']({ fromTownHall: 6, toTownHall: 7 })
    )
    expect(comparison.newlyUnlocked.map((entry) => entry.itemId)).toEqual(['test-knight'])
  })

  it('rejects invalid Town Hall requests with VALIDATION_ERROR', () => {
    const cases: Array<[keyof IpcHandlerMap, unknown]> = [
      ['town-hall:get-item', { itemId: 'test-cannon', townHall: 9 }],
      ['town-hall:get-item', { itemId: 'test-cannon', townHall: 0 }],
      ['town-hall:get-item', { itemId: 'Bad Id', townHall: 1 }],
      ['town-hall:get-summary', { townHall: 2.5 }],
      ['town-hall:get-summary', { townHall: 1, gameMode: 'clan-capital' }],
      ['town-hall:compare', { fromTownHall: 5, toTownHall: 3 }],
      ['town-hall:compare', { fromTownHall: 1 }],
      ['town-hall:get-max', { townHall: 1 }]
    ]
    for (const [channel, payload] of cases) {
      const result = handlers[channel](payload)
      expect(result.ok ? 'ok' : result.error.code, `${channel} ${JSON.stringify(payload)}`).toBe(
        'VALIDATION_ERROR'
      )
    }
  })

  it('resolves item images with fallback kinds and attributions', () => {
    expect(expectOk(handlers['assets:resolve']({ itemId: 'test-cannon' }))).toEqual({
      kind: 'canonical',
      itemId: 'test-cannon',
      url: 'clashforge-asset://bundled/defense/test-cannon.png',
      level: null,
      sourceName: 'Test source',
      sourceUrl: 'https://example.com/test',
      attribution: 'Test attribution',
      lastVerifiedAt: '2026-11-12'
    })
    expect(expectOk(handlers['assets:resolve']({ itemId: 'test-cannon', level: 4 })).kind).toBe(
      'generic'
    )
    expect(expectOk(handlers['assets:resolve']({ itemId: 'test-mortar', level: 1 }))).toEqual({
      kind: 'placeholder',
      itemId: 'test-mortar',
      url: null
    })
    expect(expectOk(handlers['assets:get-attributions'](undefined))).toHaveLength(1)

    for (const payload of [{ itemId: 'Bad Id' }, { itemId: 'test-cannon', level: 0 }, {}]) {
      const result = handlers['assets:resolve'](payload)
      expect(result.ok ? 'ok' : result.error.code).toBe('VALIDATION_ERROR')
    }
  })

  it('hides unexpected errors behind INTERNAL_ERROR and logs them locally', () => {
    database.close()
    const result = handlers['village:get-current'](undefined)
    expect(result).toEqual({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' }
    })
    expect(logger.error).toHaveBeenCalledOnce()
    // Reopen so afterEach can close cleanly.
    database = createDatabase({ dbPath: join(dir, 'test.db') })
  })
})
