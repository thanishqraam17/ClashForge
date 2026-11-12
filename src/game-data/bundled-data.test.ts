import { describe, expect, it } from 'vitest'
import { loadBundledGameCatalogue } from './index'

describe('bundled game data', () => {
  it('passes catalogue validation', () => {
    expect(() => loadBundledGameCatalogue()).not.toThrow()
  })

})
