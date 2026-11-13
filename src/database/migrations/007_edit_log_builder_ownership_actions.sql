-- Widens edit_log's action CHECK to add 'set-ordinary-huts', 'set-bob' and
-- 'reclassify-legacy-builders' (the builder-ownership correction). SQLite
-- cannot alter an existing CHECK constraint, so the table is rebuilt exactly
-- as migration 004 rebuilt village_items: every existing row, including its
-- immutability, is preserved unchanged; only the allowed action values grow.

CREATE TABLE edit_log_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  village_id INTEGER NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN (
    'village', 'item-instance', 'builders', 'research',
    'legacy-building', 'legacy-hero', 'legacy-research'
  )),
  entity_id INTEGER CHECK (entity_id IS NULL OR entity_id >= 1),
  item_id TEXT,
  action TEXT NOT NULL CHECK (action IN (
    'create', 'update', 'delete', 'set-count', 'map', 'dismiss',
    'set-ordinary-huts', 'set-bob', 'reclassify-legacy-builders'
  )),
  before_state TEXT CHECK (before_state IS NULL OR json_valid(before_state)),
  after_state TEXT CHECK (after_state IS NULL OR json_valid(after_state)),
  batch_id TEXT CHECK (batch_id IS NULL OR length(batch_id) BETWEEN 1 AND 64),
  note TEXT CHECK (note IS NULL OR length(note) BETWEEN 1 AND 500),
  created_at TEXT NOT NULL,
  CHECK (before_state IS NOT NULL OR after_state IS NOT NULL),
  CHECK (action <> 'create' OR before_state IS NULL),
  CHECK (action <> 'delete' OR after_state IS NULL),
  FOREIGN KEY (village_id) REFERENCES villages (id) ON DELETE CASCADE
);

INSERT INTO edit_log_new
  SELECT id, village_id, entity_type, entity_id, item_id, action, before_state, after_state,
         batch_id, note, created_at
  FROM edit_log;

DROP TRIGGER edit_log_no_update;
DROP TABLE edit_log;
ALTER TABLE edit_log_new RENAME TO edit_log;

CREATE INDEX idx_edit_log_village ON edit_log (village_id, created_at DESC, id DESC);
CREATE INDEX idx_edit_log_batch ON edit_log (batch_id) WHERE batch_id IS NOT NULL;

CREATE TRIGGER edit_log_no_update
BEFORE UPDATE ON edit_log
BEGIN
  SELECT RAISE(ABORT, 'edit log entries are immutable');
END;
