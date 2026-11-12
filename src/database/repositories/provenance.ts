import { isStateSource, type StateSource } from '../../domain/village-state'

/** Narrows a stored source string; the schema CHECK makes a mismatch a bug, not user error. */
export function parseStateSource(value: string): StateSource {
  if (!isStateSource(value)) {
    throw new Error(`Stored source "${value}" is invalid`)
  }
  return value
}

export function isoOrNull(date: Date | null): string | null {
  return date ? date.toISOString() : null
}

export function dateOrNull(value: string | null): Date | null {
  return value ? new Date(value) : null
}
