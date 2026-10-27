ALTER TABLE accounts ADD COLUMN security_level INTEGER NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'banned'));
ALTER TABLE accounts ADD COLUMN last_login_at TEXT;
ALTER TABLE accounts ADD COLUMN last_login_ip TEXT;

ALTER TABLE characters ADD COLUMN experience INTEGER NOT NULL DEFAULT 0;
ALTER TABLE characters ADD COLUMN current_world INTEGER NOT NULL DEFAULT 0;
ALTER TABLE characters ADD COLUMN current_channel INTEGER NOT NULL DEFAULT 1;
ALTER TABLE characters ADD COLUMN position_x REAL NOT NULL DEFAULT 64;
ALTER TABLE characters ADD COLUMN position_y REAL NOT NULL DEFAULT 0;
ALTER TABLE characters ADD COLUMN position_z REAL NOT NULL DEFAULT 64;
ALTER TABLE characters ADD COLUMN created_at TEXT;
ALTER TABLE characters ADD COLUMN last_played_at TEXT;

ALTER TABLE inventory_items ADD COLUMN acquired_at TEXT;
ALTER TABLE inventory_items ADD COLUMN expires_at TEXT;

CREATE TABLE IF NOT EXISTS item_definitions (
  item_id INTEGER PRIMARY KEY,
  name TEXT,
  category TEXT NOT NULL DEFAULT 'unknown' CHECK (category IN ('unknown', 'clothing', 'equipment', 'consumable', 'fish', 'quest')),
  equipment_slot INTEGER,
  required_level INTEGER NOT NULL DEFAULT 1,
  required_grade INTEGER NOT NULL DEFAULT 1,
  maximum_durability INTEGER NOT NULL DEFAULT 0,
  stack_limit INTEGER NOT NULL DEFAULT 1,
  gold_price INTEGER,
  cash_price INTEGER,
  model_code TEXT,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1))
);

CREATE TABLE IF NOT EXISTS friends (
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  friend_character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'blocked')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(character_id, friend_character_id),
  CHECK(character_id <> friend_character_id)
);

CREATE TABLE IF NOT EXISTS aquariums (
  id INTEGER PRIMARY KEY,
  character_id INTEGER NOT NULL UNIQUE REFERENCES characters(id) ON DELETE CASCADE,
  name TEXT,
  level INTEGER NOT NULL DEFAULT 1,
  experience INTEGER NOT NULL DEFAULT 0,
  capacity INTEGER NOT NULL DEFAULT 10,
  cleanliness INTEGER NOT NULL DEFAULT 100,
  water_quality INTEGER NOT NULL DEFAULT 100,
  food INTEGER NOT NULL DEFAULT 100,
  visitor_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS aquarium_fish (
  id INTEGER PRIMARY KEY,
  aquarium_id INTEGER NOT NULL REFERENCES aquariums(id) ON DELETE CASCADE,
  fish_item_id INTEGER NOT NULL,
  size REAL NOT NULL DEFAULT 0,
  weight REAL NOT NULL DEFAULT 0,
  grade INTEGER NOT NULL DEFAULT 1,
  hunger INTEGER NOT NULL DEFAULT 100,
  health INTEGER NOT NULL DEFAULT 100,
  growth INTEGER NOT NULL DEFAULT 0,
  display_slot INTEGER,
  caught_at TEXT,
  added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS account_logins (
  id INTEGER PRIMARY KEY,
  account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  ip_address TEXT,
  succeeded INTEGER NOT NULL CHECK (succeeded IN (0, 1)),
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO item_definitions (item_id, category, equipment_slot, required_level, maximum_durability, model_code) VALUES
  (524801, 'equipment', 8, 1, 100, 'FishingRod_001'),
  (66049, 'clothing', NULL, 1, 100, NULL),
  (524900, 'clothing', NULL, 1, 100, NULL),
  (66148, 'consumable', NULL, 1, 0, NULL);
