import { isValidItemId } from './catalogue'

/**
 * Audit log of manual village edits. Each entry records what changed, with
 * plain JSON copies of the record before and after the change.
 */

export const EDIT_ENTITY_TYPES = [
  'village',
  'item-instance',
  'builders',
  'research',
  'legacy-building',
  'legacy-hero',
  'legacy-research'
] as const
export type EditEntityType = (typeof EDIT_ENTITY_TYPES)[number]

export const EDIT_ACTIONS = [
  'create',
  'update',
  'delete',
  'set-count',
  'map',
  'dismiss',
  'set-ordinary-huts',
  'set-bob',
  'reclassify-legacy-builders'
] as const
export type EditAction = (typeof EDIT_ACTIONS)[number]

/** A JSON value with nothing that JSON would silently drop or change. */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

export const EDIT_NOTE_MAX_LENGTH = 500
export const EDIT_BATCH_ID_MAX_LENGTH = 64

export type EditLogInput = {
  villageId: number
  entityType: EditEntityType
  /** Null for village-wide changes such as the builder count. */
  entityId: number | null
  /** Catalogue item id, when the change concerns one item. */
  itemId: string | null
  action: EditAction
  before: JsonValue | null
  after: JsonValue | null
  /** Shared by every entry of one bulk edit. */
  batchId: string | null
  note: string | null
}

export type EditLogEntry = EditLogInput & {
  id: number
  createdAt: Date
}

export class EditLogValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EditLogValidationError'
  }
}

/**
 * Rejects anything that is not plain JSON instead of letting JSON.stringify
 * quietly change it: `undefined` (dropped in objects, `null` in arrays),
 * NaN/Infinity (become `null`), Dates (become strings), Maps/Sets/class
 * instances (become `{}`), functions, symbols, bigints, sparse arrays and
 * cycles. Throws with the path of the first offending value.
 */
export function assertPlainJson(value: unknown, path: string, seen: Set<object> = new Set()): void {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new EditLogValidationError(`${path} must be a finite number`)
    return
  }
  if (typeof value !== 'object') {
    // undefined, function, symbol, bigint
    throw new EditLogValidationError(`${path} is ${typeof value}, which is not JSON`)
  }
  if (seen.has(value)) throw new EditLogValidationError(`${path} contains a circular reference`)
  seen.add(value)
  try {
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i += 1) {
        if (!(i in value)) throw new EditLogValidationError(`${path}[${i}] is an empty slot`)
        assertPlainJson(value[i], `${path}[${i}]`, seen)
      }
      return
    }
    const proto = Object.getPrototypeOf(value)
    if (proto !== Object.prototype && proto !== null) {
      throw new EditLogValidationError(`${path} must be a plain object, not ${value.constructor?.name ?? 'an instance'}`)
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new EditLogValidationError(`${path} has symbol keys, which are not JSON`)
    }
    for (const [key, child] of Object.entries(value)) {
      assertPlainJson(child, `${path}.${key}`, seen)
    }
  } finally {
    seen.delete(value)
  }
}

export function validateEditLogInput(input: EditLogInput): void {
  if (!Number.isSafeInteger(input.villageId) || input.villageId < 1) {
    throw new EditLogValidationError('villageId must be a positive integer')
  }
  if (!(EDIT_ENTITY_TYPES as readonly string[]).includes(input.entityType)) {
    throw new EditLogValidationError('entityType is invalid')
  }
  if (!(EDIT_ACTIONS as readonly string[]).includes(input.action)) {
    throw new EditLogValidationError('action is invalid')
  }
  if (input.entityId !== null && (!Number.isSafeInteger(input.entityId) || input.entityId < 1)) {
    throw new EditLogValidationError('entityId must be null or a positive integer')
  }
  if (input.itemId !== null && (typeof input.itemId !== 'string' || !isValidItemId(input.itemId))) {
    throw new EditLogValidationError('itemId must be null or a catalogue item id')
  }
  if (input.before === undefined || input.after === undefined) {
    throw new EditLogValidationError('before and after must be given (use null for none)')
  }
  assertPlainJson(input.before, 'before')
  assertPlainJson(input.after, 'after')
  if (input.before === null && input.after === null) {
    throw new EditLogValidationError('an entry needs a before or an after state')
  }
  if (input.action === 'create' && input.before !== null) {
    throw new EditLogValidationError('a create entry has no before state')
  }
  if (input.action === 'delete' && input.after !== null) {
    throw new EditLogValidationError('a delete entry has no after state')
  }
  if (
    input.batchId !== null &&
    (typeof input.batchId !== 'string' || input.batchId.length < 1 || input.batchId.length > EDIT_BATCH_ID_MAX_LENGTH)
  ) {
    throw new EditLogValidationError(`batchId must be null or 1-${EDIT_BATCH_ID_MAX_LENGTH} characters`)
  }
  if (input.note !== null) {
    if (typeof input.note !== 'string' || !input.note.trim()) {
      throw new EditLogValidationError('note must be null or non-empty text')
    }
    if (input.note.length > EDIT_NOTE_MAX_LENGTH) {
      throw new EditLogValidationError(`note must be at most ${EDIT_NOTE_MAX_LENGTH} characters`)
    }
  }
}
