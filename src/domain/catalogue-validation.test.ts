import { describe, expect, it } from 'vitest'
import {
  CatalogueValidationError,
  parseGameCatalogue,
  validateGameCatalogue
} from './catalogue-validation'

function manifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    datasetVersion: '0.1.0',
    gameVersion: null,
    releasedAt: '2026-11-12',
    validationStatus: 'unverified',
    knownOmissions: ['Everything'],
    sources: [
      {
        id: 'fixture',
        name: 'Test fixture',
        kind: 'test-fixture',
        url: null,
        retrievedAt: null,
        notes: null
      }
    ],
    changelog: [{ version: '0.1.0', date: '2026-11-12', changes: ['Initial'] }],
    ...overrides
  }
}

function item(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'cannon',
    name: 'Cannon',
    category: 'defense',
    subcategory: null,
    gameMode: 'home-village',
    introducedAtTownHall: 1,
    isUpgradeable: true,
    isRepeatable: true,
    description: null,
    assetId: null,
    sourceIds: ['fixture'],
    lastVerifiedAt: null,
    ...overrides
  }
}

function issuePaths(rawManifest: unknown, rawItems: unknown): string[] {
  const result = validateGameCatalogue(rawManifest, rawItems)
  return result.ok ? [] : result.issues.map((issue) => issue.path)
}

describe('validateGameCatalogue', () => {
  it('accepts a well-formed catalogue, including an empty item list', () => {
    expect(validateGameCatalogue(manifest(), []).ok).toBe(true)
    const result = validateGameCatalogue(manifest(), [
      item(),
      item({ id: 'bb-cannon', gameMode: 'builder-base', name: 'Cannon' })
    ])
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.catalogue.items.map((entry) => entry.id)).toEqual(['cannon', 'bb-cannon'])
    }
  })

  it('rejects non-object inputs', () => {
    expect(issuePaths(null, [])).toEqual(['manifest'])
    expect(issuePaths(manifest(), {})).toEqual(['items'])
  })

  it('requires known omissions unless the dataset is verified', () => {
    expect(issuePaths(manifest({ knownOmissions: [] }), [])).toEqual([
      'manifest.knownOmissions'
    ])
    expect(
      validateGameCatalogue(manifest({ knownOmissions: [], validationStatus: 'verified' }), [])
        .ok
    ).toBe(true)
  })

  it('validates manifest version, dates, sources and changelog', () => {
    expect(issuePaths(manifest({ datasetVersion: 'v1' }), [])).toContain(
      'manifest.datasetVersion'
    )
    expect(issuePaths(manifest({ releasedAt: '12/11/2026' }), [])).toContain(
      'manifest.releasedAt'
    )
    expect(issuePaths(manifest({ datasetVersion: '0.2.0' }), [])).toContain(
      'manifest.changelog'
    )
    const badSource = manifest({
      sources: [
        { id: 'Bad Id', name: 'x', kind: 'rumour', url: 'http://x', retrievedAt: null, notes: null }
      ]
    })
    expect(issuePaths(badSource, [])).toEqual([
      'manifest.sources[0].id',
      'manifest.sources[0].url',
      'manifest.sources[0].kind'
    ])
  })

  it('rejects duplicate, malformed and mis-prefixed item ids', () => {
    expect(issuePaths(manifest(), [item(), item()])).toEqual(['items[1].id'])
    expect(issuePaths(manifest(), [item({ id: 'Archer Tower' })])).toEqual(['items[0].id'])
    expect(issuePaths(manifest(), [item({ gameMode: 'builder-base' })])).toEqual([
      'items[0].id'
    ])
    expect(issuePaths(manifest(), [item({ id: 'bb-cannon' })])).toEqual(['items[0].id'])
  })

  it('validates item fields and unknown keys', () => {
    expect(
      issuePaths(manifest(), [
        item({
          category: 'castle',
          introducedAtTownHall: 0,
          isRepeatable: 'yes',
          lastVerifiedAt: 'today',
          level: 3
        })
      ])
    ).toEqual([
      'items[0].level',
      'items[0].introducedAtTownHall',
      'items[0].category',
      'items[0].isRepeatable',
      'items[0].lastVerifiedAt'
    ])
  })

  it('requires items to reference declared sources', () => {
    expect(issuePaths(manifest(), [item({ sourceIds: [] })])).toEqual(['items[0].sourceIds'])
    expect(issuePaths(manifest(), [item({ sourceIds: ['wiki'] })])).toEqual([
      'items[0].sourceIds[0]'
    ])
  })
})

describe('parseGameCatalogue', () => {
  it('throws with every issue listed', () => {
    expect(() => parseGameCatalogue(manifest(), [item({ id: 'X' }), item({ name: '' })])).toThrow(
      CatalogueValidationError
    )
    try {
      parseGameCatalogue(manifest(), [item({ id: 'X' }), item({ name: '' })])
    } catch (error) {
      expect((error as CatalogueValidationError).issues).toHaveLength(2)
    }
  })
})
