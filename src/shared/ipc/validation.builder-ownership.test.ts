import { describe, expect, it } from 'vitest'
import {
  IpcInputError,
  parseBuildersReclassifyLegacyInput,
  parseBuildersRemoveUnclassifiedInput,
  parseBuildersSetBobInput,
  parseBuildersSetOrdinaryCountInput
} from './validation'

const bad = (parse: (v: unknown) => unknown, value: unknown) =>
  expect(() => parse(value), JSON.stringify(value)).toThrow(IpcInputError)

describe('IPC validation for Home Village builder ownership', () => {
  it('bounds ordinary huts to 0-5', () => {
    expect(parseBuildersSetOrdinaryCountInput({ count: 0 })).toEqual({ count: 0 })
    expect(parseBuildersSetOrdinaryCountInput({ count: 5 })).toEqual({ count: 5 })
    for (const value of [{ count: 6 }, { count: -1 }, { count: 2.5 }, { count: '3' }, {}, null, { count: 1, extra: 1 }]) {
      bad(parseBuildersSetOrdinaryCountInput, value)
    }
  })

  it('requires a real boolean for B.O.B.', () => {
    expect(parseBuildersSetBobInput({ unlocked: true })).toEqual({ unlocked: true })
    expect(parseBuildersSetBobInput({ unlocked: false, note: 'checked' })).toEqual({ unlocked: false, note: 'checked' })
    for (const value of [{ unlocked: 'true' }, { unlocked: 1 }, { unlocked: null }, {}]) {
      bad(parseBuildersSetBobInput, value)
    }
  })

  it('accepts true, false or unsure for bob, and bounds ordinaryCount the same way', () => {
    expect(parseBuildersReclassifyLegacyInput({ ordinaryCount: 3, bob: 'unsure' })).toEqual({
      ordinaryCount: 3,
      bob: 'unsure'
    })
    expect(parseBuildersReclassifyLegacyInput({ ordinaryCount: 5, bob: true })).toEqual({ ordinaryCount: 5, bob: true })
    expect(parseBuildersReclassifyLegacyInput({ ordinaryCount: 0, bob: false })).toEqual({ ordinaryCount: 0, bob: false })
    for (const value of [
      { ordinaryCount: 6, bob: 'unsure' },
      { ordinaryCount: 1, bob: 'maybe' },
      { ordinaryCount: 1, bob: 1 },
      { ordinaryCount: 1 }
    ]) {
      bad(parseBuildersReclassifyLegacyInput, value)
    }
  })

  it('requires a positive id to remove', () => {
    expect(parseBuildersRemoveUnclassifiedInput({ id: 1 })).toEqual({ id: 1 })
    for (const value of [{ id: 0 }, { id: -1 }, { id: 1.5 }, { id: '1' }, {}]) {
      bad(parseBuildersRemoveUnclassifiedInput, value)
    }
  })
})
