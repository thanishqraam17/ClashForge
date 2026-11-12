import { createHash } from 'crypto'

/**
 * Parser for the in-game Data Export (see docs/data-export-format.md).
 *
 * Pure: no database, no game knowledge. It checks structure and types, keeps
 * every known field exactly as exported, and reports anything it does not
 * recognise by name and location only. Interpretation (what a missing `cnt`
 * means, whether a timer is an upgrade, which catalogue item an id is)
 * happens later, in the planner.
 *
 * Privacy: the player `tag` is never copied into the result or any message.
 */

export const MAX_EXPORT_BYTES = 1_000_000

/** Fields the parser understands on entry objects. */
const KNOWN_ENTRY_FIELDS = [
  'data',
  'lvl',
  'cnt',
  'timer',
  'gear_up',
  'helper_cooldown',
  'helper_recurrent'
] as const

/** Top-level keys that are not sections. */
const HEADER_KEYS = ['tag', 'timestamp'] as const

/** Sections that must be present (at least one) for the text to count as a village export. */
const VILLAGE_SECTIONS = ['buildings', 'traps', 'heroes', 'units', 'spells'] as const

export type ParsedEntry = {
  section: string
  /** Index within the section, as exported. */
  position: number
  dataId: number
  /** Explicit values only; null means the field was absent. */
  level: number | null
  count: number | null
  timer: number | null
  gearUp: number | null
  helperCooldown: number | null
  helperRecurrent: boolean | null
}

export type ParsedBareId = {
  section: string
  position: number
  dataId: number
}

export type ParsedSection = {
  name: string
  shape: 'entries' | 'ids' | 'empty' | 'object'
  size: number
}

/** A field or section that was present but not understood. Value deliberately omitted. */
export type UnknownName = {
  /** Location, e.g. `buildings[3].shiny` or `boosts.double`. */
  path: string
  name: string
}

export type ParsedExport = {
  /** Original `timestamp` (Unix seconds), unchanged. */
  exportTimestamp: number
  /** SHA-256 of the raw text, for de-duplication. The text itself is not kept. */
  contentSha256: string
  sections: ParsedSection[]
  entries: ParsedEntry[]
  bareIds: ParsedBareId[]
  unknownFields: UnknownName[]
  /** Top-level keys that are not in the list of known sections. */
  unknownSections: UnknownName[]
  warnings: string[]
}

export type ExportParseIssue = { path: string; message: string }

export type ExportParseResult =
  | { ok: true; export: ParsedExport }
  | { ok: false; issues: ExportParseIssue[] }

const SAFE_NAME = /^[A-Za-z0-9_]{1,64}$/

/** Field names come from untrusted input; only report ones that look like names. */
function safeName(name: string): string {
  return SAFE_NAME.test(name) ? name : '<unprintable name>'
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/**
 * @param text Raw export text (e.g. from the clipboard).
 * @param knownSections Section names the importer knows about (from export semantics).
 */
export function parseExport(text: string, knownSections: readonly string[]): ExportParseResult {
  const issues: ExportParseIssue[] = []
  const fail = (path: string, message: string): ExportParseResult => ({
    ok: false,
    issues: [{ path, message }]
  })

  if (typeof text !== 'string' || text.trim() === '') return fail('export', 'is empty')
  if (Buffer.byteLength(text, 'utf8') > MAX_EXPORT_BYTES) {
    return fail('export', `is larger than ${MAX_EXPORT_BYTES} bytes`)
  }

  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    // Never echo the input: it may contain the player tag.
    return fail('export', 'is not valid JSON')
  }
  if (!isPlainObject(raw)) return fail('export', 'must be a JSON object')

  const warnings: string[] = []
  if (!('tag' in raw)) warnings.push('The export has no player tag field.')
  else if (typeof raw['tag'] !== 'string') issues.push({ path: 'tag', message: 'must be a string' })

  const timestamp = raw['timestamp']
  if (!isNonNegativeInt(timestamp) || timestamp === 0) {
    issues.push({ path: 'timestamp', message: 'must be a positive whole number of seconds' })
  }

  if (!VILLAGE_SECTIONS.some((name) => Array.isArray(raw[name]))) {
    issues.push({
      path: 'export',
      message: `does not look like a village export (none of ${VILLAGE_SECTIONS.join(', ')} found)`
    })
  }

  const sections: ParsedSection[] = []
  const entries: ParsedEntry[] = []
  const bareIds: ParsedBareId[] = []
  const unknownFields: UnknownName[] = []
  const unknownSections: UnknownName[] = []

  for (const [key, value] of Object.entries(raw)) {
    if ((HEADER_KEYS as readonly string[]).includes(key)) continue
    const name = safeName(key)

    if (!knownSections.includes(key)) {
      // Report the name and shape only; never parse or keep the values.
      unknownSections.push({ path: name, name })
      continue
    }

    if (isPlainObject(value)) {
      const keys = Object.keys(value)
      sections.push({ name: key, shape: 'object', size: keys.length })
      for (const field of keys) {
        unknownFields.push({ path: `${key}.${safeName(field)}`, name: safeName(field) })
      }
      continue
    }
    if (!Array.isArray(value)) {
      issues.push({ path: key, message: 'must be an array or an object' })
      continue
    }
    if (value.length === 0) {
      sections.push({ name: key, shape: 'empty', size: 0 })
      continue
    }

    if (value.every((element) => typeof element === 'number')) {
      value.forEach((element, position) => {
        if (!isNonNegativeInt(element) || element === 0) {
          issues.push({ path: `${key}[${position}]`, message: 'must be a positive integer id' })
        } else {
          bareIds.push({ section: key, position, dataId: element })
        }
      })
      sections.push({ name: key, shape: 'ids', size: value.length })
      continue
    }
    if (!value.every(isPlainObject)) {
      issues.push({ path: key, message: 'must contain only objects or only numeric ids' })
      continue
    }

    sections.push({ name: key, shape: 'entries', size: value.length })
    value.forEach((element, position) => {
      const entry = element as Record<string, unknown>
      const path = `${key}[${position}]`
      const before = issues.length

      for (const field of Object.keys(entry)) {
        if (!(KNOWN_ENTRY_FIELDS as readonly string[]).includes(field)) {
          unknownFields.push({ path: `${path}.${safeName(field)}`, name: safeName(field) })
        }
      }

      const intField = (field: string, min: number): number | null => {
        if (!(field in entry)) return null
        const v = entry[field]
        if (!isNonNegativeInt(v) || v < min) {
          issues.push({
            path: `${path}.${field}`,
            message: min > 0 ? 'must be a positive integer' : 'must be a non-negative integer'
          })
          return null
        }
        return v
      }

      if (!('data' in entry)) issues.push({ path: `${path}.data`, message: 'is required' })
      const dataId = intField('data', 1)
      const level = intField('lvl', 1)
      const count = intField('cnt', 1)
      const timer = intField('timer', 0)
      const gearUp = intField('gear_up', 0)
      const helperCooldown = intField('helper_cooldown', 0)
      let helperRecurrent: boolean | null = null
      if ('helper_recurrent' in entry) {
        if (typeof entry['helper_recurrent'] !== 'boolean') {
          issues.push({ path: `${path}.helper_recurrent`, message: 'must be true or false' })
        } else {
          helperRecurrent = entry['helper_recurrent']
        }
      }

      if (issues.length === before && dataId !== null) {
        entries.push({
          section: key,
          position,
          dataId,
          level,
          count,
          timer,
          gearUp,
          helperCooldown,
          helperRecurrent
        })
      }
    })
  }

  if (issues.length > 0) return { ok: false, issues }

  if (unknownSections.length > 0) {
    warnings.push(
      `The export has ${unknownSections.length} section(s) ClashForge does not recognise; they were not read.`
    )
  }
  if (unknownFields.length > 0) {
    warnings.push(
      `The export has ${unknownFields.length} field(s) ClashForge does not recognise; their values were not kept.`
    )
  }

  return {
    ok: true,
    export: {
      exportTimestamp: timestamp as number,
      contentSha256: createHash('sha256').update(text, 'utf8').digest('hex'),
      sections,
      entries,
      bareIds,
      unknownFields,
      unknownSections,
      warnings
    }
  }
}
