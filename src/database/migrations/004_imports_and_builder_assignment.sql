-- Phase 6: structured export imports.
--
-- 1. village_items gains builder_assignment (confirmed | assigned | unknown) so
--    an imported upgrade can exist without a known builder, plus the raw
--    imported timer and export time. A NULL builder is allowed only for
--    imported sources; manual upgrades must have a confirmed builder.
-- 2. export_imports records each previewed/applied/discarded import.
-- 3. export_observations keeps every parsed export entry exactly as observed
--    (known fields only; unknown field values are never stored).

-- ---------------------------------------------------------------------------
-- 1. Rebuild village_items (SQLite cannot alter CHECK constraints)
-- ---------------------------------------------------------------------------

CREATE TABLE village_items_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  village_id INTEGER NOT NULL,
  item_id TEXT NOT NULL,
  instance_number INTEGER NOT NULL CHECK (instance_number >= 1),
  level INTEGER NOT NULL CHECK (level >= 1),
  target_level INTEGER,
  upgrade_started_at TEXT,
  upgrade_ends_at TEXT,
  builder_id INTEGER,
  builder_assignment TEXT CHECK (builder_assignment IN ('confirmed', 'assigned', 'unknown')),
  -- Raw values from an export, kept unchanged: seconds as exported, and the export time.
  upgrade_observed_timer INTEGER CHECK (upgrade_observed_timer >= 0),
  upgrade_observed_at TEXT,
  source TEXT NOT NULL
    CHECK (source IN ('manual', 'data-export', 'screenshot', 'live-capture', 'timer-estimate')),
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  confirmed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (village_id, item_id, instance_number),
  CHECK (target_level IS NULL OR target_level = level + 1),
  -- Idle instances carry no upgrade data; upgrading ones always state their builder assignment.
  CHECK (
    (target_level IS NULL AND builder_id IS NULL AND builder_assignment IS NULL
      AND upgrade_started_at IS NULL AND upgrade_ends_at IS NULL
      AND upgrade_observed_timer IS NULL AND upgrade_observed_at IS NULL)
    OR (target_level IS NOT NULL AND builder_assignment IS NOT NULL)
  ),
  -- 'unknown' exactly when there is no builder.
  CHECK (builder_assignment IS NULL OR ((builder_assignment = 'unknown') = (builder_id IS NULL))),
  -- Only imported/recognised data may leave the builder unknown.
  CHECK (
    builder_assignment IS NULL OR builder_assignment <> 'unknown'
    OR source IN ('data-export', 'screenshot', 'live-capture')
  ),
  -- Manually entered upgrades always have a confirmed builder.
  CHECK (target_level IS NULL OR source <> 'manual' OR builder_assignment = 'confirmed'),
  CHECK ((upgrade_observed_timer IS NULL) = (upgrade_observed_at IS NULL)),
  FOREIGN KEY (village_id) REFERENCES villages (id) ON DELETE CASCADE,
  FOREIGN KEY (builder_id, village_id) REFERENCES builders (id, village_id)
);

INSERT INTO village_items_new (
  id, village_id, item_id, instance_number, level, target_level,
  upgrade_started_at, upgrade_ends_at, builder_id, builder_assignment,
  upgrade_observed_timer, upgrade_observed_at,
  source, confidence, confirmed_at, created_at, updated_at
)
SELECT
  id, village_id, item_id, instance_number, level, target_level,
  upgrade_started_at, upgrade_ends_at, builder_id,
  CASE
    WHEN target_level IS NULL THEN NULL
    WHEN source = 'manual' THEN 'confirmed'
    ELSE 'assigned'
  END,
  NULL, NULL,
  source, confidence, confirmed_at, created_at, updated_at
FROM village_items;

DROP TABLE village_items;
ALTER TABLE village_items_new RENAME TO village_items;

CREATE INDEX idx_village_items_village_id ON village_items (village_id);
CREATE UNIQUE INDEX idx_village_items_builder ON village_items (builder_id)
  WHERE builder_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Imports
-- ---------------------------------------------------------------------------

CREATE TABLE export_imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  village_id INTEGER NOT NULL,
  -- Original export timestamp (Unix seconds), unchanged.
  export_timestamp INTEGER NOT NULL,
  -- SHA-256 of the raw export text. The raw text itself is never stored.
  content_sha256 TEXT NOT NULL CHECK (length(content_sha256) = 64),
  data_version TEXT NOT NULL,
  semantics_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('previewed', 'applied', 'discarded')),
  previewed_at TEXT NOT NULL,
  applied_at TEXT,
  discarded_at TEXT,
  -- Fingerprint of the village state the preview was computed against.
  state_fingerprint TEXT NOT NULL,
  -- Preview summary (JSON). Contains unknown field names/locations, never their values.
  summary TEXT NOT NULL CHECK (json_valid(summary)),
  -- What was applied (JSON), set once when applied.
  apply_result TEXT CHECK (apply_result IS NULL OR json_valid(apply_result)),
  created_at TEXT NOT NULL,
  CHECK ((status = 'applied') = (applied_at IS NOT NULL)),
  CHECK ((status = 'discarded') = (discarded_at IS NOT NULL)),
  CHECK ((status = 'applied') = (apply_result IS NOT NULL)),
  FOREIGN KEY (village_id) REFERENCES villages (id) ON DELETE CASCADE
);

CREATE INDEX idx_export_imports_village ON export_imports (village_id, previewed_at DESC, id DESC);

-- Only previewed -> applied or previewed -> discarded; everything else is fixed.
CREATE TRIGGER export_imports_transitions
BEFORE UPDATE ON export_imports
WHEN OLD.status <> 'previewed'
  OR NEW.status NOT IN ('applied', 'discarded')
  OR NEW.id IS NOT OLD.id
  OR NEW.village_id IS NOT OLD.village_id
  OR NEW.export_timestamp IS NOT OLD.export_timestamp
  OR NEW.content_sha256 IS NOT OLD.content_sha256
  OR NEW.data_version IS NOT OLD.data_version
  OR NEW.semantics_version IS NOT OLD.semantics_version
  OR NEW.previewed_at IS NOT OLD.previewed_at
  OR NEW.state_fingerprint IS NOT OLD.state_fingerprint
  OR NEW.summary IS NOT OLD.summary
  OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'export imports only move from previewed to applied or discarded');
END;

-- ---------------------------------------------------------------------------
-- 3. Observations: every parsed export entry, exactly as observed
-- ---------------------------------------------------------------------------

CREATE TABLE export_observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  import_id INTEGER NOT NULL,
  section TEXT NOT NULL,
  -- Position of the entry within its section, as exported.
  position INTEGER NOT NULL CHECK (position >= 0),
  data_id INTEGER NOT NULL,
  -- Known export fields. NULL means the field was absent (e.g. count NULL = no explicit cnt).
  level INTEGER,
  count INTEGER,
  timer INTEGER,
  gear_up INTEGER,
  helper_cooldown INTEGER,
  helper_recurrent INTEGER CHECK (helper_recurrent IN (0, 1)),
  mapped_item_id TEXT,
  classification TEXT NOT NULL
    CHECK (classification IN ('mapped', 'unmapped', 'out-of-scope', 'unknown-section')),
  -- What happened to the timer, when there was one.
  timer_disposition TEXT CHECK (timer_disposition IN ('ignored-unverified', 'applied-as-upgrade')),
  created_at TEXT NOT NULL,
  UNIQUE (import_id, section, position),
  CHECK ((classification = 'mapped') = (mapped_item_id IS NOT NULL)),
  CHECK ((timer IS NULL) = (timer_disposition IS NULL)),
  FOREIGN KEY (import_id) REFERENCES export_imports (id) ON DELETE CASCADE
);

CREATE INDEX idx_export_observations_import ON export_observations (import_id, section, position);

CREATE TRIGGER export_observations_no_update
BEFORE UPDATE ON export_observations
BEGIN
  SELECT RAISE(ABORT, 'export observations are immutable');
END;
