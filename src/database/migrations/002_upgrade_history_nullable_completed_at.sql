-- Allow in-progress upgrades to be recorded before completion.

CREATE TABLE upgrade_history_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  village_id INTEGER NOT NULL,
  entity_type TEXT NOT NULL,
  entity_name TEXT NOT NULL,
  from_level INTEGER NOT NULL,
  to_level INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (village_id) REFERENCES villages (id) ON DELETE CASCADE
);

INSERT INTO upgrade_history_new (
  id, village_id, entity_type, entity_name, from_level, to_level,
  started_at, completed_at, created_at
)
SELECT
  id, village_id, entity_type, entity_name, from_level, to_level,
  started_at, completed_at, created_at
FROM upgrade_history;

DROP TABLE upgrade_history;

ALTER TABLE upgrade_history_new RENAME TO upgrade_history;

CREATE INDEX idx_upgrade_history_village_id ON upgrade_history (village_id);
CREATE INDEX idx_upgrade_history_completed_at ON upgrade_history (completed_at DESC);
