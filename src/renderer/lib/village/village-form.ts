import type { VillageDto, VillageSaveInput } from '../../../shared/ipc/contracts'

/**
 * Town Hall and resources form. These checks only help the player; the
 * service validates again (including Town Hall limits) and its message wins.
 */

export const VILLAGE_NUMBER_FIELDS = [
  'townHallLevel',
  'gold',
  'elixir',
  'darkElixir',
  'goldCapacity',
  'elixirCapacity',
  'darkElixirCapacity'
] as const
export type VillageNumberField = (typeof VILLAGE_NUMBER_FIELDS)[number]

/** Raw text as typed. */
export type VillageFormValues = Record<VillageNumberField, string> & { note: string }

export type VillageFormResult =
  | { ok: true; input: VillageSaveInput; warnings: string[] }
  | { ok: false; errors: Partial<Record<VillageNumberField | 'note', string>> }

const LABELS: Record<VillageNumberField, string> = {
  townHallLevel: 'Town Hall',
  gold: 'Gold',
  elixir: 'Elixir',
  darkElixir: 'Dark Elixir',
  goldCapacity: 'Gold capacity',
  elixirCapacity: 'Elixir capacity',
  darkElixirCapacity: 'Dark Elixir capacity'
}

export const NOTE_MAX_LENGTH = 500

export function emptyVillageForm(): VillageFormValues {
  return { townHallLevel: '', gold: '0', elixir: '0', darkElixir: '0', goldCapacity: '0', elixirCapacity: '0', darkElixirCapacity: '0', note: '' }
}

export function villageFormFrom(village: VillageDto): VillageFormValues {
  return {
    townHallLevel: String(village.townHallLevel),
    gold: String(village.gold),
    elixir: String(village.elixir),
    darkElixir: String(village.darkElixir),
    goldCapacity: String(village.goldCapacity),
    elixirCapacity: String(village.elixirCapacity),
    darkElixirCapacity: String(village.darkElixirCapacity),
    note: ''
  }
}

/** A whole number written in plain digits; anything else is null. */
export function parseWholeNumber(text: string): number | null {
  const trimmed = text.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const value = Number(trimmed)
  return Number.isSafeInteger(value) ? value : null
}

/** The note to send: trimmed text, or nothing when blank. */
export function noteOf(text: string): { note: string } | Record<string, never> {
  const trimmed = text.trim()
  return trimmed === '' ? {} : { note: trimmed }
}

export function checkNoteText(text: string): string | null {
  return text.trim().length > NOTE_MAX_LENGTH ? `Note must be at most ${NOTE_MAX_LENGTH} characters` : null
}

/**
 * Builds the village:save payload. lastScannedAt is carried over unchanged
 * because this form does not edit it.
 */
export function readVillageForm(values: VillageFormValues, current: VillageDto | null): VillageFormResult {
  const errors: Partial<Record<VillageNumberField | 'note', string>> = {}
  const numbers = {} as Record<VillageNumberField, number>
  for (const field of VILLAGE_NUMBER_FIELDS) {
    const value = parseWholeNumber(values[field])
    if (value === null) errors[field] = `${LABELS[field]} must be a whole number of 0 or more`
    else if (field === 'townHallLevel' && value < 1) errors[field] = 'Town Hall must be at least 1'
    else numbers[field] = value
  }
  const noteError = checkNoteText(values.note)
  if (noteError) errors.note = noteError
  if (Object.keys(errors).length > 0) return { ok: false, errors }

  const warnings: string[] = []
  for (const [amount, capacity] of [
    ['gold', 'goldCapacity'],
    ['elixir', 'elixirCapacity'],
    ['darkElixir', 'darkElixirCapacity']
  ] as const) {
    if (numbers[amount] > numbers[capacity]) warnings.push(`${LABELS[amount]} is above its capacity`)
  }
  return {
    ok: true,
    input: { ...numbers, lastScannedAt: current?.lastScannedAt ?? null, ...noteOf(values.note) },
    warnings
  }
}

export function isTownHallDecrease(current: VillageDto | null, next: VillageSaveInput): boolean {
  return current !== null && next.townHallLevel < current.townHallLevel
}

/** True when any number differs from the saved village (a note alone is not a change). */
export function isVillageFormDirty(values: VillageFormValues, current: VillageDto | null): boolean {
  if (current === null) return true
  return VILLAGE_NUMBER_FIELDS.some((field) => parseWholeNumber(values[field]) !== current[field])
}
