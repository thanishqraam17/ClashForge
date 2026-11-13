import { describe, expect, it } from 'vitest'
import type { BuilderDto } from '../../../shared/ipc/contracts'
import {
  reclassifyLegacyRequest,
  removeUnclassifiedRequest,
  setBobRequest,
  setOrdinaryHutsRequest
} from './edit-requests'
import {
  HOME_VILLAGE_BUILDER_MAX,
  legacyUnclassifiedBuilders,
  ORDINARY_BUILDER_HUT_MAX,
  summariseHomeVillageBuilderOwnership
} from './village-view-model'

const prov = { source: 'manual' as const, confidence: 1, confirmedAt: '2026-11-12T00:00:00.000Z' }

function builder(id: number, slot: number, kind: BuilderDto['kind']): BuilderDto {
  return { id, slot, kind, status: 'free', assignedItemInstanceId: null, ...prov }
}

describe('Home Village builder ownership (renderer)', () => {
  it('mirrors the server: constants match, and counts legacy rows toward neither confirmed total', () => {
    expect(ORDINARY_BUILDER_HUT_MAX).toBe(5)
    expect(HOME_VILLAGE_BUILDER_MAX).toBe(6)
    const builders = [
      builder(1, 1, 'ordinary'),
      builder(2, 2, 'ordinary'),
      builder(3, 3, 'bob'),
      builder(4, 4, 'legacy-unclassified'),
      builder(5, 5, 'legacy-unclassified')
    ]
    expect(summariseHomeVillageBuilderOwnership(builders)).toEqual({
      ordinaryConfirmed: 2,
      bobConfirmed: true,
      legacyUnclassified: 2,
      totalSlots: 5,
      exceedsLimit: false
    })
  })

  it('flags exceedsLimit only once confirmed plus legacy actually exceeds 6', () => {
    const six = Array.from({ length: 6 }, (_, i) => builder(i + 1, i + 1, 'legacy-unclassified'))
    expect(summariseHomeVillageBuilderOwnership(six).exceedsLimit).toBe(false)
    const seven = [...six, builder(7, 7, 'legacy-unclassified')]
    expect(summariseHomeVillageBuilderOwnership(seven).exceedsLimit).toBe(true)
  })

  it('lists legacy-unclassified builders only, sorted for stable display', () => {
    const builders = [
      builder(3, 3, 'legacy-unclassified'),
      builder(1, 1, 'ordinary'),
      builder(2, 2, 'legacy-unclassified'),
      builder(4, 4, 'bob')
    ]
    expect(legacyUnclassifiedBuilders(builders).map((b) => b.id)).toEqual([2, 3])
  })

  it('builds the exact four ownership payloads', () => {
    expect(setOrdinaryHutsRequest(3)).toEqual({ count: 3 })
    expect(setOrdinaryHutsRequest(0, 'corrected')).toEqual({ count: 0, note: 'corrected' })
    expect(setBobRequest(true)).toEqual({ unlocked: true })
    expect(setBobRequest(false, 'retracted')).toEqual({ unlocked: false, note: 'retracted' })
    expect(reclassifyLegacyRequest(5, 'unsure')).toEqual({ ordinaryCount: 5, bob: 'unsure' })
    expect(reclassifyLegacyRequest(2, true, 'confirmed')).toEqual({ ordinaryCount: 2, bob: true, note: 'confirmed' })
    expect(removeUnclassifiedRequest(9)).toEqual({ id: 9 })
    expect(removeUnclassifiedRequest(9, 'duplicate')).toEqual({ id: 9, note: 'duplicate' })
  })
})
