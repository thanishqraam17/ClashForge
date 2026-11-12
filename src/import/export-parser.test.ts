import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { loadBundledGameData } from '../game-data'
import { MAX_EXPORT_BYTES, parseExport, type ParsedExport } from './export-parser'

const KNOWN = Object.keys(loadBundledGameData().exportSemantics.sections)
const FIXTURE_TEXT = readFileSync(join(__dirname, 'fixtures', 'export-redacted.json'), 'utf8')

function parsed(text: string): ParsedExport {
  const result = parseExport(text, KNOWN)
  if (!result.ok) throw new Error(JSON.stringify(result.issues))
  return result.export
}

function issues(text: string): string[] {
  const result = parseExport(text, KNOWN)
  return result.ok ? [] : result.issues.map((i) => `${i.path}: ${i.message}`)
}

function minimal(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ tag: '#REDACTED', timestamp: 1704067200, buildings: [], ...extra })
}

describe('parseExport with the redacted real-structure fixture', () => {
  const result = parsed(FIXTURE_TEXT)

  it('keeps the original timestamp and hashes the content', () => {
    expect(result.exportTimestamp).toBe(1704067200)
    expect(result.contentSha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('recognises every section with its shape and size', () => {
    const bySection = Object.fromEntries(result.sections.map((s) => [s.name, `${s.shape}:${s.size}`]))
    expect(bySection).toEqual({
      helpers: 'entries:1',
      buildings: 'entries:33',
      traps: 'entries:16',
      decos: 'entries:7',
      obstacles: 'empty:0',
      units: 'entries:19',
      siege_machines: 'empty:0',
      heroes: 'entries:3',
      spells: 'entries:11',
      pets: 'empty:0',
      equipment: 'entries:35',
      house_parts: 'ids:8',
      skins: 'ids:1',
      sceneries: 'empty:0',
      buildings2: 'entries:20',
      traps2: 'entries:7',
      decos2: 'empty:0',
      obstacles2: 'entries:11',
      units2: 'entries:6',
      heroes2: 'empty:0',
      skins2: 'empty:0',
      sceneries2: 'empty:0',
      boosts: 'object:0'
    })
    expect(result.entries).toHaveLength(169)
    expect(result.bareIds).toHaveLength(9)
    expect(result.unknownFields).toEqual([])
    expect(result.unknownSections).toEqual([])
    expect(result.warnings).toEqual([])
  })

  it('keeps explicit fields and leaves absent ones null', () => {
    const traps = result.entries.filter((e) => e.section === 'traps')
    // Entries with a timer have no explicit count; that stays null (no inference here).
    expect(traps.slice(0, 4).every((e) => e.count === null && e.timer !== null)).toBe(true)
    expect(traps[4]).toMatchObject({ dataId: 12000000, count: 1, timer: null })

    const gearUp = result.entries.find((e) => e.gearUp !== null)!
    expect(gearUp).toMatchObject({ section: 'buildings', position: 0, dataId: 1000008, count: null })

    const decos = result.entries.filter((e) => e.section === 'decos')
    expect(decos.every((e) => e.level === null && e.count !== null)).toBe(true)

    const unit = result.entries.find((e) => e.helperRecurrent !== null)!
    expect(unit).toMatchObject({ section: 'units', helperRecurrent: false })
    expect(unit.timer).not.toBeNull()

    expect(result.entries.find((e) => e.section === 'helpers')!.helperCooldown).not.toBeNull()
  })

  it('never includes the player tag in its output', () => {
    expect(JSON.stringify(result)).not.toContain('REDACTED')
  })
})

describe('parseExport validation', () => {
  it('rejects empty, oversized and non-JSON input without echoing it', () => {
    expect(issues('')).toEqual(['export: is empty'])
    expect(issues('x'.repeat(MAX_EXPORT_BYTES + 1))).toEqual([
      `export: is larger than ${MAX_EXPORT_BYTES} bytes`
    ])
    const secret = '{"tag":"#SECRET123", oops'
    const result = parseExport(secret, KNOWN)
    expect(result).toEqual({ ok: false, issues: [{ path: 'export', message: 'is not valid JSON' }] })
    expect(JSON.stringify(result)).not.toContain('SECRET')
    expect(issues('[]')).toEqual(['export: must be a JSON object'])
  })

  it('requires a timestamp and at least one village section', () => {
    expect(issues(JSON.stringify({ tag: '#X', buildings: [] }))).toEqual([
      'timestamp: must be a positive whole number of seconds'
    ])
    expect(issues(JSON.stringify({ tag: '#X', timestamp: 1, equipment: [] }))).toEqual([
      'export: does not look like a village export (none of buildings, traps, heroes, units, spells found)'
    ])
  })

  it('reports every malformed field with its path', () => {
    expect(
      issues(
        minimal({
          buildings: [
            { data: 1000001, lvl: 0, cnt: 2 },
            { lvl: 3 },
            { data: 1000002, lvl: 2, cnt: 1.5, timer: -1 },
            { data: 1000003, lvl: 1, helper_recurrent: 'yes' }
          ],
          house_parts: [82000000, 0]
        })
      )
    ).toEqual([
      'buildings[0].lvl: must be a positive integer',
      'buildings[1].data: is required',
      'buildings[2].cnt: must be a positive integer',
      'buildings[2].timer: must be a non-negative integer',
      'buildings[3].helper_recurrent: must be true or false',
      'house_parts[1]: must be a positive integer id'
    ])
    expect(issues(minimal({ traps: [1, { data: 2 }] }))).toEqual([
      'traps: must contain only objects or only numeric ids'
    ])
    expect(issues(minimal({ traps: 'none' }))).toEqual(['traps: must be an array or an object'])
  })

  it('reports unknown fields and sections by name and location only', () => {
    const result = parsed(
      minimal({
        buildings: [{ data: 1000001, lvl: 2, cnt: 1, shiny: 'SECRET-VALUE', 'bad name!': 1 }],
        boosts: { double_gold: { until: 'SECRET-BOOST' } },
        brand_new_section: [{ data: 1, private: 'SECRET-NEW' }]
      })
    )
    expect(result.unknownFields).toEqual([
      { path: 'buildings[0].shiny', name: 'shiny' },
      { path: 'buildings[0].<unprintable name>', name: '<unprintable name>' },
      { path: 'boosts.double_gold', name: 'double_gold' }
    ])
    expect(result.unknownSections).toEqual([{ path: 'brand_new_section', name: 'brand_new_section' }])
    expect(result.entries[0]).toMatchObject({ dataId: 1000001, level: 2, count: 1 })
    expect(result.warnings).toHaveLength(2)
    expect(JSON.stringify(result)).not.toContain('SECRET')
  })

  it('reads populated sections whose shape was never observed with the same field checks', () => {
    const result = parsed(minimal({ pets: [{ data: 73000000, lvl: 4 }], siege_machines: [{ data: 4000051, lvl: 2 }] }))
    expect(result.entries.map((e) => `${e.section}:${e.dataId}:${e.level}`)).toEqual([
      'pets:73000000:4',
      'siege_machines:4000051:2'
    ])
  })

  it('warns, but still parses, when the tag is missing', () => {
    const result = parsed(JSON.stringify({ timestamp: 5, buildings: [] }))
    expect(result.warnings).toEqual(['The export has no player tag field.'])
    expect(issues(JSON.stringify({ tag: 5, timestamp: 5, buildings: [] }))).toEqual(['tag: must be a string'])
  })
})
