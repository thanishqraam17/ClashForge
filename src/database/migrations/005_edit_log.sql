-- Phase 7: audit log of manual village edits.
--
-- Additive: no existing table changes. One row per manual change, with plain
-- JSON copies of the record before and after. Rows cannot be updated
-- (trigger); they are only removed when their village is deleted (cascade).
-- Imports keep their own audit trail (export_imports, export_observations,
-- snapshots) and are not written here.

CREATE TABLE edit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  village_id INTEGER NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN (
    'village', 'item-instance', 'builders', 'research',
    'legacy-building', 'legacy-hero', 'legacy-research'
  )),
  -- NULL for village-wide changes (e.g. the builder count).
  entity_id INTEGER CHECK (entity_id IS NULL OR entity_id >= 1),
  -- Catalogue item id, so history can be filtered by item.
  item_id TEXT,
  action TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete', 'set-count', 'map', 'dismiss')),
  before_state TEXT CHECK (before_state IS NULL OR json_valid(before_state)),
  after_state TEXT CHECK (after_state IS NULL OR json_valid(after_state)),
  -- Shared by every entry of one bulk edit.
  batch_id TEXT CHECK (batch_id IS NULL OR length(batch_id) BETWEEN 1 AND 64),
  note TEXT CHECK (note IS NULL OR length(note) BETWEEN 1 AND 500),
  created_at TEXT NOT NULL,
  CHECK (before_state IS NOT NULL OR after_state IS NOT NULL),
  CHECK (action <> 'create' OR before_state IS NULL),
  CHECK (action <> 'delete' OR after_state IS NULL),
  FOREIGN KEY (village_id) REFERENCES villages (id) ON DELETE CASCADE
);

CREATE INDEX idx_edit_log_village ON edit_log (village_id, created_at DESC, id DESC);
CREATE INDEX idx_edit_log_batch ON edit_log (batch_id) WHERE batch_id IS NOT NULL;

CREATE TRIGGER edit_log_no_update
BEFORE UPDATE ON edit_log
BEGIN
  SELECT RAISE(ABORT, 'edit log entries are immutable');
END;
