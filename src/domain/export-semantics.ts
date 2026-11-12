import type { CatalogueIssue } from './catalogue-validation'

/**
 * What ClashForge knows about the in-game data export, and how sure it is.
 * See docs/data-export-format.md for the evidence behind each rule.
 *
 * Statuses are deliberately distinct:
 * - `observed`:   read directly from the export (e.g. an explicit `lvl`).
 * - `inferred`:   our interpretation of the export (e.g. missing `cnt` = 1).
 *                 Usable, but the preview must show it as an inference.
 * - `unverified`: a hypothesis; never used to change village state.
 * - `verified`:   an interpretation confirmed by recorded evidence.
 */

export const SEMANTIC_STATUSES = ['observed', 'inferred', 'unverified', 'verified'] as const
export type SemanticStatus = (typeof SEMANTIC_STATUSES)[number]

export const SEMANTIC_MEANINGS = [
  'level',
  'instance-count',
  'missing-count-is-one',
  'upgrade-remaining-seconds'
] as const
export type SemanticMeaning = (typeof SEMANTIC_MEANINGS)[number]

/** How the importer treats a section of the export. */
export const SECTION_SCOPES = ['item-instances', 'research', 'out-of-scope'] as const
export type SectionScope = (typeof SECTION_SCOPES)[number]

export type SemanticRule = {
  id: string
  meaning: SemanticMeaning
  /** Export field the rule is about. */
  field: string
  /** Sections the rule applies to. */
  sections: string[]
  status: SemanticStatus
  /** Reliability (0–1) of data relying on this rule. Provisional, documented values. */
  confidence: number
  evidence: string
}

export type ExportSemantics = {
  semanticsVersion: string
  /** Section name → how the importer treats it. Sections not listed are unknown. */
  sections: Record<string, SectionScope>
  rules: SemanticRule[]
}

/** Statuses that may change village state. `inferred` must be surfaced in previews. */
export function isUsableStatus(status: SemanticStatus): boolean {
  return status === 'observed' || status === 'inferred' || status === 'verified'
}

/** The rule for a meaning in a section, or null when there is none. */
export function findRule(
  semantics: ExportSemantics,
  section: string,
  meaning: SemanticMeaning
): SemanticRule | null {
  return (
    semantics.rules.find((rule) => rule.meaning === meaning && rule.sections.includes(section)) ??
    null
  )
}

/** True only when the rule exists and its status allows it to change village state. */
export function isUsable(semantics: ExportSemantics, section: string, meaning: SemanticMeaning): boolean {
  const rule = findRule(semantics, section, meaning)
  return rule !== null && isUsableStatus(rule.status)
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export class ExportSemanticsValidationError extends Error {
  constructor(readonly issues: CatalogueIssue[]) {
    super(
      `Export semantics are invalid:\n${issues.map((issue) => `  ${issue.path}: ${issue.message}`).join('\n')}`
    )
    this.name = 'ExportSemanticsValidationError'
  }
}

const SECTION_NAME = /^[a-z][a-z0-9_]*$/
const RULE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const SEMVER = /^\d+\.\d+\.\d+$/
const RULE_KEYS = ['id', 'meaning', 'field', 'sections', 'status', 'confidence', 'evidence']

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseExportSemantics(raw: unknown): ExportSemantics {
  const issues: CatalogueIssue[] = []
  const add = (path: string, message: string): void => {
    issues.push({ path, message })
  }

  if (!isObject(raw)) throw new ExportSemanticsValidationError([{ path: 'semantics', message: 'must be an object' }])
  for (const key of Object.keys(raw)) {
    if (!['semanticsVersion', 'sections', 'rules'].includes(key)) add(`semantics.${key}`, 'is not a recognised field')
  }
  if (typeof raw['semanticsVersion'] !== 'string' || !SEMVER.test(raw['semanticsVersion'])) {
    add('semantics.semanticsVersion', 'must be a semantic version like 1.2.3')
  }

  const sections: Record<string, SectionScope> = {}
  if (!isObject(raw['sections'])) {
    add('semantics.sections', 'must be an object')
  } else {
    for (const [name, scope] of Object.entries(raw['sections'])) {
      if (!SECTION_NAME.test(name)) add(`semantics.sections.${name}`, 'is not a valid section name')
      if (typeof scope !== 'string' || !(SECTION_SCOPES as readonly string[]).includes(scope)) {
        add(`semantics.sections.${name}`, `must be one of: ${SECTION_SCOPES.join(', ')}`)
      } else {
        sections[name] = scope as SectionScope
      }
    }
  }

  const rules: SemanticRule[] = []
  const seenIds = new Set<string>()
  const seenMeanings = new Set<string>()
  if (!Array.isArray(raw['rules'])) {
    add('semantics.rules', 'must be an array')
  } else {
    raw['rules'].forEach((entry: unknown, index) => {
      const path = `semantics.rules[${index}]`
      if (!isObject(entry)) {
        add(path, 'must be an object')
        return
      }
      const before = issues.length
      for (const key of Object.keys(entry)) {
        if (!RULE_KEYS.includes(key)) add(`${path}.${key}`, 'is not a recognised field')
      }
      const { id, meaning, field, status, confidence, evidence } = entry
      if (typeof id !== 'string' || !RULE_ID.test(id)) add(`${path}.id`, 'must be lowercase kebab-case')
      else if (seenIds.has(id)) add(`${path}.id`, `duplicate rule id "${id}"`)
      if (typeof meaning !== 'string' || !(SEMANTIC_MEANINGS as readonly string[]).includes(meaning)) {
        add(`${path}.meaning`, `must be one of: ${SEMANTIC_MEANINGS.join(', ')}`)
      }
      if (typeof field !== 'string' || !SECTION_NAME.test(field)) add(`${path}.field`, 'must be a field name')
      if (typeof status !== 'string' || !(SEMANTIC_STATUSES as readonly string[]).includes(status)) {
        add(`${path}.status`, `must be one of: ${SEMANTIC_STATUSES.join(', ')}`)
      }
      if (typeof confidence !== 'number' || !(confidence >= 0 && confidence <= 1)) {
        add(`${path}.confidence`, 'must be a number between 0 and 1')
      }
      if (typeof evidence !== 'string' || !evidence.trim()) add(`${path}.evidence`, 'must explain the evidence')

      const ruleSections = entry['sections']
      if (!Array.isArray(ruleSections) || ruleSections.length === 0) {
        add(`${path}.sections`, 'must be a non-empty array')
      } else {
        ruleSections.forEach((section: unknown, i) => {
          if (typeof section !== 'string' || !(section in sections)) {
            add(`${path}.sections[${i}]`, `unknown section ${JSON.stringify(section)}`)
          } else if (seenMeanings.has(`${meaning}@${section}`)) {
            add(`${path}.sections[${i}]`, `another rule already defines "${meaning}" for "${section}"`)
          }
        })
      }
      if (issues.length === before) {
        for (const section of ruleSections as string[]) seenMeanings.add(`${meaning}@${section}`)
        seenIds.add(id as string)
        rules.push(entry as unknown as SemanticRule)
      }
    })
  }

  if (issues.length > 0) throw new ExportSemanticsValidationError(issues)
  return { semanticsVersion: raw['semanticsVersion'] as string, sections, rules }
}
