import { GAME_MODES, type GameCatalogue, type GameMode } from './catalogue'
import type { CatalogueIssue } from './catalogue-validation'
import type {
  ItemTownHallRules,
  TownHallRuleSet,
  TownHallStep,
  UnlockRequirement
} from './town-hall-rules'

export type TownHallRulesValidationResult =
  | { ok: true; rules: TownHallRuleSet }
  | { ok: false; issues: CatalogueIssue[] }

export class TownHallRulesValidationError extends Error {
  constructor(readonly issues: CatalogueIssue[]) {
    super(
      `Town Hall rules are invalid:\n${issues.map((issue) => `  ${issue.path}: ${issue.message}`).join('\n')}`
    )
    this.name = 'TownHallRulesValidationError'
  }
}

const ABSOLUTE_MAX_TOWN_HALL = 30
const MAX_ITEM_LEVEL = 200
const MAX_ITEM_QUANTITY = 500

type Fields = Record<string, unknown>

function isObject(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isIntInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
}

/** Highest maxLevel the item reaches at `townHall`, or 0 if it is not yet available. */
function maxLevelAt(steps: TownHallStep[], townHall: number): number {
  let level = 0
  for (const step of steps) {
    if (step.townHall <= townHall) level = step.maxLevel
  }
  return level
}

/**
 * Validates raw Town Hall rules against an already-validated catalogue.
 * Every catalogue item must have rules, and every rule must match an item.
 */
export function validateTownHallRules(
  raw: unknown,
  catalogue: GameCatalogue
): TownHallRulesValidationResult {
  const issues: CatalogueIssue[] = []
  const add = (path: string, message: string): void => {
    issues.push({ path, message })
  }

  if (!isObject(raw)) {
    return { ok: false, issues: [{ path: 'rules', message: 'must be an object' }] }
  }
  for (const key of Object.keys(raw)) {
    if (key !== 'maxTownHall' && key !== 'items') add(`rules.${key}`, 'is not a recognised field')
  }

  const maxTownHall = { 'home-village': null, 'builder-base': null } as Record<
    GameMode,
    number | null
  >
  if (!isObject(raw['maxTownHall'])) {
    add('rules.maxTownHall', 'must be an object')
  } else {
    for (const mode of GAME_MODES) {
      const value = raw['maxTownHall'][mode]
      if (value === null) {
        if (catalogue.items.some((item) => item.gameMode === mode)) {
          add(`rules.maxTownHall.${mode}`, 'cannot be null while the catalogue has items in this mode')
        }
      } else if (!isIntInRange(value, 1, ABSOLUTE_MAX_TOWN_HALL)) {
        add(`rules.maxTownHall.${mode}`, `must be an integer between 1 and ${ABSOLUTE_MAX_TOWN_HALL}`)
      } else {
        maxTownHall[mode] = value
      }
    }
  }

  const catalogueById = new Map(catalogue.items.map((item) => [item.id, item]))
  const rawItems = raw['items']
  if (!Array.isArray(rawItems)) {
    add('rules.items', 'must be an array')
  }

  const items: ItemTownHallRules[] = []
  const seen = new Set<string>()

  ;(Array.isArray(rawItems) ? rawItems : []).forEach((entry: unknown, index) => {
    const path = `rules.items[${index}]`
    if (!isObject(entry)) {
      add(path, 'must be an object')
      return
    }
    for (const key of Object.keys(entry)) {
      if (!['itemId', 'steps', 'unlockRequires'].includes(key)) {
        add(`${path}.${key}`, 'is not a recognised field')
      }
    }

    const itemId = entry['itemId']
    const item = typeof itemId === 'string' ? catalogueById.get(itemId) : undefined
    if (!item) {
      add(`${path}.itemId`, `unknown catalogue item ${JSON.stringify(itemId)}`)
      return
    }
    if (seen.has(item.id)) {
      add(`${path}.itemId`, `duplicate rules for "${item.id}"`)
      return
    }
    seen.add(item.id)
    const modeMax = maxTownHall[item.gameMode] ?? ABSOLUTE_MAX_TOWN_HALL

    const steps: TownHallStep[] = []
    if (!Array.isArray(entry['steps']) || entry['steps'].length === 0) {
      add(`${path}.steps`, 'must be a non-empty array')
    } else {
      entry['steps'].forEach((rawStep: unknown, stepIndex) => {
        const stepPath = `${path}.steps[${stepIndex}]`
        if (!isObject(rawStep)) {
          add(stepPath, 'must be an object')
          return
        }
        for (const key of Object.keys(rawStep)) {
          if (!['townHall', 'maxLevel', 'maxQuantity'].includes(key)) {
            add(`${stepPath}.${key}`, 'is not a recognised field')
          }
        }
        const { townHall, maxLevel, maxQuantity } = rawStep
        let valid = true
        if (!isIntInRange(townHall, 1, modeMax)) {
          add(`${stepPath}.townHall`, `must be an integer between 1 and ${modeMax}`)
          valid = false
        }
        if (!isIntInRange(maxLevel, 1, MAX_ITEM_LEVEL)) {
          add(`${stepPath}.maxLevel`, `must be an integer between 1 and ${MAX_ITEM_LEVEL}`)
          valid = false
        }
        if (!isIntInRange(maxQuantity, 1, MAX_ITEM_QUANTITY)) {
          add(`${stepPath}.maxQuantity`, `must be an integer between 1 and ${MAX_ITEM_QUANTITY}`)
          valid = false
        }
        if (!valid) return

        const step = { townHall, maxLevel, maxQuantity } as TownHallStep
        const previous = steps[steps.length - 1]
        if (previous) {
          if (step.townHall <= previous.townHall) {
            add(`${stepPath}.townHall`, 'steps must be in strictly ascending Town Hall order')
          }
          if (step.maxLevel < previous.maxLevel) {
            add(`${stepPath}.maxLevel`, 'cannot decrease at a higher Town Hall')
          }
          if (step.maxQuantity < previous.maxQuantity) {
            add(`${stepPath}.maxQuantity`, 'cannot decrease at a higher Town Hall')
          }
          if (
            step.maxLevel === previous.maxLevel &&
            step.maxQuantity === previous.maxQuantity
          ) {
            add(stepPath, 'repeats the previous step; only list Town Halls where something changes')
          }
        } else if (step.townHall !== item.introducedAtTownHall) {
          add(
            `${stepPath}.townHall`,
            `first step must be the item's unlock Town Hall (${item.introducedAtTownHall})`
          )
        }
        if (!item.isUpgradeable && step.maxLevel !== 1) {
          add(`${stepPath}.maxLevel`, 'must be 1 for an item that is not upgradeable')
        }
        if (!item.isRepeatable && step.maxQuantity !== 1) {
          add(`${stepPath}.maxQuantity`, 'must be 1 for an item that is not repeatable')
        }
        steps.push(step)
      })
    }

    const unlockRequires: UnlockRequirement[] = []
    const rawRequires = entry['unlockRequires']
    if (!Array.isArray(rawRequires)) {
      add(`${path}.unlockRequires`, 'must be an array (use [] for none)')
    } else {
      rawRequires.forEach((rawRequirement: unknown, reqIndex) => {
        const reqPath = `${path}.unlockRequires[${reqIndex}]`
        if (!isObject(rawRequirement)) {
          add(reqPath, 'must be an object')
          return
        }
        const required =
          typeof rawRequirement['itemId'] === 'string'
            ? catalogueById.get(rawRequirement['itemId'])
            : undefined
        if (!required) {
          add(`${reqPath}.itemId`, `unknown catalogue item ${JSON.stringify(rawRequirement['itemId'])}`)
          return
        }
        if (required.id === item.id) {
          add(`${reqPath}.itemId`, 'an item cannot require itself')
          return
        }
        if (required.gameMode !== item.gameMode) {
          add(`${reqPath}.itemId`, 'must be in the same game mode')
          return
        }
        if (!isIntInRange(rawRequirement['level'], 1, MAX_ITEM_LEVEL)) {
          add(`${reqPath}.level`, `must be an integer between 1 and ${MAX_ITEM_LEVEL}`)
          return
        }
        unlockRequires.push({ itemId: required.id, level: rawRequirement['level'] })
      })
    }

    items.push({ itemId: item.id, steps, unlockRequires })
  })

  for (const item of catalogue.items) {
    if (!seen.has(item.id)) {
      add('rules.items', `missing rules for catalogue item "${item.id}"`)
    }
  }

  // Cross-item check: each requirement must be reachable at the item's unlock Town Hall.
  const rulesById = new Map(items.map((rules) => [rules.itemId, rules]))
  items.forEach((rules, index) => {
    const unlockTownHall = rules.steps[0]?.townHall
    if (unlockTownHall === undefined) return
    rules.unlockRequires.forEach((requirement, reqIndex) => {
      const requiredRules = rulesById.get(requirement.itemId)
      if (!requiredRules) return
      if (maxLevelAt(requiredRules.steps, unlockTownHall) < requirement.level) {
        add(
          `rules.items[${index}].unlockRequires[${reqIndex}]`,
          `"${requirement.itemId}" cannot reach level ${requirement.level} by Town Hall ${unlockTownHall}`
        )
      }
    })
  })

  if (issues.length > 0) {
    return { ok: false, issues }
  }
  return { ok: true, rules: { maxTownHall, items } }
}

export function parseTownHallRules(raw: unknown, catalogue: GameCatalogue): TownHallRuleSet {
  const result = validateTownHallRules(raw, catalogue)
  if (!result.ok) {
    throw new TownHallRulesValidationError(result.issues)
  }
  return result.rules
}
