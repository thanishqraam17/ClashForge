/**
 * TEST-ONLY sample catalogue. Item names, values and game data ids (9000000xx)
 * are synthetic and do not describe the real game. Never import this from
 * application code; the only exception is the development sample-data seed
 * (src/main/sample-data/sample-seed.ts), which production builds exclude.
 */

export const SAMPLE_MANIFEST = {
  datasetVersion: '0.0.1',
  gameVersion: null,
  releasedAt: '2026-11-12',
  validationStatus: 'unverified',
  knownOmissions: ['Synthetic test data; not a real catalogue.'],
  sources: [
    {
      id: 'test-fixture',
      name: 'ClashForge test fixture',
      kind: 'test-fixture',
      url: null,
      retrievedAt: null,
      notes: 'Synthetic values for automated tests only.'
    }
  ],
  changelog: [{ version: '0.0.1', date: '2026-11-12', changes: ['Test fixture.'] }]
}

function sampleItem(
  id: string,
  name: string,
  category: string,
  introducedAtTownHall: number,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id,
    name,
    category,
    subcategory: null,
    gameMode: 'home-village',
    introducedAtTownHall,
    isUpgradeable: true,
    isRepeatable: false,
    description: null,
    gameDataId: null,
    assetId: null,
    sourceIds: ['test-fixture'],
    lastVerifiedAt: null,
    ...extra
  }
}

export const SAMPLE_ITEMS = [
  sampleItem('test-hall', 'Test Hall', 'town-hall', 1, { gameDataId: 900000001 }),
  sampleItem('test-gold-mine', 'Test Gold Mine', 'resource', 1, { gameDataId: 900000002, isRepeatable: true }),
  sampleItem('test-cannon', 'Test Cannon', 'defense', 1, { gameDataId: 900000003, isRepeatable: true }),
  sampleItem('test-mortar', 'Test Mortar', 'defense', 3, {
    gameDataId: 900000004,
    isRepeatable: true,
    subcategory: 'splash'
  }),
  sampleItem('test-spike-trap', 'Test Spike Trap', 'trap', 4, { gameDataId: 900000005, isRepeatable: true }),
  sampleItem('test-knight', 'Test Knight', 'hero', 7, { gameDataId: 900000006 }),
  sampleItem('test-archer', 'Test Archer', 'troop', 1, { gameDataId: 900000007, subcategory: 'elixir-troop' }),
  sampleItem('test-heal-spell', 'Test Heal Spell', 'spell', 6, { gameDataId: 900000008 }),
  sampleItem('test-decoration', 'Test Decoration', 'other', 1, { isUpgradeable: false }),
  sampleItem('bb-test-cannon', 'Test Cannon', 'defense', 1, {
    gameMode: 'builder-base',
    isRepeatable: true
  })
]
