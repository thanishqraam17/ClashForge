import { readFileSync } from 'fs'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestDatabase, type TestDatabase } from '../database/repositories/test-helpers'
import { parseGameCatalogue } from '../domain/catalogue-validation'
import { parseExportSemantics, type ExportSemantics } from '../domain/export-semantics'
import { parseTownHallRules } from '../domain/town-hall-rules-validation'
import { loadBundledGameData } from '../game-data'
import { SAMPLE_ITEMS, SAMPLE_MANIFEST } from '../game-data/fixtures/sample-catalogue'
import { SAMPLE_TOWN_HALL_RULES } from '../game-data/fixtures/sample-town-hall-rules'
import { createTownHallService } from '../services/town-hall-service'
import { createVillageStateService, type VillageStateService } from '../services/village-state-service'
import { parseExport } from './export-parser'
import {
  buildImportPlan,
  fingerprintState,
  UnsupportedSemanticsError,
  type ImportChange,
  type ImportPlan
} from './import-planner'

const bundled = loadBundledGameData()
const SEMANTICS = bundled.exportSemantics
const KNOWN = Object.keys(SEMANTICS.sections)
const sampleCatalogue = parseGameCatalogue(SAMPLE_MANIFEST, SAMPLE_ITEMS)
const sampleRules = parseTownHallRules(SAMPLE_TOWN_HALL_RULES, sampleCatalogue)
const sampleTownHall = createTownHallService(sampleCatalogue, sampleRules)

/** Fake game data ids of the sample catalogue (see sample-catalogue.ts). */
const ID = {
  hall: 900000001,
  cannon: 900000003,
  mortar: 900000004,
  spikeTrap: 900000005,
  knight: 900000006,
  archer: 900000007,
  healSpell: 900000008
}

/** Same semantics, but with the timer rule marked verified (for testing only). */
const VERIFIED_TIMERS: ExportSemantics = parseExportSemantics({
  ...JSON.parse(JSON.stringify(SEMANTICS)),
  rules: SEMANTICS.rules.map((r) =>
    r.meaning === 'upgrade-remaining-seconds'
      ? { ...r, status: 'verified', sections: ['buildings', 'traps', 'heroes'], evidence: 'test' }
      : r
  )
})

function exportText(sections: Record<string, unknown>): string {
  return JSON.stringify({ tag: '#REDACTED', timestamp: 1704067200, buildings: [], ...sections })
}

describe('buildImportPlan', () => {
  let t: TestDatabase
  let villageState: VillageStateService

  beforeEach(() => {
    t = createTestDatabase({ withVillage: true }) // Town Hall 5
    villageState = createVillageStateService({
      database: t.database,
      catalogue: sampleCatalogue,
      townHall: sampleTownHall
    })
  })

  afterEach(() => t.cleanup())

  function plan(text: string, semantics: ExportSemantics = SEMANTICS): ImportPlan {
    const parsed = parseExport(text, KNOWN)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues))
    const s = villageState.getState()!
    return buildImportPlan({
      parsed: parsed.export,
      catalogue: sampleCatalogue,
      semantics,
      townHall: sampleTownHall,
      coverage: villageState.getCoverage(),
      state: { village: s.village, items: s.items, research: s.research }
    })
  }

  function change(p: ImportPlan, id: string): ImportChange {
    const found = p.changes.find((c) => c.id === id)
    if (!found) throw new Error(`no change ${id}; have ${p.changes.map((c) => c.id).join(', ')}`)
    return found
  }

  function addCannons(levels: number[], upgradingIndex?: number) {
    const builders = villageState.setBuilderCount(3)
    levels.forEach((level, i) =>
      villageState.saveItemInstance({
        itemId: 'test-cannon',
        instanceNumber: i + 1,
        level,
        targetLevel: i === upgradingIndex ? level + 1 : null,
        upgradeStartedAt: null,
        upgradeEndsAt: null,
        builderId: i === upgradingIndex ? builders[0]!.id : null
      })
    )
  }

  it('adds instances from explicit counts as observed data', () => {
    const p = plan(
      exportText({
        buildings: [
          { data: ID.hall, lvl: 5, cnt: 1 },
          { data: ID.cannon, lvl: 3, cnt: 2 },
          { data: ID.cannon, lvl: 4, cnt: 1 }
        ]
      })
    )
    expect(p.townHall).toEqual({ status: 'detected', currentLevel: 5, exportedLevel: 5 })
    const add = change(p, 'instances:test-cannon:add')
    expect(add).toMatchObject({
      kind: 'add-instances',
      instances: [
        { instanceNumber: 1, level: 3 },
        { instanceNumber: 2, level: 3 },
        { instanceNumber: 3, level: 4 }
      ],
      basis: 'observed',
      confidence: 0.95,
      requiresIndividualAcceptance: false,
      conflicts: [],
      blockedReason: null
    })
    expect(p.inferredCounts).toEqual([])
    expect(p.untouched).toEqual(['resources', 'storage capacities', 'builder count'])
  })

  it('marks changes that rely on a missing count as inferred, with lower confidence', () => {
    const p = plan(exportText({ traps: [{ data: ID.spikeTrap, lvl: 2, cnt: 1 }, { data: ID.spikeTrap, lvl: 2 }] }))
    // Spike trap unlocks at TH4; village is TH5.
    expect(change(p, 'instances:test-spike-trap:add')).toMatchObject({ basis: 'inferred', confidence: 0.8 })
    expect(p.inferredCounts).toEqual([{ section: 'traps', position: 1, dataId: ID.spikeTrap }])
  })

  it('keeps upgrading instances untouched when the export allows it', () => {
    addCannons([3, 3], 0) // #1 upgrading 3->4, #2 idle
    const p = plan(exportText({ buildings: [{ data: ID.cannon, lvl: 3, cnt: 1 }, { data: ID.cannon, lvl: 5, cnt: 1 }] }))
    const levels = change(p, 'instances:test-cannon:levels')
    expect(levels).toMatchObject({
      instances: [{ instanceNumber: 2, fromLevel: 3, toLevel: 5 }],
      conflicts: [],
      requiresIndividualAcceptance: false
    })
  })

  it('never pins a possibly completed upgrade on an idle instance (audit F1)', () => {
    addCannons([3, 3], 0) // #1 upgrading 3 -> 4, #2 idle at 3
    const p = plan(exportText({ buildings: [{ data: ID.cannon, lvl: 3, cnt: 1 }, { data: ID.cannon, lvl: 4, cnt: 1 }] }))
    expect(p.changes.map((c) => c.kind)).toEqual(['ambiguous-instances'])
    const change = p.changes[0] as Extract<ImportChange, { kind: 'ambiguous-instances' }>
    expect(change.interpretations).toHaveLength(2)
    expect(change.interpretations[1]!.operations.completions).toEqual([
      expect.objectContaining({ instanceNumber: 1, fromLevel: 3, toLevel: 4 })
    ])
  })

  it('uses exported multiplicity: {3, 3} leaves the upgrade alone with no ambiguity', () => {
    addCannons([3, 3], 0)
    const p = plan(exportText({ buildings: [{ data: ID.cannon, lvl: 3, cnt: 2 }] }))
    expect(p.changes).toEqual([])
  })

  it('uses inferred counts as multiplicity too', () => {
    addCannons([3, 3], 0)
    const p = plan(exportText({ buildings: [{ data: ID.cannon, lvl: 3 }, { data: ID.cannon, lvl: 4 }] }))
    const change = p.changes[0] as Extract<ImportChange, { kind: 'ambiguous-instances' }>
    expect(change).toMatchObject({ kind: 'ambiguous-instances', basis: 'inferred', confidence: 0.8 })
    expect(change.interpretations).toHaveLength(2)
  })

  it('turns any change to an active upgrade into a conflict, whatever its source', () => {
    addCannons([3, 3], 0)
    const p = plan(exportText({ buildings: [{ data: ID.cannon, lvl: 5, cnt: 2 }] }))
    const levels = change(p, 'instances:test-cannon:levels')
    expect(levels.requiresIndividualAcceptance).toBe(true)
    expect(levels.conflicts).toEqual([
      expect.objectContaining({
        kind: 'item-upgrade',
        instanceNumber: 1,
        currentLevel: 3,
        targetLevel: 4,
        source: 'manual',
        builderAssignment: 'confirmed'
      })
    ])
  })

  it('proposes removals only as individually accepted changes, with conflicts for upgrades', () => {
    addCannons([3, 4, 5], 2)
    const p = plan(exportText({ buildings: [{ data: ID.cannon, lvl: 3, cnt: 1 }] }))
    const remove = change(p, 'instances:test-cannon:remove')
    expect(remove).toMatchObject({ kind: 'remove-instances', requiresIndividualAcceptance: true })
    expect((remove as Extract<ImportChange, { kind: 'remove-instances' }>).instances.map((i) => i.instanceNumber)).toEqual([2, 3])
    expect(remove.conflicts.map((c) => c.instanceNumber)).toEqual([3])
  })

  it('plans research levels and protects active research', () => {
    const village = t.database.villages.getVillage()!
    t.database.villages.updateVillage({ ...village, townHallLevel: 6 })
    villageState.saveResearch({ itemId: 'test-archer', level: 2, targetLevel: 3, researchStartedAt: null, researchEndsAt: null })
    const p = plan(exportText({ units: [{ data: ID.archer, lvl: 3 }], spells: [{ data: ID.healSpell, lvl: 1 }] }))
    expect(change(p, 'research:test-archer')).toMatchObject({
      kind: 'set-research',
      fromLevel: 2,
      toLevel: 3,
      requiresIndividualAcceptance: true,
      conflicts: [expect.objectContaining({ kind: 'research', currentLevel: 2, targetLevel: 3 })]
    })
    expect(change(p, 'research:test-heal-spell')).toMatchObject({ fromLevel: null, toLevel: 1, conflicts: [] })
  })

  it('never turns an unverified timer into an upgrade, but records it', () => {
    const p = plan(exportText({ traps: [{ data: ID.spikeTrap, lvl: 2, timer: 600 }], heroes: [] }))
    expect(p.changes.some((c) => c.kind === 'imported-upgrades')).toBe(false)
    expect(p.unverifiedTimers).toEqual([{ section: 'traps', position: 0, dataId: ID.spikeTrap, level: 2, timer: 600 }])
    expect(p.observations[0]).toMatchObject({ timer: 600, timerDisposition: 'ignored-unverified' })
  })

  it('does not treat a timer as an upgrade unless its rule is verified (not merely observed)', () => {
    const observedTimers = parseExportSemantics({
      ...JSON.parse(JSON.stringify(SEMANTICS)),
      rules: SEMANTICS.rules.map((r) =>
        r.meaning === 'upgrade-remaining-seconds' ? { ...r, status: 'observed', evidence: 'test' } : r
      )
    })
    const p = plan(exportText({ traps: [{ data: ID.spikeTrap, lvl: 1, timer: 600 }] }), observedTimers)
    expect(p.changes.some((c) => c.kind === 'imported-upgrades')).toBe(false)
    expect(p.unverifiedTimers).toHaveLength(1)
  })

  it('creates imported upgrades with the raw timer only when timers are verified', () => {
    const p = plan(exportText({ traps: [{ data: ID.spikeTrap, lvl: 1, timer: 600 }] }), VERIFIED_TIMERS)
    expect(change(p, 'instances:test-spike-trap:upgrades-new')).toMatchObject({
      kind: 'imported-upgrades',
      instances: [{ instanceId: null, instanceNumber: 1, level: 1, observedTimer: 600 }],
      dependsOn: 'instances:test-spike-trap:add'
    })
    expect(p.observations[0]!.timerDisposition).toBe('applied-as-upgrade')
  })

  it('refuses verified research timers instead of ignoring them silently', () => {
    const researchTimers = parseExportSemantics({
      ...JSON.parse(JSON.stringify(SEMANTICS)),
      rules: SEMANTICS.rules.map((r) =>
        r.meaning === 'upgrade-remaining-seconds' ? { ...r, status: 'verified', evidence: 'test' } : r
      )
    })
    expect(() => plan(exportText({ units: [{ data: ID.archer, lvl: 1, timer: 5 }] }), researchTimers)).toThrow(
      UnsupportedSemanticsError
    )
  })

  it('proposes a Town Hall change and validates other changes against it', () => {
    const p = plan(
      exportText({
        buildings: [{ data: ID.hall, lvl: 6, cnt: 1 }],
        spells: [{ data: ID.healSpell, lvl: 1 }]
      })
    )
    expect(change(p, 'town-hall')).toMatchObject({ kind: 'set-town-hall', fromLevel: 5, toLevel: 6 })
    // Heal spell unlocks at TH6, so it is only valid together with the Town Hall change.
    expect(change(p, 'research:test-heal-spell')).toMatchObject({ blockedReason: null, dependsOn: 'town-hall' })
  })

  it('blocks a Town Hall downgrade that would leave uncovered items above the limits', () => {
    for (const n of [1, 2, 3]) {
      villageState.saveItemInstance({
        itemId: 'test-cannon', instanceNumber: n, level: 6, targetLevel: null,
        upgradeStartedAt: null, upgradeEndsAt: null, builderId: null
      })
    }
    const p = plan(exportText({ buildings: [{ data: ID.hall, lvl: 2, cnt: 1 }] }))
    expect(change(p, 'town-hall').blockedReason).toBe(
      'Town Hall 2 would leave the village above its limits: Test Cannon: 3 recorded, limit 2; Test Cannon: level 6 recorded, limit 2'
    )
  })

  it('allows a Town Hall downgrade when the export itself covers the affected items', () => {
    for (const n of [1, 2, 3]) {
      villageState.saveItemInstance({
        itemId: 'test-cannon', instanceNumber: n, level: 6, targetLevel: null,
        upgradeStartedAt: null, upgradeEndsAt: null, builderId: null
      })
    }
    const p = plan(exportText({ buildings: [{ data: ID.hall, lvl: 2, cnt: 1 }, { data: ID.cannon, lvl: 2, cnt: 2 }] }))
    expect(change(p, 'town-hall').blockedReason).toBeNull()
    expect(change(p, 'instances:test-cannon:levels').blockedReason).toBeNull()
  })

  it('counts upgrade targets when checking a Town Hall downgrade', () => {
    const [b] = villageState.setBuilderCount(1)
    villageState.saveItemInstance({
      itemId: 'test-cannon', instanceNumber: 1, level: 2, targetLevel: 3,
      upgradeStartedAt: null, upgradeEndsAt: null, builderId: b!.id
    })
    const p = plan(exportText({ buildings: [{ data: ID.hall, lvl: 2, cnt: 1 }] }))
    expect(change(p, 'town-hall').blockedReason).toBe(
      'Town Hall 2 would leave the village above its limits: Test Cannon: level 3 recorded, limit 2'
    )
  })

  it('blocks changes that break Town Hall limits', () => {
    const p = plan(exportText({ buildings: [{ data: ID.cannon, lvl: 9, cnt: 1 }, { data: ID.knight, lvl: 1, cnt: 1 }] }))
    expect(change(p, 'instances:test-cannon:add').blockedReason).toBe(
      'Test Cannon cannot be above level 6 at Town Hall 5'
    )
  })

  it('reports unmapped ids, wrong-section ids and out-of-scope sections', () => {
    const p = plan(
      exportText({
        buildings: [{ data: 1000008, lvl: 2, cnt: 1 }, { data: ID.archer, lvl: 1, cnt: 1 }],
        equipment: [{ data: 90000000, lvl: 1 }]
      })
    )
    expect(p.unmapped).toEqual([
      { section: 'buildings', dataId: 1000008, entries: 1, note: 'No catalogue item has this game data id yet' },
      { section: 'buildings', dataId: ID.archer, entries: 1, note: 'Id maps to Test Archer, which cannot appear in "buildings"' }
    ])
    expect(p.outOfScopeSections).toEqual([{ section: 'equipment', entries: 1 }])
    expect(p.changes).toEqual([])
  })

  it('fingerprints the state so stale previews can be detected', () => {
    const before = fingerprintState({ ...villageState.getState()!, items: [], research: [] })
    addCannons([3])
    const s = villageState.getState()!
    expect(fingerprintState({ village: s.village, items: s.items, research: s.research })).not.toBe(before)
  })
})

describe('buildImportPlan with the bundled (empty) catalogue and the redacted fixture', () => {
  it('maps nothing, records every observation and every timer, and proposes no changes', () => {
    const t = createTestDatabase({ withVillage: true })
    try {
      const townHall = createTownHallService(bundled.catalogue, bundled.townHallRules)
      const villageState = createVillageStateService({ database: t.database, catalogue: bundled.catalogue, townHall })
      const text = readFileSync(join(__dirname, 'fixtures', 'export-redacted.json'), 'utf8')
      const parsed = parseExport(text, KNOWN)
      if (!parsed.ok) throw new Error('fixture should parse')
      const s = villageState.getState()!
      const p = buildImportPlan({
        parsed: parsed.export,
        catalogue: bundled.catalogue,
        semantics: SEMANTICS,
        townHall,
        coverage: villageState.getCoverage(),
        state: { village: s.village, items: s.items, research: s.research }
      })
      expect(p.changes).toEqual([])
      expect(p.coverage.canRecordItems).toBe(false)
      expect(p.townHall.status).toBe('not-mapped')
      expect(p.observations).toHaveLength(169)
      expect(p.observations.some((o) => o.classification === 'mapped')).toBe(false)
      expect(p.unverifiedTimers).toHaveLength(7)
      expect(p.observations.filter((o) => o.timer !== null).every((o) => o.timerDisposition === 'ignored-unverified')).toBe(true)
      expect(p.outOfScopeSections.map((s) => s.section)).toEqual([
        'helpers', 'decos', 'equipment', 'buildings2', 'traps2', 'obstacles2', 'units2'
      ])
    } finally {
      t.cleanup()
    }
  })
})
