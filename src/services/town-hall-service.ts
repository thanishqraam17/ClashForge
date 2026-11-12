import type { GameCatalogue, GameMode, ItemId } from '../domain/catalogue'
import type {
  ItemAtTownHall,
  ItemTownHallRules,
  TownHallRuleSet,
  TownHallStep,
  UnlockRequirement
} from '../domain/town-hall-rules'

export class TownHallRangeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TownHallRangeError'
  }
}

export type TownHallSummaryEntry = {
  itemId: ItemId
  maxLevel: number
  maxQuantity: number
  unlockRequires: UnlockRequirement[]
  /** First available at this Town Hall. */
  isNewlyUnlocked: boolean
  /** Extra levels compared with the previous Town Hall (0 if unchanged). */
  levelsAdded: number
  /** Extra instances compared with the previous Town Hall (0 if unchanged). */
  quantityAdded: number
}

export type TownHallSummary = {
  gameMode: GameMode
  townHall: number
  /** Items available at this Town Hall, in catalogue order. */
  available: TownHallSummaryEntry[]
  /** Items that unlock at a higher Town Hall, with the level they unlock at. */
  locked: Array<{ itemId: ItemId; unlocksAtTownHall: number }>
}

export type TownHallService = {
  /** Highest Town Hall level with data, or null when not yet known. */
  getMaxTownHall: (gameMode: GameMode) => number | null
  /** Null when the item is not in the catalogue. */
  getItemAt: (itemId: ItemId, townHall: number) => ItemAtTownHall | null
  getSummary: (townHall: number, gameMode?: GameMode) => TownHallSummary
}

/** The step in force at `townHall`, or null before the item unlocks. */
export function stepAt(steps: TownHallStep[], townHall: number): TownHallStep | null {
  let current: TownHallStep | null = null
  for (const step of steps) {
    if (step.townHall > townHall) break
    current = step
  }
  return current
}

export function createTownHallService(
  catalogue: GameCatalogue,
  rules: TownHallRuleSet
): TownHallService {
  const rulesById = new Map<ItemId, ItemTownHallRules>(
    rules.items.map((entry) => [entry.itemId, entry])
  )
  const gameModeById = new Map(catalogue.items.map((item) => [item.id, item.gameMode]))

  function assertTownHall(townHall: number, gameMode: GameMode): void {
    const max = rules.maxTownHall[gameMode]
    if (max === null) {
      throw new TownHallRangeError(`No Town Hall data is available yet for ${gameMode}`)
    }
    if (!Number.isInteger(townHall) || townHall < 1 || townHall > max) {
      throw new TownHallRangeError(`townHall must be an integer between 1 and ${max}`)
    }
  }

  function resolve(entry: ItemTownHallRules, townHall: number): ItemAtTownHall {
    const step = stepAt(entry.steps, townHall)
    if (step === null) {
      return {
        available: false,
        itemId: entry.itemId,
        townHall,
        unlocksAtTownHall: entry.steps[0]!.townHall
      }
    }
    return {
      available: true,
      itemId: entry.itemId,
      townHall,
      maxLevel: step.maxLevel,
      maxQuantity: step.maxQuantity,
      unlockRequires: entry.unlockRequires.map((requirement) => ({ ...requirement }))
    }
  }

  return {
    getMaxTownHall(gameMode) {
      return rules.maxTownHall[gameMode]
    },

    getItemAt(itemId, townHall) {
      const entry = rulesById.get(itemId)
      const gameMode = gameModeById.get(itemId)
      if (!entry || !gameMode) return null
      assertTownHall(townHall, gameMode)
      return resolve(entry, townHall)
    },

    getSummary(townHall, gameMode = 'home-village') {
      assertTownHall(townHall, gameMode)
      const summary: TownHallSummary = { gameMode, townHall, available: [], locked: [] }

      for (const item of catalogue.items) {
        if (item.gameMode !== gameMode) continue
        const entry = rulesById.get(item.id)
        if (!entry) continue

        const current = resolve(entry, townHall)
        if (!current.available) {
          summary.locked.push({ itemId: item.id, unlocksAtTownHall: current.unlocksAtTownHall })
          continue
        }
        const previous = townHall > 1 ? stepAt(entry.steps, townHall - 1) : null
        summary.available.push({
          itemId: item.id,
          maxLevel: current.maxLevel,
          maxQuantity: current.maxQuantity,
          unlockRequires: current.unlockRequires,
          isNewlyUnlocked: previous === null,
          levelsAdded: current.maxLevel - (previous?.maxLevel ?? 0),
          quantityAdded: current.maxQuantity - (previous?.maxQuantity ?? 0)
        })
      }
      return summary
    }
  }
}
