CREATE TABLE IF NOT EXISTS maps (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  minimum_level INTEGER NOT NULL DEFAULT 1,
  maximum_level INTEGER,
  spawn_x REAL NOT NULL DEFAULT 64,
  spawn_y REAL NOT NULL DEFAULT 0,
  spawn_z REAL NOT NULL DEFAULT 64,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1))
);

CREATE TABLE IF NOT EXISTS channels (
  id INTEGER PRIMARY KEY,
  map_id INTEGER NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  channel_number INTEGER NOT NULL,
  name TEXT NOT NULL,
  maximum_players INTEGER NOT NULL DEFAULT 100 CHECK (maximum_players > 0),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  UNIQUE(map_id, channel_number)
);

CREATE INDEX IF NOT EXISTS idx_channels_map ON channels(map_id, enabled, channel_number);

INSERT OR IGNORE INTO maps (id, code, name, minimum_level, spawn_x, spawn_z) VALUES
  (0, 'pangaea', 'Pangaea', 1, 64, 64);

INSERT OR IGNORE INTO channels (id, map_id, channel_number, name, maximum_players) VALUES
  (1, 0, 1, 'Pangaea 1', 100);
