import type { GameMode, ItemId } from './catalogue'

/**
 * Town Hall rules: what each Town Hall (or Builder Hall) level allows for each
 * catalogue item. Kept separate from the item itself so availability logic
 * lives in data and services, not in UI components.
 *
 * Rules are written as steps: an entry at Town Hall N applies to N and every
 * higher level until the next entry for the same item. Steps only appear
 * where something changes, which keeps the data short and reviewable.
 */

export type UnlockRequirement = {
  /** Another catalogue item that must reach `level` first. */
  itemId: ItemId
  level: number
}

export type TownHallStep = {
  townHall: number
  /** Highest level the item can reach at this Town Hall. */
  maxLevel: number
  /** How many instances a village can own at this Town Hall (1 for unique items). */
  maxQuantity: number
}

export type ItemTownHallRules = {
  itemId: ItemId
  /** Ascending by townHall; the first step is where the item unlocks. */
  steps: TownHallStep[]
  /** Conditions beyond Town Hall level needed to unlock the item. */
  unlockRequires: UnlockRequirement[]
}

export type TownHallRuleSet = {
  /** Highest Town Hall level covered by the rules, per game mode. */
  maxTownHall: Record<GameMode, number>
  items: ItemTownHallRules[]
}

/** The resolved rules for one item at one Town Hall level. */
export type ItemAtTownHall =
  | { available: false; itemId: ItemId; townHall: number; unlocksAtTownHall: number }
  | {
      available: true
      itemId: ItemId
      townHall: number
      maxLevel: number
      maxQuantity: number
      unlockRequires: UnlockRequirement[]
    }
