import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LATEST_SCHEMA_VERSION, readAppliedVersion, runMigrations } from './migrate'

const T0 = '2026-09-14T10:00:00.000Z'

function openDb(path: string): Database.Database {
  const db = new Database(path)
  db.pragma('foreign_keys = ON')
  return db
}

function columns(db: Database.Database, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
    (column) => column.name
  )
}

/** Builds a schema-v2 database containing representative player data. */
function seedVersion2(db: Database.Database): void {
  runMigrations(db, { upTo: 2 })
  expect(readAppliedVersion(db)).toBe(2)
  db.prepare(
    `INSERT INTO villages (id, town_hall_level, gold, elixir, dark_elixir, gold_capacity,
      elixir_capacity, dark_elixir_capacity, builder_count, available_builders,
      last_scanned_at, created_at, updated_at)
     VALUES (1, 9, 100, 200, 30, 1000, 1000, 500, 4, 2, NULL, ?, ?)`
  ).run(T0, T0)
  db.prepare(
    `INSERT INTO buildings (village_id, name, category, level, quantity, is_upgrading,
      upgrade_started_at, upgrade_ends_at, created_at, updated_at)
     VALUES (1, 'Cannon', 'DEFENSE', 7, 3, 1, ?, '2026-09-15T10:00:00.000Z', ?, ?),
            (1, 'Army Camp', 'ARMY', 6, 4, 0, NULL, NULL, ?, ?)`
  ).run(T0, T0, T0, T0, T0)
  db.prepare(
    `INSERT INTO heroes (village_id, name, level, is_upgrading, upgrade_started_at,
      upgrade_ends_at, created_at, updated_at)
     VALUES (1, 'Barbarian King', 20, 0, NULL, NULL, ?, ?)`
  ).run(T0, T0)
  db.prepare(
    `INSERT INTO research (village_id, name, level, category, is_researching,
      research_started_at, research_ends_at, created_at, updated_at)
     VALUES (1, 'Balloon', 5, 'TROOP', 1, NULL, '2026-09-20T00:00:00.000Z', ?, ?)`
  ).run(T0, T0)
  db.prepare(
    `INSERT INTO upgrade_history (village_id, entity_type, entity_name, from_level, to_level,
      started_at, completed_at, created_at)
     VALUES (1, 'building', 'Cannon', 6, 7, ?, ?, ?)`
  ).run(T0, T0, T0)
}

describe('migrations', () => {
  let dir: string
  let db: Database.Database

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clashforge-migrate-'))
    db = openDb(join(dir, 'test.db'))
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('migrates an empty database to the latest version and is idempotent', () => {
    runMigrations(db)
    expect(readAppliedVersion(db)).toBe(LATEST_SCHEMA_VERSION)
    runMigrations(db)
    expect(readAppliedVersion(db)).toBe(LATEST_SCHEMA_VERSION)
    for (const table of ['village_items', 'builders', 'research', 'village_snapshots']) {
      expect(columns(db, table).length, table).toBeGreaterThan(0)
    }
  })

  describe('v2 -> v3', () => {
    beforeEach(() => {
      seedVersion2(db)
      runMigrations(db, { upTo: 3 })
    })

    it('reaches version 3 with foreign keys intact', () => {
      expect(readAppliedVersion(db)).toBe(3)
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    })

    it('archives every legacy row unchanged, pending reconciliation', () => {
      const buildings = db
        .prepare('SELECT * FROM legacy_buildings ORDER BY id')
        .all() as Array<Record<string, unknown>>
      expect(buildings).toHaveLength(2)
      expect(buildings[0]).toMatchObject({
        name: 'Cannon',
        category: 'DEFENSE',
        level: 7,
        quantity: 3,
        is_upgrading: 1,
        upgrade_ends_at: '2026-09-15T10:00:00.000Z',
        reconciliation_status: 'pending',
        mapped_item_id: null
      })
      expect(typeof buildings[0]!['archived_at']).toBe('string')

      expect(db.prepare('SELECT name, level, reconciliation_status FROM legacy_heroes').all()).toEqual([
        { name: 'Barbarian King', level: 20, reconciliation_status: 'pending' }
      ])
      expect(
        db.prepare('SELECT name, level, is_researching, reconciliation_status FROM legacy_research').all()
      ).toEqual([{ name: 'Balloon', level: 5, is_researching: 1, reconciliation_status: 'pending' }])
    })

    it('leaves new state tables empty rather than guessing catalogue ids', () => {
      expect(db.prepare('SELECT COUNT(*) AS n FROM village_items').get()).toEqual({ n: 0 })
      expect(db.prepare('SELECT COUNT(*) AS n FROM research').get()).toEqual({ n: 0 })
    })

    it('turns the builder count into builder rows and archives the counters', () => {
      expect(columns(db, 'villages')).not.toContain('builder_count')
      expect(columns(db, 'villages')).not.toContain('available_builders')
      expect(db.prepare('SELECT slot, source, confidence FROM builders ORDER BY slot').all()).toEqual([
        { slot: 1, source: 'manual', confidence: 1 },
        { slot: 2, source: 'manual', confidence: 1 },
        { slot: 3, source: 'manual', confidence: 1 },
        { slot: 4, source: 'manual', confidence: 1 }
      ])
      expect(
        db.prepare('SELECT village_id, builder_count, available_builders FROM legacy_village_builder_counts').all()
      ).toEqual([{ village_id: 1, builder_count: 4, available_builders: 2 }])
    })

    it('keeps village resources and marks them as manually confirmed', () => {
      expect(
        db.prepare('SELECT town_hall_level, gold, dark_elixir, source, confidence, confirmed_at FROM villages').get()
      ).toEqual({
        town_hall_level: 9,
        gold: 100,
        dark_elixir: 30,
        source: 'manual',
        confidence: 1,
        confirmed_at: T0
      })
    })

    it('keeps upgrade history', () => {
      expect(db.prepare('SELECT entity_name, to_level FROM upgrade_history').all()).toEqual([
        { entity_name: 'Cannon', to_level: 7 }
      ])
    })
  })

  describe('v2 -> v4 (populated, in one run)', () => {
    beforeEach(() => {
      seedVersion2(db)
      runMigrations(db)
    })

    it('reaches the latest version with integrity and foreign keys intact', () => {
      expect(readAppliedVersion(db)).toBe(LATEST_SCHEMA_VERSION)
      expect(db.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' })
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    })

    it('keeps the village, its resources and its builders', () => {
      expect(
        db
          .prepare(
            'SELECT town_hall_level, gold, elixir, dark_elixir, gold_capacity, elixir_capacity, dark_elixir_capacity, source, confirmed_at FROM villages'
          )
          .get()
      ).toEqual({
        town_hall_level: 9,
        gold: 100,
        elixir: 200,
        dark_elixir: 30,
        gold_capacity: 1000,
        elixir_capacity: 1000,
        dark_elixir_capacity: 500,
        source: 'manual',
        confirmed_at: T0
      })
      expect(db.prepare('SELECT slot FROM builders ORDER BY slot').all()).toEqual([
        { slot: 1 },
        { slot: 2 },
        { slot: 3 },
        { slot: 4 }
      ])
      expect(
        db.prepare('SELECT builder_count, available_builders FROM legacy_village_builder_counts').get()
      ).toEqual({ builder_count: 4, available_builders: 2 })
    })

    it('keeps every legacy record, including its active upgrade, pending reconciliation', () => {
      expect(
        db
          .prepare(
            `SELECT name, level, quantity, is_upgrading, upgrade_started_at, upgrade_ends_at, reconciliation_status
             FROM legacy_buildings ORDER BY id`
          )
          .all()
      ).toEqual([
        {
          name: 'Cannon',
          level: 7,
          quantity: 3,
          is_upgrading: 1,
          upgrade_started_at: T0,
          upgrade_ends_at: '2026-09-15T10:00:00.000Z',
          reconciliation_status: 'pending'
        },
        {
          name: 'Army Camp',
          level: 6,
          quantity: 4,
          is_upgrading: 0,
          upgrade_started_at: null,
          upgrade_ends_at: null,
          reconciliation_status: 'pending'
        }
      ])
      expect(db.prepare('SELECT name, level FROM legacy_heroes').all()).toEqual([
        { name: 'Barbarian King', level: 20 }
      ])
      expect(
        db.prepare('SELECT name, level, is_researching, research_ends_at FROM legacy_research').all()
      ).toEqual([{ name: 'Balloon', level: 5, is_researching: 1, research_ends_at: '2026-09-20T00:00:00.000Z' }])
    })

    it('keeps upgrade history and starts the new tables empty', () => {
      expect(
        db.prepare('SELECT entity_type, entity_name, from_level, to_level, started_at, completed_at FROM upgrade_history').all()
      ).toEqual([
        { entity_type: 'building', entity_name: 'Cannon', from_level: 6, to_level: 7, started_at: T0, completed_at: T0 }
      ])
      for (const table of ['village_items', 'research', 'village_snapshots', 'export_imports', 'export_observations']) {
        expect(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get(), table).toEqual({ n: 0 })
      }
    })
  })

  describe('v3 constraints', () => {
    const now = T0
    beforeEach(() => {
      runMigrations(db, { upTo: 3 })
      db.prepare(
        `INSERT INTO villages (id, town_hall_level, created_at, updated_at) VALUES (1, 9, ?, ?), (2, 9, ?, ?)`
      ).run(now, now, now, now)
      db.prepare(
        `INSERT INTO builders (id, village_id, slot, source, confidence, created_at, updated_at)
         VALUES (1, 1, 1, 'manual', 1, ?, ?), (2, 1, 2, 'manual', 1, ?, ?), (3, 2, 1, 'manual', 1, ?, ?)`
      ).run(now, now, now, now, now, now)
    })

    function insertItem(values: {
      instance: number
      level: number
      target: number | null
      builder: number | null
      village?: number
    }) {
      return db
        .prepare(
          `INSERT INTO village_items (village_id, item_id, instance_number, level, target_level,
            builder_id, source, confidence, created_at, updated_at)
           VALUES (?, 'cannon', ?, ?, ?, ?, 'manual', 1, ?, ?)`
        )
        .run(values.village ?? 1, values.instance, values.level, values.target, values.builder, now, now)
    }

    it('enforces one-level upgrades with a builder from the same village', () => {
      expect(() => insertItem({ instance: 1, level: 3, target: 4, builder: 1 })).not.toThrow()
      expect(() => insertItem({ instance: 2, level: 3, target: 5, builder: 2 })).toThrow(/CHECK/)
      expect(() => insertItem({ instance: 3, level: 3, target: 4, builder: null })).toThrow(/CHECK/)
      expect(() => insertItem({ instance: 4, level: 3, target: null, builder: 2 })).toThrow(/CHECK/)
      expect(() => insertItem({ instance: 5, level: 3, target: 4, builder: 3 })).toThrow(/FOREIGN KEY/)
    })

    it('lets a builder work on only one upgrade', () => {
      insertItem({ instance: 1, level: 3, target: 4, builder: 1 })
      expect(() => insertItem({ instance: 2, level: 3, target: 4, builder: 1 })).toThrow(/UNIQUE/)
    })

    it('rejects duplicate instance numbers', () => {
      insertItem({ instance: 1, level: 3, target: null, builder: null })
      expect(() => insertItem({ instance: 1, level: 4, target: null, builder: null })).toThrow(/UNIQUE/)
    })

    it('allows only one active research per village', () => {
      const insert = db.prepare(
        `INSERT INTO research (village_id, item_id, level, target_level, source, confidence, created_at, updated_at)
         VALUES (1, ?, 2, ?, 'manual', 1, ?, ?)`
      )
      insert.run('archer', 3, now, now)
      insert.run('giant', null, now, now)
      expect(() => insert.run('wizard', 3, now, now)).toThrow(/UNIQUE/)
    })

    it('makes snapshots immutable', () => {
      db.prepare(
        `INSERT INTO village_snapshots (village_id, captured_at, source, data_version, schema_version, payload, created_at)
         VALUES (1, ?, 'manual', '0.1.1', 1, '{"ok":true}', ?)`
      ).run(now, now)
      expect(() => db.prepare(`UPDATE village_snapshots SET payload = '{}'`).run()).toThrow(
        /village snapshots are immutable/
      )
      expect(() =>
        db.prepare(
          `INSERT INTO village_snapshots (village_id, captured_at, source, data_version, schema_version, payload, created_at)
           VALUES (1, ?, 'manual', '0.1.1', 1, 'not json', ?)`
        ).run(now, now)
      ).toThrow(/CHECK/)
    })
  })

  describe('v3 -> v4', () => {
    const now = T0

    function seedVersion3(): void {
      runMigrations(db, { upTo: 3 })
      db.prepare(
        `INSERT INTO villages (id, town_hall_level, created_at, updated_at) VALUES (1, 9, ?, ?)`
      ).run(now, now)
      db.prepare(
        `INSERT INTO builders (id, village_id, slot, source, confidence, created_at, updated_at)
         VALUES (1, 1, 1, 'manual', 1, ?, ?), (2, 1, 2, 'manual', 1, ?, ?)`
      ).run(now, now, now, now)
      db.prepare(
        `INSERT INTO village_items (village_id, item_id, instance_number, level, target_level, builder_id,
           upgrade_ends_at, source, confidence, confirmed_at, created_at, updated_at)
         VALUES (1, 'cannon', 1, 3, 4, 1, '2026-09-15T00:00:00.000Z', 'manual', 1, ?, ?, ?),
                (1, 'cannon', 2, 5, 6, 2, NULL, 'timer-estimate', 0.5, NULL, ?, ?),
                (1, 'mortar', 1, 2, NULL, NULL, NULL, 'manual', 1, ?, ?, ?)`
      ).run(now, now, now, now, now, now, now, now)
    }

    it('keeps every item and derives builder assignments', () => {
      seedVersion3()
      runMigrations(db)
      expect(readAppliedVersion(db)).toBe(4)
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
      expect(
        db
          .prepare(
            `SELECT item_id, instance_number, level, target_level, builder_id, builder_assignment,
               upgrade_ends_at, upgrade_observed_timer
             FROM village_items ORDER BY item_id, instance_number`
          )
          .all()
      ).toEqual([
        {
          item_id: 'cannon', instance_number: 1, level: 3, target_level: 4, builder_id: 1,
          builder_assignment: 'confirmed', upgrade_ends_at: '2026-09-15T00:00:00.000Z',
          upgrade_observed_timer: null
        },
        {
          item_id: 'cannon', instance_number: 2, level: 5, target_level: 6, builder_id: 2,
          builder_assignment: 'assigned', upgrade_ends_at: null, upgrade_observed_timer: null
        },
        {
          item_id: 'mortar', instance_number: 1, level: 2, target_level: null, builder_id: null,
          builder_assignment: null, upgrade_ends_at: null, upgrade_observed_timer: null
        }
      ])
    })

    describe('v4 constraints', () => {
      beforeEach(() => {
        seedVersion3()
        runMigrations(db)
      })

      function insert(values: Record<string, unknown>) {
        const row = {
          instance: 9,
          level: 1,
          target: 2,
          builder: null,
          assignment: 'unknown',
          source: 'data-export',
          timer: 600,
          observedAt: now,
          ...values
        }
        return db
          .prepare(
            `INSERT INTO village_items (village_id, item_id, instance_number, level, target_level, builder_id,
               builder_assignment, upgrade_observed_timer, upgrade_observed_at, source, confidence,
               created_at, updated_at)
             VALUES (1, 'trap', @instance, @level, @target, @builder, @assignment, @timer, @observedAt,
               @source, 0.9, @now, @now)`
          )
          .run({ ...row, now })
      }

      it('allows an unknown builder only for imported sources', () => {
        expect(() => insert({})).not.toThrow()
        expect(() => insert({ instance: 10, source: 'screenshot' })).not.toThrow()
        expect(() => insert({ instance: 11, source: 'manual' })).toThrow(/CHECK/)
        expect(() => insert({ instance: 12, source: 'timer-estimate' })).toThrow(/CHECK/)
      })

      it('ties unknown to a missing builder and manual upgrades to confirmed builders', () => {
        expect(() => insert({ instance: 13, builder: 2 })).toThrow(/CHECK/)
        expect(() => insert({ instance: 14, assignment: 'assigned' })).toThrow(/CHECK/)
        expect(() => insert({ instance: 15, assignment: null })).toThrow(/CHECK/)
        db.prepare('DELETE FROM village_items WHERE builder_id = 2').run()
        const manual = { source: 'manual', builder: 2, timer: null, observedAt: null }
        expect(() => insert({ ...manual, instance: 16, assignment: 'assigned' })).toThrow(/CHECK/)
        expect(() => insert({ ...manual, instance: 17, assignment: 'confirmed' })).not.toThrow()
      })

      it('keeps observed timers paired and only on upgrades', () => {
        expect(() => insert({ instance: 18, observedAt: null })).toThrow(/CHECK/)
        expect(() => insert({ instance: 19, target: null, assignment: null })).toThrow(/CHECK/)
      })

      function createImport(hashChar: string): number {
        return Number(
          db
            .prepare(
              `INSERT INTO export_imports (village_id, export_timestamp, content_sha256, data_version,
                 semantics_version, status, previewed_at, state_fingerprint, summary, created_at)
               VALUES (1, 1794481225, ?, '0.1.1', '0.1.0', 'previewed', ?, 'fp', '{}', ?)`
            )
            .run(hashChar.repeat(64), now, now).lastInsertRowid
        )
      }

      it('only lets imports move from previewed to applied or discarded', () => {
        const id = createImport('a')
        expect(() =>
          db.prepare(`UPDATE export_imports SET summary = '{"x":1}' WHERE id = ?`).run(id)
        ).toThrow(/previewed to applied/)
        expect(() =>
          db.prepare(`UPDATE export_imports SET status = 'applied', applied_at = ? WHERE id = ?`).run(now, id)
        ).toThrow(/CHECK/)
        db.prepare(
          `UPDATE export_imports SET status = 'applied', applied_at = ?, apply_result = '{}' WHERE id = ?`
        ).run(now, id)
        expect(() =>
          db.prepare(`UPDATE export_imports SET status = 'discarded', discarded_at = ? WHERE id = ?`).run(now, id)
        ).toThrow(/previewed to applied/)
        expect(db.prepare('SELECT export_timestamp FROM export_imports WHERE id = ?').get(id)).toEqual({
          export_timestamp: 1794481225
        })
      })

      it('keeps observations immutable and internally consistent', () => {
        const importId = createImport('b')
        const add = db.prepare(
          `INSERT INTO export_observations (import_id, section, position, data_id, level, count, timer,
             mapped_item_id, classification, timer_disposition, created_at)
           VALUES (@importId, 'traps', @position, 12000000, 6, NULL, @timer, @mapped, @classification,
             @disposition, @now)`
        )
        const base = {
          importId,
          now,
          timer: 4601,
          mapped: null,
          classification: 'unmapped',
          disposition: 'ignored-unverified'
        }
        add.run({ ...base, position: 0 })
        expect(() => add.run({ ...base, position: 1, disposition: null })).toThrow(/CHECK/)
        expect(() => add.run({ ...base, position: 2, classification: 'mapped' })).toThrow(/CHECK/)
        expect(() => add.run({ ...base, position: 0 })).toThrow(/UNIQUE/)
        expect(() => db.prepare('UPDATE export_observations SET level = 7').run()).toThrow(
          /export observations are immutable/
        )
        expect(db.prepare('SELECT count, timer FROM export_observations').get()).toEqual({
          count: null,
          timer: 4601
        })
      })
    })
  })
})
