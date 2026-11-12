import { describe, expect, it } from 'vitest'
import { parseGameCatalogue } from '../domain/catalogue-validation'
import { SAMPLE_ITEMS, SAMPLE_MANIFEST } from '../game-data/fixtures/sample-catalogue'
import { createCatalogueService, STALE_DATASET_AFTER_DAYS } from './catalogue-service'

const service = createCatalogueService(parseGameCatalogue(SAMPLE_MANIFEST, SAMPLE_ITEMS))

function ids(items: { id: string }[]): string[] {
  return items.map((item) => item.id)
}

describe('CatalogueService.getItems', () => {
  it('defaults to Home Village, sorted by category, unlock level then name', () => {
    expect(ids(service.getItems())).toEqual([
      'test-hall',
      'test-gold-mine',
      'test-cannon',
      'test-mortar',
      'test-spike-trap',
      'test-knight',
      'test-archer',
      'test-heal-spell',
      'test-decoration'
    ])
  })

  it('keeps Builder Base as a separate scope', () => {
    expect(ids(service.getItems({ gameMode: 'builder-base' }))).toEqual(['bb-test-cannon'])
  })

  it('filters by categories, search and Town Hall', () => {
    expect(ids(service.getItems({ categories: ['defense', 'trap'] }))).toEqual([
      'test-cannon',
      'test-mortar',
      'test-spike-trap'
    ])
    expect(ids(service.getItems({ categories: [] }))).toHaveLength(9)
    expect(ids(service.getItems({ search: '  MORT ' }))).toEqual(['test-mortar'])
    expect(ids(service.getItems({ search: 'spike-trap' }))).toEqual(['test-spike-trap'])
    expect(ids(service.getItems({ maxTownHall: 3, categories: ['defense'] }))).toEqual([
      'test-cannon',
      'test-mortar'
    ])
    expect(service.getItems({ maxTownHall: 1, search: 'mortar' })).toEqual([])
  })

  it('does not expose internal arrays to mutation', () => {
    service.getItems().pop()
    expect(service.getItems()).toHaveLength(9)
  })
})

describe('CatalogueService.getItem', () => {
  it('looks items up by id', () => {
    expect(service.getItem('test-knight')?.name).toBe('Test Knight')
    expect(service.getItem('missing')).toBeNull()
  })
})

describe('CatalogueService.getItemByGameDataId', () => {
  it('maps only ids that the catalogue declares', () => {
    expect(service.getItemByGameDataId(900000003)?.id).toBe('test-cannon')
    expect(service.getItemByGameDataId(1000008)).toBeNull()
  })
})

describe('CatalogueService.getDatasetInfo', () => {
  it('reports version, status, omissions and count', () => {
    const info = service.getDatasetInfo(new Date('2026-11-12T12:00:00.000Z'))
    expect(info).toEqual({
      datasetVersion: '0.0.1',
      gameVersion: null,
      releasedAt: '2026-11-12',
      validationStatus: 'unverified',
      knownOmissions: ['Synthetic test data; not a real catalogue.'],
      itemCount: 10,
      isStale: false,
      ageInDays: 0
    })
  })

  it('flags stale datasets', () => {
    const released = Date.parse('2026-11-12T00:00:00.000Z')
    const day = 24 * 60 * 60 * 1000
    const atLimit = new Date(released + STALE_DATASET_AFTER_DAYS * day)
    const past = new Date(released + (STALE_DATASET_AFTER_DAYS + 1) * day)
    expect(service.getDatasetInfo(atLimit).isStale).toBe(false)
    expect(service.getDatasetInfo(past)).toMatchObject({
      isStale: true,
      ageInDays: STALE_DATASET_AFTER_DAYS + 1
    })
  })
})
