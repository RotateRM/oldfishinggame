import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const client = process.argv[2] || 'C:\\Program Files (x86)\\Gamescampus\\FishingChamp';
function inspect(name) {
  const b = fs.readFileSync(path.join(client, name));
  const strings = [];
  const add = (regex, text, encoding, scale) => {
    for (const match of text.matchAll(regex)) {
      if (/server|socket|connect|login|packet|notify|reply|req\b|https?:\/\/|\b\d{1,3}(?:\.\d{1,3}){3}\b|\.ini|\.pdb/i.test(match[0])) strings.push({ offset: '0x' + (match.index * scale).toString(16), encoding, text: match[0] });
    }
  };
  add(/[\x20-\x7e]{5,}/g, b.toString('latin1'), 'ascii', 1);
  add(/[\x20-\x7e]{5,}/g, b.toString('utf16le'), 'utf16le', 2);
  const result = { name, bytes: b.length, sha256: crypto.createHash('sha256').update(b).digest('hex'), strings };
  if (b.readUInt16LE(0) === 0x5a4d) {
    const pe = b.readUInt32LE(0x3c);
    if (b.readUInt32LE(pe) === 0x4550) {
      const count = b.readUInt16LE(pe + 6), optional = pe + 24;
      const size = b.readUInt16LE(pe + 20);
      result.pe = { machine: '0x' + b.readUInt16LE(pe + 4).toString(16), imageBase: '0x' + b.readUInt32LE(optional + 28).toString(16), entryPointRva: '0x' + b.readUInt32LE(optional + 16).toString(16), sections: [] };
      for (let i = 0; i < count; i++) {
        const s = optional + size + i * 40;
        result.pe.sections.push({ name: b.toString('ascii', s, s + 8).replace(/\0/g, ''), virtualAddress: b.readUInt32LE(s + 12), rawOffset: b.readUInt32LE(s + 20), rawSize: b.readUInt32LE(s + 16) });
      }
      for (const str of strings) {
        const offset = parseInt(str.offset, 16);
        const s = result.pe.sections.find(s => offset >= s.rawOffset && offset < s.rawOffset + s.rawSize);
        if (s) str.virtualAddress = '0x' + (parseInt(result.pe.imageBase, 16) + s.virtualAddress + offset - s.rawOffset).toString(16);
      }
    }
  }
  return result;
}
const report = { generatedAt: new Date().toISOString(), client, files: ['FishingChamp.exe', 'Updater.exe', 'WebManage.dll', 'DBPoll.dll'].map(inspect) };
const output = path.join(root, 'client-inspection.json');
fs.writeFileSync(output, JSON.stringify(report, null, 2));
console.log(`Wrote ${output}`);
for (const f of report.files) console.log(`${f.name}: ${f.bytes} bytes, ${f.strings.length} relevant strings, SHA-256 ${f.sha256}`);
