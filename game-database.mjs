import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const iterations = 210_000;
const defaultMigrationsDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

export function applyMigrations(db, migrationsDirectory = defaultMigrationsDirectory) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  const applied = new Set(db.prepare('SELECT version FROM schema_migrations').all().map(row => row.version));
  const files = fs.readdirSync(migrationsDirectory).filter(name => /^\d+.*\.sql$/.test(name)).sort();
  const appliedNow = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDirectory, file), 'utf8');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(file);
      db.exec('COMMIT');
      appliedNow.push(file);
    } catch (error) {
      db.exec('ROLLBACK');
      throw new Error(`Migration ${file} failed: ${error.message}`, { cause: error });
    }
  }
  return appliedNow;
}

export function openGameDatabase(file, { legacyAccountsFile } = {}) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  applyMigrations(db);
  const characterRows = db.prepare(`
    SELECT c.*,
      MAX(0, c.experience - COALESCE((
        SELECT required_experience FROM level_thresholds WHERE level = c.level
      ), 0)) AS experience_into_level
    FROM characters c
    WHERE c.account_id = ?
    ORDER BY c.slot
  `);
  const accountByName = db.prepare('SELECT * FROM accounts WHERE username_normalized = ?');
  const insertAccount = db.prepare('INSERT INTO accounts (username, username_normalized, salt, password_hash) VALUES (?, ?, ?, ?)');
  const insertCharacter = db.prepare('INSERT INTO characters (account_id, game_id, slot, name, appearance, level, grade, equipment_capacity, strength, luck, focus_power, focus_rate, hitpoints) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const insertAquarium = db.prepare("INSERT OR IGNORE INTO aquariums (character_id, name) VALUES (?, ? || '''s Aquarium')");
  const insertItem = db.prepare('INSERT INTO inventory_items (instance_id, character_id, item_id, quantity, location, slot, modifier_1, modifier_2, modifier_3, modifier_4, duration, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const toCharacter = row => ({ databaseId: Number(row.id), id: Number(row.game_id), slot: Number(row.slot), name: row.name, appearance: Number(row.appearance), level: Number(row.level), experience: Number(row.experience), experienceIntoLevel: Number(row.experience_into_level), grade: Number(row.grade), rankExperience: Number(row.rank_experience), gold: Number(row.gold), cash: Number(row.cash), ping: Number(row.ping), equipmentCapacity: Number(row.equipment_capacity), strength: Number(row.strength), luck: Number(row.luck), focusPower: Number(row.focus_power), focusRate: Number(row.focus_rate), hitPoints: Number(row.hitpoints) });
  const toAccount = row => ({ databaseId: Number(row.id), username: row.username, characters: characterRows.all(row.id).map(toCharacter) });

  const accountCount = Number(db.prepare('SELECT COUNT(*) AS count FROM accounts').get().count);
  if (accountCount === 0 && legacyAccountsFile && fs.existsSync(legacyAccountsFile)) {
    const legacy = JSON.parse(fs.readFileSync(legacyAccountsFile, 'utf8'));
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const [normalized, old] of Object.entries(legacy.users || {})) {
        const accountId = Number(insertAccount.run(old.username, normalized, old.salt, old.passwordHash).lastInsertRowid);
        for (const character of old.characters || []) insertCharacter.run(accountId, character.id, character.slot, character.name, character.appearance ?? 0, character.level ?? 1, character.grade ?? 1, character.equipmentCapacity ?? 100, character.strength ?? 100, character.luck ?? 100, character.focusPower ?? 100, character.focusRate ?? 100, character.hitPoints ?? 100);
      }
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }

  const authenticate = (username, password) => {
    if (typeof username !== 'string' || !/^[A-Za-z0-9_]{3,24}$/.test(username) || typeof password !== 'string' || password.length < 4 || password.length > 128) throw new Error('Use a 3–24 character account name and a password of at least 4 characters');
    const normalized = username.toLowerCase();
    let row = accountByName.get(normalized);
    let created = false;
    if (!row) {
      const salt = crypto.randomBytes(16).toString('hex');
      const passwordHash = crypto.pbkdf2Sync(password, Buffer.from(salt, 'hex'), iterations, 32, 'sha256').toString('hex');
      insertAccount.run(username, normalized, salt, passwordHash);
      row = accountByName.get(normalized);
      created = true;
    } else {
      const actual = crypto.pbkdf2Sync(password, Buffer.from(row.salt, 'hex'), iterations, 32, 'sha256');
      const expected = Buffer.from(row.password_hash, 'hex');
      if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) throw new Error('Incorrect password');
    }
    return { account: toAccount(row), created };
  };
  const createCharacter = (account, character) => {
    const result = insertCharacter.run(account.databaseId, character.id, character.slot, character.name, character.appearance ?? 0, character.level ?? 1, character.grade ?? 1, character.equipmentCapacity ?? 100, character.strength ?? 100, character.luck ?? 100, character.focusPower ?? 100, character.focusRate ?? 100, character.hitPoints ?? 100);
    const stored = { ...character, databaseId: Number(result.lastInsertRowid) };
    insertAquarium.run(stored.databaseId, stored.name);
    account.characters.push(stored);
    return stored;
  };
  const nextCharacterSlot = account => {
    const occupied = new Set(account.characters.map(character => Number(character.slot)));
    for (let slot = 1; slot <= 5; slot += 1) {
      if (!occupied.has(slot)) return slot;
    }
    return null;
  };
  const deleteCharacter = (account, character) => {
    const result = db.prepare('DELETE FROM characters WHERE id = ? AND account_id = ?').run(character.databaseId, account.databaseId);
    if (Number(result.changes) !== 1) return false;
    const index = account.characters.findIndex(candidate => candidate.databaseId === character.databaseId);
    if (index >= 0) account.characters.splice(index, 1);
    return true;
  };
  const inventoryFor = character => db.prepare('SELECT * FROM inventory_items WHERE character_id = ? ORDER BY location, slot').all(character.databaseId).map(row => ({ instanceId: Number(row.instance_id), itemId: Number(row.item_id), quantity: Number(row.quantity), inventoryWhere: Number(row.location), inventorySlot: Number(row.slot), modifiers: [Number(row.modifier_1), Number(row.modifier_2), Number(row.modifier_3), Number(row.modifier_4)], duration: Number(row.duration), active: Number(row.active) }));
  const addItem = (character, item) => insertItem.run(item.instanceId, character.databaseId, item.itemId, item.quantity ?? 1, item.inventoryWhere, item.inventorySlot, ...(item.modifiers ?? [0, 0, 0, 0]), item.duration ?? 0, item.active ?? 0);
  const moveItem = (character, item, location, slot, displacedItem = null, sourceLocation = null, sourceSlot = null) => {
    db.exec('BEGIN IMMEDIATE');
    try {
      if (displacedItem) {
        db.prepare('UPDATE inventory_items SET location = -1, slot = ?, active = 0 WHERE character_id = ? AND instance_id = ?').run(-displacedItem.instanceId, character.databaseId, displacedItem.instanceId);
      }
      db.prepare('UPDATE inventory_items SET location = ?, slot = ?, active = ? WHERE character_id = ? AND instance_id = ?').run(location, slot, location === 5 ? 1 : 0, character.databaseId, item.instanceId);
      if (displacedItem) {
        db.prepare('UPDATE inventory_items SET location = ?, slot = ?, active = ? WHERE character_id = ? AND instance_id = ?').run(sourceLocation, sourceSlot, sourceLocation === 5 ? 1 : 0, character.databaseId, displacedItem.instanceId);
      }
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  const enabledMaps = () => db.prepare('SELECT * FROM maps WHERE enabled = 1 ORDER BY id').all();
  const enabledChannels = mapId => db.prepare('SELECT * FROM channels WHERE map_id = ? AND enabled = 1 ORDER BY channel_number').all(mapId);
  const fishFor = ({ mapId, fishingPoint = null, level = 1, random = Math.random }) => {
    const candidates = db.prepare(`
      SELECT fd.*, mf.weight, mf.fishing_point
      FROM map_fish mf
      JOIN fish_definitions fd ON fd.fish_id = mf.fish_id
      WHERE mf.map_id = ? AND fd.enabled = 1
        AND COALESCE(mf.minimum_level, fd.minimum_level, 1) <= ?
        AND (mf.fishing_point IS NULL OR mf.fishing_point = ?)
      ORDER BY CASE WHEN mf.fishing_point = ? THEN 0 ELSE 1 END, fd.fish_id
    `).all(mapId, level, fishingPoint, fishingPoint);
    if (!candidates.length) return null;
    const specific = candidates.filter(candidate => candidate.fishing_point != null);
    const pool = specific.length ? specific : candidates;
    const totalWeight = pool.reduce((sum, candidate) => sum + Number(candidate.weight), 0);
    let target = Math.min(0.999999999999, Math.max(0, Number(random()))) * totalWeight;
    for (const candidate of pool) {
      target -= Number(candidate.weight);
      if (target < 0) return candidate;
    }
    return pool.at(-1);
  };
  const itemDefinition = itemId => db.prepare('SELECT * FROM item_definitions WHERE item_id = ? AND enabled = 1').get(itemId) ?? null;
  const aquariumFor = character => db.prepare('SELECT * FROM aquariums WHERE character_id = ?').get(character.databaseId) ?? null;
  const setExperience = (character, experience) => {
    const normalized = Math.max(0, Math.trunc(Number(experience)));
    if (!Number.isSafeInteger(normalized)) throw new Error('Experience must be a safe integer');
    db.prepare('UPDATE characters SET experience = ? WHERE id = ?').run(normalized, character.databaseId);
    const row = db.prepare('SELECT experience, level FROM characters WHERE id = ?').get(character.databaseId);
    character.experience = Number(row.experience);
    character.level = Number(row.level);
    return { experience: character.experience, level: character.level };
  };
  const addExperience = (character, amount) => setExperience(character, (character.experience ?? 0) + Math.trunc(Number(amount)));
  return { db, authenticate, createCharacter, nextCharacterSlot, deleteCharacter, inventoryFor, addItem, moveItem, enabledMaps, enabledChannels, fishFor, itemDefinition, aquariumFor, setExperience, addExperience, close: () => db.close() };
}
