-- Village state model (Phase 5).
--
-- Non-destructive: legacy building, hero and research rows are archived, not
-- deleted. They keep every original column and gain reconciliation fields so
-- they can be converted once a reliable catalogue mapping exists, or resolved
-- by the player. Builder counters are archived before their columns are dropped.

-- ---------------------------------------------------------------------------
-- 1. Archive legacy tables
-- ---------------------------------------------------------------------------

ALTER TABLE buildings RENAME TO legacy_buildings;
ALTER TABLE heroes RENAME TO legacy_heroes;
ALTER TABLE research RENAME TO legacy_research;

DROP INDEX IF EXISTS idx_buildings_village_id;
DROP INDEX IF EXISTS idx_heroes_village_id;
DROP INDEX IF EXISTS idx_research_village_id;
CREATE INDEX idx_legacy_buildings_village_id ON legacy_buildings (village_id);
CREATE INDEX idx_legacy_heroes_village_id ON legacy_heroes (village_id);
CREATE INDEX idx_legacy_research_village_id ON legacy_research (village_id);

-- reconciliation_status: pending | converted | dismissed
ALTER TABLE legacy_buildings ADD COLUMN reconciliation_status TEXT NOT NULL DEFAULT 'pending'
  CHECK (reconciliation_status IN ('pending', 'converted', 'dismissed'));
ALTER TABLE legacy_buildings ADD COLUMN mapped_item_id TEXT;
ALTER TABLE legacy_buildings ADD COLUMN reconciliation_note TEXT;
ALTER TABLE legacy_buildings ADD COLUMN reconciled_at TEXT;
ALTER TABLE legacy_buildings ADD COLUMN archived_at TEXT;

ALTER TABLE legacy_heroes ADD COLUMN reconciliation_status TEXT NOT NULL DEFAULT 'pending'
  CHECK (reconciliation_status IN ('pending', 'converted', 'dismissed'));
ALTER TABLE legacy_heroes ADD COLUMN mapped_item_id TEXT;
ALTER TABLE legacy_heroes ADD COLUMN reconciliation_note TEXT;
ALTER TABLE legacy_heroes ADD COLUMN reconciled_at TEXT;
ALTER TABLE legacy_heroes ADD COLUMN archived_at TEXT;

ALTER TABLE legacy_research ADD COLUMN reconciliation_status TEXT NOT NULL DEFAULT 'pending'
  CHECK (reconciliation_status IN ('pending', 'converted', 'dismissed'));
ALTER TABLE legacy_research ADD COLUMN mapped_item_id TEXT;
ALTER TABLE legacy_research ADD COLUMN reconciliation_note TEXT;
ALTER TABLE legacy_research ADD COLUMN reconciled_at TEXT;
ALTER TABLE legacy_research ADD COLUMN archived_at TEXT;

UPDATE legacy_buildings SET archived_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
UPDATE legacy_heroes SET archived_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
UPDATE legacy_research SET archived_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');

CREATE TABLE legacy_village_builder_counts (
  village_id INTEGER PRIMARY KEY,
  builder_count INTEGER NOT NULL,
  available_builders INTEGER NOT NULL,
  archived_at TEXT NOT NULL,
  FOREIGN KEY (village_id) REFERENCES villages (id) ON DELETE CASCADE
);

INSERT INTO legacy_village_builder_counts (village_id, builder_count, available_builders, archived_at)
SELECT id, builder_count, available_builders, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM villages;

-- ---------------------------------------------------------------------------
-- 2. Village provenance; builder counters move to the builders table
-- ---------------------------------------------------------------------------

ALTER TABLE villages ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'
  CHECK (source IN ('manual', 'data-export', 'screenshot', 'live-capture', 'timer-estimate'));
ALTER TABLE villages ADD COLUMN confidence REAL NOT NULL DEFAULT 1
  CHECK (confidence >= 0 AND confidence <= 1);
ALTER TABLE villages ADD COLUMN confirmed_at TEXT;

-- Existing villages were entered manually; treat their last save as confirmation.
UPDATE villages SET confirmed_at = updated_at;

CREATE TABLE builders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  village_id INTEGER NOT NULL,
  slot INTEGER NOT NULL CHECK (slot >= 1),
  source TEXT NOT NULL
    CHECK (source IN ('manual', 'data-export', 'screenshot', 'live-capture', 'timer-estimate')),
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  confirmed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (village_id, slot),
  UNIQUE (id, village_id),
  FOREIGN KEY (village_id) REFERENCES villages (id) ON DELETE CASCADE
);

-- One builder row per previously counted builder (slots 1..builder_count).
WITH RECURSIVE slots (village_id, slot, total) AS (
  SELECT id, 1, builder_count FROM villages WHERE builder_count >= 1
  UNION ALL
  SELECT village_id, slot + 1, total FROM slots WHERE slot < total
)
INSERT INTO builders (village_id, slot, source, confidence, confirmed_at, created_at, updated_at)
SELECT
  s.village_id, s.slot, 'manual', 1, v.updated_at,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM slots s JOIN villages v ON v.id = s.village_id;

ALTER TABLE villages DROP COLUMN builder_count;
ALTER TABLE villages DROP COLUMN available_builders;

-- ---------------------------------------------------------------------------
-- 3. Item instances (builder-upgraded items, one row per owned instance)
-- ---------------------------------------------------------------------------

CREATE TABLE village_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  village_id INTEGER NOT NULL,
  item_id TEXT NOT NULL,
  instance_number INTEGER NOT NULL CHECK (instance_number >= 1),
  level INTEGER NOT NULL CHECK (level >= 1),
  target_level INTEGER,
  upgrade_started_at TEXT,
  upgrade_ends_at TEXT,
  builder_id INTEGER,
  source TEXT NOT NULL
    CHECK (source IN ('manual', 'data-export', 'screenshot', 'live-capture', 'timer-estimate')),
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  confirmed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (village_id, item_id, instance_number),
  CHECK (target_level IS NULL OR target_level = level + 1),
  CHECK (
    (target_level IS NULL AND builder_id IS NULL
      AND upgrade_started_at IS NULL AND upgrade_ends_at IS NULL)
    OR (target_level IS NOT NULL AND builder_id IS NOT NULL)
  ),
  FOREIGN KEY (village_id) REFERENCES villages (id) ON DELETE CASCADE,
  -- The builder must belong to the same village.
  FOREIGN KEY (builder_id, village_id) REFERENCES builders (id, village_id)
);

CREATE INDEX idx_village_items_village_id ON village_items (village_id);
-- A builder works on at most one upgrade at a time.
CREATE UNIQUE INDEX idx_village_items_builder ON village_items (builder_id)
  WHERE builder_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. Laboratory research
-- ---------------------------------------------------------------------------

CREATE TABLE research (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  village_id INTEGER NOT NULL,
  item_id TEXT NOT NULL,
  level INTEGER NOT NULL CHECK (level >= 1),
  target_level INTEGER,
  research_started_at TEXT,
  research_ends_at TEXT,
  source TEXT NOT NULL
    CHECK (source IN ('manual', 'data-export', 'screenshot', 'live-capture', 'timer-estimate')),
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  confirmed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (village_id, item_id),
  CHECK (target_level IS NULL OR target_level = level + 1),
  CHECK (
    target_level IS NOT NULL
    OR (research_started_at IS NULL AND research_ends_at IS NULL)
  ),
  FOREIGN KEY (village_id) REFERENCES villages (id) ON DELETE CASCADE
);

CREATE INDEX idx_research_village_id ON research (village_id);
-- The Laboratory runs one research at a time.
CREATE UNIQUE INDEX idx_research_one_active ON research (village_id)
  WHERE target_level IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 5. Immutable village snapshots
-- ---------------------------------------------------------------------------

CREATE TABLE village_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  village_id INTEGER NOT NULL,
  captured_at TEXT NOT NULL,
  source TEXT NOT NULL
    CHECK (source IN ('manual', 'data-export', 'screenshot', 'live-capture', 'timer-estimate')),
  data_version TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  created_at TEXT NOT NULL,
  FOREIGN KEY (village_id) REFERENCES villages (id) ON DELETE CASCADE
);

CREATE INDEX idx_village_snapshots_village_captured
  ON village_snapshots (village_id, captured_at DESC, id DESC);

-- A snapshot records the state at its capture time and is never edited.
CREATE TRIGGER village_snapshots_no_update
BEFORE UPDATE ON village_snapshots
BEGIN
  SELECT RAISE(ABORT, 'village snapshots are immutable');
END;
