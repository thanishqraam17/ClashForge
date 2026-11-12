import { describe, expect, it } from 'vitest'
import { isUsable } from '../domain/export-semantics'
import { loadBundledGameData } from './index'

describe('bundled game data', () => {
  it('passes catalogue, town hall rule and asset validation', () => {
    expect(() => loadBundledGameData()).not.toThrow()
  })

})

describe('sample catalogue fixture', () => {
  it('is itself a valid catalogue', async () => {
    const { SAMPLE_ITEMS, SAMPLE_MANIFEST } = await import('./fixtures/sample-catalogue')
    const { validateGameCatalogue } = await import('../domain/catalogue-validation')
    expect(validateGameCatalogue(SAMPLE_MANIFEST, SAMPLE_ITEMS).ok).toBe(true)
  })
})

describe('bundled export semantics', () => {
  it('never lets an unverified timer change village state', () => {
    const { exportSemantics } = loadBundledGameData()
    for (const section of Object.keys(exportSemantics.sections)) {
      expect(isUsable(exportSemantics, section, 'upgrade-remaining-seconds'), section).toBe(false)
    }
  })

  it('keeps the missing-count rule marked as an inference', () => {
    const { exportSemantics } = loadBundledGameData()
    const rule = exportSemantics.rules.find((r) => r.meaning === 'missing-count-is-one')
    expect(rule?.status).toBe('inferred')
  })
})
