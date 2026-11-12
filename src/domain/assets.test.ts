import { describe, expect, it } from 'vitest'
import { SAMPLE_ITEMS, SAMPLE_MANIFEST } from '../game-data/fixtures/sample-catalogue'
import { SAMPLE_TOWN_HALL_RULES } from '../game-data/fixtures/sample-town-hall-rules'
import { AssetManifestValidationError, parseAssetManifest, validateAssetManifest } from './assets'
import { parseGameCatalogue } from './catalogue-validation'
import { parseTownHallRules } from './town-hall-rules-validation'

const catalogue = parseGameCatalogue(SAMPLE_MANIFEST, SAMPLE_ITEMS)
const rules = parseTownHallRules(SAMPLE_TOWN_HALL_RULES, catalogue)

function entry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    itemId: 'test-cannon',
    level: 3,
    assetPath: 'defense/test-cannon-3.png',
    sourceName: 'Test source',
    sourceUrl: null,
    attribution: 'Test attribution',
    checksum: 'a'.repeat(64),
    lastVerifiedAt: '2026-11-12',
    ...overrides
  }
}

function issues(assets: unknown[]): string[] {
  const result = validateAssetManifest({ assets }, catalogue, rules)
  return result.ok ? [] : result.issues.map((issue) => `${issue.path}: ${issue.message}`)
}

describe('validateAssetManifest', () => {
  it('accepts canonical and level-specific entries, and an empty manifest', () => {
    expect(issues([])).toEqual([])
    expect(
      issues([entry(), entry({ level: null, assetPath: 'defense/test-cannon.png' })])
    ).toEqual([])
  })

  it('rejects non-objects and unknown fields', () => {
    expect(validateAssetManifest(null, catalogue, rules).ok).toBe(false)
    expect(issues([entry({ width: 64 })])).toEqual([
      'assets.assets[0].width: is not a recognised field'
    ])
  })

  it('rejects unknown items and impossible levels', () => {
    expect(issues([entry({ itemId: 'ghost' })])).toEqual([
      'assets.assets[0].itemId: unknown catalogue item "ghost"'
    ])
    expect(issues([entry({ level: 7 })])).toEqual([
      'assets.assets[0].level: exceeds the highest level of "test-cannon"'
    ])
    expect(issues([entry({ level: 0 })])).toEqual([
      'assets.assets[0].level: must be null or a positive integer'
    ])
    expect(
      issues([entry({ itemId: 'test-decoration', level: 1, assetPath: 'other/deco.png' })])
    ).toEqual(['assets.assets[0].level: must be null for an item that is not upgradeable'])
  })

  it('only allows safe, fixed asset paths', () => {
    for (const assetPath of ['../secret.png', 'defense/Cannon.png', 'cannon.png', 'a/b.svg', 'a/b/c.png']) {
      expect(issues([entry({ assetPath })]), assetPath).toHaveLength(1)
    }
  })

  it('requires provenance fields', () => {
    expect(
      issues([
        entry({
          sourceName: '',
          attribution: ' ',
          sourceUrl: 'http://example.com',
          checksum: 'ABC',
          lastVerifiedAt: 'soon'
        })
      ])
    ).toEqual([
      'assets.assets[0].sourceName: must be a non-empty string',
      'assets.assets[0].attribution: must be a non-empty string',
      'assets.assets[0].sourceUrl: must be null or an https URL',
      'assets.assets[0].checksum: must be a lowercase hex SHA-256',
      'assets.assets[0].lastVerifiedAt: must be a YYYY-MM-DD date'
    ])
  })

  it('rejects duplicate images and duplicate paths', () => {
    expect(issues([entry(), entry({ assetPath: 'defense/other.png' })])).toEqual([
      'assets.assets[1]: duplicate image for "test-cannon" at level 3'
    ])
    expect(issues([entry(), entry({ level: 2 })])).toEqual([
      'assets.assets[1].assetPath: duplicate asset path "defense/test-cannon-3.png"'
    ])
  })
})

describe('parseAssetManifest', () => {
  it('throws with every issue', () => {
    expect(() => parseAssetManifest({ assets: [entry({ itemId: 'x' })] }, catalogue, rules)).toThrow(
      AssetManifestValidationError
    )
  })
})
