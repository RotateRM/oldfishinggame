import crypto from 'node:crypto';
import fs from 'node:fs';

const iterations = 210_000;

export function openAccounts(file) {
  const data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { version: 1, users: {} };
  if (data.version !== 1 || !data.users || typeof data.users !== 'object') throw new Error('Unsupported account file');
  const save = () => fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  const authenticate = (username, password) => {
    if (typeof username !== 'string' || !/^[A-Za-z0-9_]{3,24}$/.test(username) || typeof password !== 'string' || password.length < 4 || password.length > 128) {
      throw new Error('Use a 3–24 character account name and a password of at least 4 characters');
    }
    const name = username.toLowerCase();
    let account = data.users[name];
    if (!account) {
      const salt = crypto.randomBytes(16).toString('hex');
      account = { username, salt, passwordHash: crypto.pbkdf2Sync(password, Buffer.from(salt, 'hex'), iterations, 32, 'sha256').toString('hex'), characters: [] };
      data.users[name] = account;
      save();
      return { account, created: true };
    }
    const actual = crypto.pbkdf2Sync(password, Buffer.from(account.salt, 'hex'), iterations, 32, 'sha256');
    const expected = Buffer.from(account.passwordHash, 'hex');
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) throw new Error('Incorrect password');
    return { account, created: false };
  };
  return { data, save, authenticate };
}
