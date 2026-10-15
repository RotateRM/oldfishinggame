import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openGameDatabase } from '../game-database.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const config = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
const databaseFile = path.resolve(root, config.databaseFile || 'fishingchamp.sqlite');
const legacyAccountsFile = path.resolve(root, config.accountsFile || 'accounts.json');
const command = process.argv[2] || 'status';
const store = openGameDatabase(databaseFile, { legacyAccountsFile });

try {
  if (command === 'migrate') {
    console.log(`Database is current: ${databaseFile}`);
  } else if (command === 'status') {
    const migrations = store.db.prepare('SELECT version, applied_at FROM schema_migrations ORDER BY version').all();
    console.log(`Database: ${databaseFile}`);
    console.log(`Integrity: ${store.db.prepare('PRAGMA integrity_check').get().integrity_check}`);
    console.table(migrations);
  } else if (command === 'inspect') {
    const tables = store.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
    const counts = tables.map(({ name }) => ({ table: name, rows: Number(store.db.prepare(`SELECT COUNT(*) AS count FROM "${name}"`).get().count) }));
    console.table(counts);
  } else if (command === 'backup') {
    const directory = path.join(root, 'backups');
    fs.mkdirSync(directory, { recursive: true });
    const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
    const destination = path.join(directory, `fishingchamp-${stamp}.sqlite`);
    store.db.exec(`VACUUM INTO '${destination.replaceAll("'", "''")}'`);
    console.log(`Backup created: ${destination}`);
  } else {
    throw new Error('Usage: node tools/db.mjs [status|migrate|inspect|backup]');
  }
} finally {
  store.close();
}
