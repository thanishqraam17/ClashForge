import { describe, expect, it } from 'vitest'
import {
  ExportSemanticsValidationError,
  findRule,
  isUsable,
  parseExportSemantics
} from './export-semantics'

function raw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    semanticsVersion: '0.1.0',
    sections: { buildings: 'item-instances', units: 'research', equipment: 'out-of-scope' },
    rules: [
      {
        id: 'entry-level',
        meaning: 'level',
        field: 'lvl',
        sections: ['buildings', 'units'],
        status: 'observed',
        confidence: 0.95,
        evidence: 'seen'
      },
      {
        id: 'missing-count',
        meaning: 'missing-count-is-one',
        field: 'cnt',
        sections: ['buildings'],
        status: 'inferred',
        confidence: 0.8,
        evidence: 'inferred'
      },
      {
        id: 'timer-remaining',
        meaning: 'upgrade-remaining-seconds',
        field: 'timer',
        sections: ['buildings'],
        status: 'unverified',
        confidence: 0.5,
        evidence: 'hypothesis'
      }
    ],
    ...overrides
  }
}

function issues(value: unknown): string[] {
  try {
    parseExportSemantics(value)
    return []
  } catch (error) {
    expect(error).toBeInstanceOf(ExportSemanticsValidationError)
    return (error as ExportSemanticsValidationError).issues.map((i) => `${i.path}: ${i.message}`)
  }
}

describe('parseExportSemantics', () => {
  it('accepts well-formed semantics', () => {
    expect(issues(raw())).toEqual([])
  })

  it('distinguishes observed, inferred and unverified rules', () => {
    const semantics = parseExportSemantics(raw())
    expect(isUsable(semantics, 'buildings', 'level')).toBe(true)
    expect(isUsable(semantics, 'buildings', 'missing-count-is-one')).toBe(true)
    expect(findRule(semantics, 'buildings', 'missing-count-is-one')?.status).toBe('inferred')
    expect(isUsable(semantics, 'buildings', 'upgrade-remaining-seconds')).toBe(false)
    expect(isUsable(semantics, 'units', 'missing-count-is-one')).toBe(false)
    expect(findRule(semantics, 'equipment', 'level')).toBeNull()
  })

  it('rejects malformed rules and unknown sections', () => {
    const bad = raw()
    ;(bad['rules'] as Array<Record<string, unknown>>).push({
      id: 'Bad Id',
      meaning: 'guess',
      field: 'x',
      sections: ['pets'],
      status: 'probably',
      confidence: 2,
      evidence: ''
    })
    expect(issues(bad)).toEqual([
      'semantics.rules[3].id: must be lowercase kebab-case',
      'semantics.rules[3].meaning: must be one of: level, instance-count, missing-count-is-one, upgrade-remaining-seconds',
      'semantics.rules[3].status: must be one of: observed, inferred, unverified, verified',
      'semantics.rules[3].confidence: must be a number between 0 and 1',
      'semantics.rules[3].evidence: must explain the evidence',
      'semantics.rules[3].sections[0]: unknown section "pets"'
    ])
  })

  it('rejects two rules defining the same meaning for a section', () => {
    const dup = raw()
    ;(dup['rules'] as Array<Record<string, unknown>>).push({
      id: 'entry-level-2',
      meaning: 'level',
      field: 'lvl',
      sections: ['units'],
      status: 'observed',
      confidence: 1,
      evidence: 'again'
    })
    expect(issues(dup)).toEqual([
      'semantics.rules[3].sections[0]: another rule already defines "level" for "units"'
    ])
  })

  it('rejects bad section scopes and versions', () => {
    expect(issues(raw({ semanticsVersion: 'v1', sections: { buildings: 'maybe' } }))).toContain(
      'semantics.sections.buildings: must be one of: item-instances, research, out-of-scope'
    )
  })
})
