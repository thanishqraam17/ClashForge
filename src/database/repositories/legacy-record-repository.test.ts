import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createLegacyRecordRepository, type LegacyRecordRepository } from './legacy-record-repository'
import { seedLegacyDatabase } from './test-helpers'

describe('LegacyRecordRepository', () => {
  let dir: string
  let db: Database.Database
  let repo: LegacyRecordRepository

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clashforge-legacy-'))
    db = new Database(join(dir, 'test.db'))
    db.pragma('foreign_keys = ON')
    seedLegacyDatabase(db)
    repo = createLegacyRecordRepository(db)
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('lists every archived record in one shape', () => {
    const records = repo.list()
    expect(records.map((r) => `${r.kind}:${r.name}`)).toEqual([
      'building:Test Cannon',
      'building:Mystery Tower',
      'hero:Test Knight',
      'research:Test Archer'
    ])
    expect(records[0]).toMatchObject({ category: 'DEFENSE', level: 3, quantity: 2, status: 'pending' })
    expect(records[1]).toMatchObject({ isUpgrading: true })
    expect(records[1]!.upgradeEndsAt?.toISOString()).toBe('2026-09-15T00:00:00.000Z')
    expect(records[2]).toMatchObject({ category: null, quantity: 1 })
    expect(records[3]).toMatchObject({ isUpgrading: true, category: 'TROOP' })
    expect(records.every((r) => r.archivedAt instanceof Date)).toBe(true)
  })

  it('filters, counts and records reconciliation outcomes without losing data', () => {
    repo.setPendingNote('building', 2, 'No unique catalogue match')
    repo.markConverted('hero', 1, 'test-knight', 'Matched by name')
    expect(() => repo.markConverted('hero', 1, 'test-knight', 'again')).toThrow('is not pending')

    expect(repo.countByStatus(1)).toEqual({ pending: 3, converted: 1, dismissed: 0 })
    expect(repo.list({ status: 'pending' })).toHaveLength(3)
    expect(repo.get('building', 2)?.note).toBe('No unique catalogue match')

    const hero = repo.get('hero', 1)!
    expect(hero).toMatchObject({
      status: 'converted',
      mappedItemId: 'test-knight',
      name: 'Test Knight',
      level: 4
    })
    expect(hero.reconciledAt).toBeInstanceOf(Date)
  })
})
