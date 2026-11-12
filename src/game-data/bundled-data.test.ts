import { describe, expect, it } from 'vitest'
import { loadBundledGameCatalogue } from './index'

describe('bundled game data', () => {
  it('passes catalogue validation', () => {
    expect(() => loadBundledGameCatalogue()).not.toThrow()
  })

})

describe('sample catalogue fixture', () => {
  it('is itself a valid catalogue', async () => {
    const { SAMPLE_ITEMS, SAMPLE_MANIFEST } = await import('./fixtures/sample-catalogue')
    const { validateGameCatalogue } = await import('../domain/catalogue-validation')
    expect(validateGameCatalogue(SAMPLE_MANIFEST, SAMPLE_ITEMS).ok).toBe(true)
  })
})
