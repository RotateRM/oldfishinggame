import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { openGameDatabase } from './game-database.mjs';

test('persists accounts, characters, inventory, durability, and equipped slots', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fishingchamp-db-'));
  const file = path.join(directory, 'test.sqlite');
  let store = openGameDatabase(file);
  assert.deepEqual(store.db.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map(row => row.version), ['001_initial.sql', '002_gameplay_catalog.sql', '003_maps_and_channels.sql', '004_seed_worlds.sql', '005_observed_items.sql', '006_fish_catalog.sql', '007_default_aquariums.sql', '008_level_progression.sql', '009_separate_rank_experience.sql']);
  assert.equal(Number(store.db.prepare('SELECT COUNT(*) AS count FROM fish_definitions').get().count), 90);
  assert.equal(store.itemDefinition(524801).maximum_durability, 50);
  assert.deepEqual(store.enabledChannels(0).map(row => [row.name, Number(row.maximum_players)]), [['Pangaea 1', 100]]);
  assert.equal(store.enabledMaps().length, 11);
  const { account } = store.authenticate('Angler', 'testpass');
  const character = store.createCharacter(account, { id: 1, slot: 1, name: 'Fisher', appearance: 2, level: 1, grade: 1 });
  assert.deepEqual(store.setExperience(character, 799), { experience: 799, level: 1 });
  assert.deepEqual(store.addExperience(character, 1), { experience: 800, level: 2 });
  store.db.prepare('UPDATE characters SET experience = 2400 WHERE id = ?').run(character.databaseId);
  assert.equal(store.db.prepare('SELECT level FROM characters WHERE id = ?').get(character.databaseId).level, 3);
  const item = { instanceId: 123, itemId: 0x080201, quantity: 1, inventoryWhere: 2, inventorySlot: 0, modifiers: [0, 0, 0, 0], duration: 100 };
  store.addItem(character, item);
  store.moveItem(character, item, 5, 8);
  store.close();

  store = openGameDatabase(file);
  const loaded = store.authenticate('angler', 'testpass').account;
  assert.equal(loaded.characters[0].name, 'Fisher');
  assert.equal(loaded.characters[0].experienceIntoLevel, 0);
  assert.deepEqual(store.inventoryFor(loaded.characters[0]), [{ ...item, inventoryWhere: 5, inventorySlot: 8, active: 0 }]);
  store.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('atomically swaps an inventory item with an occupied equipment slot', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fishingchamp-swap-'));
  const file = path.join(directory, 'test.sqlite');
  const store = openGameDatabase(file);
  const { account } = store.authenticate('Swapper', 'testpass');
  const character = store.createCharacter(account, { id: 1, slot: 1, name: 'SwapTest', level: 1, grade: 1 });
  const equipped = { instanceId: 100, itemId: 0x080201, quantity: 1, inventoryWhere: 5, inventorySlot: 8, duration: 100 };
  const replacement = { instanceId: 101, itemId: 0x080207, quantity: 1, inventoryWhere: 2, inventorySlot: 0, duration: 100 };
  store.addItem(character, equipped);
  store.addItem(character, replacement);
  store.moveItem(character, replacement, 5, 8, equipped, 2, 0);
  const items = store.inventoryFor(character);
  assert.equal(items.find(item => item.instanceId === 101).inventoryWhere, 5);
  assert.equal(items.find(item => item.instanceId === 100).inventoryWhere, 2);
  store.close();
  fs.rmSync(directory, { recursive: true, force: true });
});
