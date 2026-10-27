CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL,
  username_normalized TEXT NOT NULL UNIQUE,
  salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS characters (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  game_id INTEGER NOT NULL,
  slot INTEGER NOT NULL,
  name TEXT NOT NULL,
  appearance INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 1,
  grade INTEGER NOT NULL DEFAULT 1,
  gold INTEGER NOT NULL DEFAULT 2147483647,
  cash INTEGER NOT NULL DEFAULT 2147483647,
  ping INTEGER NOT NULL DEFAULT 2147483647,
  UNIQUE(account_id, game_id),
  UNIQUE(account_id, slot),
  UNIQUE(account_id, name)
);

CREATE TABLE IF NOT EXISTS inventory_items (
  instance_id INTEGER PRIMARY KEY,
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  location INTEGER NOT NULL,
  slot INTEGER NOT NULL,
  modifier_1 INTEGER NOT NULL DEFAULT 0,
  modifier_2 INTEGER NOT NULL DEFAULT 0,
  modifier_3 INTEGER NOT NULL DEFAULT 0,
  modifier_4 INTEGER NOT NULL DEFAULT 0,
  duration INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 0,
  UNIQUE(character_id, location, slot)
);

CREATE INDEX IF NOT EXISTS idx_characters_account ON characters(account_id);
CREATE INDEX IF NOT EXISTS idx_inventory_character ON inventory_items(character_id);
CREATE INDEX IF NOT EXISTS idx_inventory_item ON inventory_items(item_id);
