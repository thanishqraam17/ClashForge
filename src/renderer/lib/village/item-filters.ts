import type { ItemGroup } from './village-view-model'

export type ItemFilter = {
  /** Matched case-insensitively against the item name, trimmed. */
  search: string
  /** null for all categories. */
  category: string | null
  /** Also list catalogue items with no recorded instances. */
  showUnrecorded: boolean
}

export const DEFAULT_ITEM_FILTER: ItemFilter = { search: '', category: null, showUnrecorded: false }

export function filterItemGroups(groups: readonly ItemGroup[], filter: ItemFilter): ItemGroup[] {
  const search = filter.search.trim().toLowerCase()
  return groups.filter(
    (g) =>
      (filter.showUnrecorded || g.count > 0) &&
      (filter.category === null || g.item.category === filter.category) &&
      (search === '' || g.item.name.toLowerCase().includes(search))
  )
}

/** Categories that have at least one listed group, in first-seen order. */
export function presentCategories(groups: readonly ItemGroup[], showUnrecorded: boolean): string[] {
  const seen: string[] = []
  for (const g of groups) {
    if ((showUnrecorded || g.count > 0) && !seen.includes(g.item.category)) seen.push(g.item.category)
  }
  return seen
}
