import {
  ITEM_CATEGORIES,
  type CatalogueItem,
  type GameCatalogue,
  type GameMode,
  type ItemCategory,
  type ItemId,
  type ValidationStatus
} from '../domain/catalogue'

export type CatalogueFilters = {
  /** Defaults to `home-village`; Builder Base is a separate scope. */
  gameMode?: GameMode
  /** Only these categories. Omit or pass an empty list for all. */
  categories?: ItemCategory[]
  /** Case-insensitive match on name or id. */
  search?: string
  /** Only items unlocked at or below this Town Hall level. */
  maxTownHall?: number
}

export type DatasetInfo = {
  datasetVersion: string
  gameVersion: string | null
  releasedAt: string
  validationStatus: ValidationStatus
  knownOmissions: string[]
  itemCount: number
  /** True when the dataset is older than STALE_DATASET_AFTER_DAYS. */
  isStale: boolean
  ageInDays: number
}

/** Game balance changes often; warn once data is older than this. */
export const STALE_DATASET_AFTER_DAYS = 90

const DAY_MS = 24 * 60 * 60 * 1000

export type CatalogueService = {
  getItems: (filters?: CatalogueFilters) => CatalogueItem[]
  getItem: (id: ItemId) => CatalogueItem | null
  getDatasetInfo: (now?: Date) => DatasetInfo
}

function categoryRank(category: ItemCategory): number {
  return ITEM_CATEGORIES.indexOf(category)
}

function compareItems(a: CatalogueItem, b: CatalogueItem): number {
  return (
    categoryRank(a.category) - categoryRank(b.category) ||
    a.introducedAtTownHall - b.introducedAtTownHall ||
    a.name.localeCompare(b.name) ||
    a.id.localeCompare(b.id)
  )
}

export function createCatalogueService(catalogue: GameCatalogue): CatalogueService {
  const sorted = [...catalogue.items].sort(compareItems)
  const byId = new Map(sorted.map((item) => [item.id, item]))

  return {
    getItems(filters = {}) {
      const gameMode = filters.gameMode ?? 'home-village'
      const categories =
        filters.categories && filters.categories.length > 0 ? new Set(filters.categories) : null
      const search = filters.search?.trim().toLowerCase() || null

      return sorted.filter(
        (item) =>
          item.gameMode === gameMode &&
          (categories === null || categories.has(item.category)) &&
          (filters.maxTownHall === undefined ||
            item.introducedAtTownHall <= filters.maxTownHall) &&
          (search === null ||
            item.name.toLowerCase().includes(search) ||
            item.id.includes(search))
      )
    },

    getItem(id) {
      return byId.get(id) ?? null
    },

    getDatasetInfo(now = new Date()) {
      const { manifest } = catalogue
      const released = Date.parse(`${manifest.releasedAt}T00:00:00.000Z`)
      const ageInDays = Math.max(0, Math.floor((now.getTime() - released) / DAY_MS))
      return {
        datasetVersion: manifest.datasetVersion,
        gameVersion: manifest.gameVersion,
        releasedAt: manifest.releasedAt,
        validationStatus: manifest.validationStatus,
        knownOmissions: [...manifest.knownOmissions],
        itemCount: catalogue.items.length,
        isStale: ageInDays > STALE_DATASET_AFTER_DAYS,
        ageInDays
      }
    }
  }
}
