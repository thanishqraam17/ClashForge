-- ClashForge application schema (v1). Upgrade costs/durations live in Phase 3 data, not here.

CREATE TABLE villages (
  id INTEGER PRIMARY KEY,
  town_hall_level INTEGER NOT NULL,
  gold INTEGER NOT NULL DEFAULT 0,
  elixir INTEGER NOT NULL DEFAULT 0,
  dark_elixir INTEGER NOT NULL DEFAULT 0,
  gold_capacity INTEGER NOT NULL DEFAULT 0,
  elixir_capacity INTEGER NOT NULL DEFAULT 0,
  dark_elixir_capacity INTEGER NOT NULL DEFAULT 0,
  builder_count INTEGER NOT NULL DEFAULT 0,
  available_builders INTEGER NOT NULL DEFAULT 0,
  last_scanned_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE buildings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  village_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  level INTEGER NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  is_upgrading INTEGER NOT NULL DEFAULT 0,
  upgrade_started_at TEXT,
  upgrade_ends_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (village_id) REFERENCES villages (id) ON DELETE CASCADE
);

CREATE INDEX idx_buildings_village_id ON buildings (village_id);

CREATE TABLE heroes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  village_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  level INTEGER NOT NULL,
  is_upgrading INTEGER NOT NULL DEFAULT 0,
  upgrade_started_at TEXT,
  upgrade_ends_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (village_id) REFERENCES villages (id) ON DELETE CASCADE
);

CREATE INDEX idx_heroes_village_id ON heroes (village_id);

CREATE TABLE research (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  village_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  level INTEGER NOT NULL,
  category TEXT NOT NULL,
  is_researching INTEGER NOT NULL DEFAULT 0,
  research_started_at TEXT,
  research_ends_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (village_id) REFERENCES villages (id) ON DELETE CASCADE
);

CREATE INDEX idx_research_village_id ON research (village_id);

CREATE TABLE upgrade_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  village_id INTEGER NOT NULL,
  entity_type TEXT NOT NULL,
  entity_name TEXT NOT NULL,
  from_level INTEGER NOT NULL,
  to_level INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (village_id) REFERENCES villages (id) ON DELETE CASCADE
);

CREATE INDEX idx_upgrade_history_village_id ON upgrade_history (village_id);
CREATE INDEX idx_upgrade_history_completed_at ON upgrade_history (completed_at DESC);
