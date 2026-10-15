import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';

test('captures TCP bytes and sends a configured binary greeting', { timeout: 10000 }, async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'fishingchamp-test-'));
  const reserve = net.createServer();
  reserve.listen(0, '127.0.0.1');
  await once(reserve, 'listening');
  const port = reserve.address().port;
  await new Promise(resolve => reserve.close(resolve));
  const config = path.join(temp, 'config.json');
  fs.writeFileSync(config, JSON.stringify({ host: '127.0.0.1', ports: [port], sessionPort: 0, databaseFile: path.join(temp, 'test.sqlite'), accountsFile: path.join(temp, 'accounts.json'), captureDirectory: temp, greetingHex: '0102ff', enableLoginReply: true, idleTimeoutMs: 1000 }));
  const root = path.dirname(fileURLToPath(import.meta.url));
  const child = spawn(process.execPath, [path.join(root, 'server.mjs'), config], { stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = once(child, 'exit');
  let socket;
  try {
    await new Promise((resolve, reject) => {
      child.stdout.on('data', b => { if (b.toString().includes('Capture server listening')) resolve(); });
      child.once('error', reject);
      child.once('exit', code => reject(new Error(`Server exited: ${code}`)));
    });
    socket = net.createConnection({ host: '127.0.0.1', port });
    const greetingPromise = once(socket, 'data');
    await once(socket, 'connect');
    assert.equal((await greetingPromise)[0].toString('hex'), '0102ff');
    const replyPromise = once(socket, 'data');
    socket.write(Buffer.from('04000f00000000000000000000000000000000', 'hex'));
    assert.equal((await replyPromise)[0].toString('hex'), '05000900010100000000000000');
    socket.end(Buffer.from('001122ff', 'hex'));
    await once(socket, 'close');
    const capture = fs.readdirSync(temp).find(n => n.endsWith('.jsonl'));
    const records = fs.readFileSync(path.join(temp, capture), 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(records.filter(r => r.direction === 'client-to-server').map(r => r.hex).join(''), '04000f00000000000000000000000000000000001122ff');
    assert.ok(records.some(r => r.event === 'close'));
  } finally {
    socket?.destroy();
    child.kill();
    await exited;
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
