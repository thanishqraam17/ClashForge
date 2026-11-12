import { describe, expect, it } from 'vitest'
import type { AssetEntry } from '../domain/assets'
import { createAssetService } from './asset-service'

function entry(itemId: string, level: number | null, overrides: Partial<AssetEntry> = {}): AssetEntry {
  return {
    itemId,
    level,
    assetPath: `test/${itemId}${level === null ? '' : `-${level}`}.png`,
    sourceName: 'Source A',
    sourceUrl: null,
    attribution: 'Attribution A',
    checksum: 'a'.repeat(64),
    lastVerifiedAt: '2026-11-12',
    ...overrides
  }
}

const service = createAssetService({
  assets: [
    entry('test-cannon', null),
    entry('test-cannon', 3),
    entry('test-mortar', 2, { sourceName: 'Source B', attribution: 'Attribution B' }),
    entry('test-hall', null)
  ]
})

describe('AssetService.resolve', () => {
  it('prefers exact-level artwork', () => {
    expect(service.resolve('test-cannon', 3)).toMatchObject({
      kind: 'exact-level',
      entry: { assetPath: 'test/test-cannon-3.png' }
    })
  })

  it('returns the canonical image when no level is requested', () => {
    expect(service.resolve('test-cannon')).toMatchObject({ kind: 'canonical' })
    expect(service.resolve('test-hall', null)).toMatchObject({ kind: 'canonical' })
  })

  it('labels the canonical image as generic when the requested level is missing', () => {
    expect(service.resolve('test-cannon', 5)).toMatchObject({
      kind: 'generic',
      entry: { assetPath: 'test/test-cannon.png' }
    })
  })

  it('never substitutes artwork from a different level', () => {
    expect(service.resolve('test-mortar', 1)).toEqual({ kind: 'placeholder', itemId: 'test-mortar' })
    expect(service.resolve('test-mortar')).toEqual({ kind: 'placeholder', itemId: 'test-mortar' })
    expect(service.resolve('unknown-item', 1)).toEqual({ kind: 'placeholder', itemId: 'unknown-item' })
  })
})

describe('AssetService.getByPath', () => {
  it('only knows manifest paths', () => {
    expect(service.getByPath('test/test-hall.png')?.itemId).toBe('test-hall')
    expect(service.getByPath('../test/test-hall.png')).toBeNull()
  })
})

describe('AssetService.getAttributions', () => {
  it('lists each distinct source once, sorted', () => {
    expect(service.getAttributions()).toEqual([
      { sourceName: 'Source A', sourceUrl: null, attribution: 'Attribution A' },
      { sourceName: 'Source B', sourceUrl: null, attribution: 'Attribution B' }
    ])
  })
})
