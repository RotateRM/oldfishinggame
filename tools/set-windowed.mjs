import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const directory = path.join(root, 'local-client');
const target = path.join(directory, 'MRenderDX9.dll');
const backup = path.join(directory, 'MRenderDX9.original.dll');
const originalHash = '3d45bb34227358e044f0c50029bd1b49232d7936924435df883cc925a2de3ca9';
const bytes = fs.readFileSync(target);
const currentHash = crypto.createHash('sha256').update(bytes).digest('hex');
const offset = 0x4d56;
const original = Buffer.from('0f94c1', 'hex'); // sete cl
const patched = Buffer.from('b10190', 'hex'); // mov cl, 1; nop
if (bytes.subarray(offset, offset + 3).equals(patched)) {
  console.log('Windowed-mode patch is already installed.');
  process.exit(0);
}
if (currentHash !== originalHash || !bytes.subarray(offset, offset + 3).equals(original)) {
  throw new Error('MRenderDX9.dll does not match the inspected version; no changes made.');
}
if (fs.existsSync(backup)) throw new Error('Backup already exists; no changes made.');
fs.copyFileSync(target, backup, fs.constants.COPYFILE_EXCL);
patched.copy(bytes, offset);
fs.writeFileSync(target, bytes);
console.log('Patched local MRenderDX9.dll to select its windowed branch. Original saved as MRenderDX9.original.dll.');
