import net from 'node:net';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PacketDecoder, loginReply, checkInReply, gameLoginReply, checkOutReply, zoneExitReply, myCharacterListNotify, characterCreateReply, characterSelectReply, zoneJoinReply, friendListReply, cashRefreshReply, updateGoldNotify, chatNotify, fishingReadyNotify, throwCorkReply, throwCorkNotify, biteFishNotify, aquaListNotify, aquaSelectReply, aquaStatusReply, fishListNotify, cashItemBuyReply, itemBuyReply, itemListNotify, inventorySizeNotify, itemMoveReply, channelListReply, zoneListReply, serverListNotify } from './protocol.mjs';
import { openGameDatabase } from './game-database.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(fs.readFileSync(process.argv[2] || path.join(root, 'config.json'), 'utf8'));
if (!Array.isArray(config.ports) || !config.ports.length || config.ports.some(p => !Number.isInteger(p) || p < 1 || p > 65535)) throw new Error('ports must contain TCP ports from 1 to 65535');
if (!/^(?:[0-9a-fA-F]{2})*$/.test(config.greetingHex || '')) throw new Error('greetingHex must contain complete hex bytes');
const greeting = Buffer.from(config.greetingHex || '', 'hex');
const captureDir = path.resolve(root, config.captureDirectory || 'captures');
fs.mkdirSync(captureDir, { recursive: true });
let sequence = 0;
const sockets = new Set();
const servers = [];
const database = openGameDatabase(path.resolve(root, config.databaseFile || 'fishingchamp.sqlite'), { legacyAccountsFile: path.resolve(root, config.accountsFile || 'accounts.json') });
const guestAccount = { username: 'guest', characters: [{ name: 'TestAngler', id: 1, slot: 1 }] };
const sessionAccounts = new Map([[1, guestAccount]]);
const spawn = { x: Number(config.spawnX ?? 64), z: Number(config.spawnZ ?? 64) };
if (!Number.isFinite(spawn.x) || !Number.isFinite(spawn.z)) throw new Error('spawnX and spawnZ must be finite numbers');
const maxCurrency = Number(config.maxCurrency ?? 0x7fffffff);
if (!Number.isInteger(maxCurrency) || maxCurrency < 0 || maxCurrency > 0x7fffffff) throw new Error('maxCurrency must be an integer from 0 through 2147483647');
const itemInventoryLocations = new Map(Object.entries(config.itemInventoryLocations || {}).map(([itemId, location]) => [Number(itemId), Number(location)]));
if ([...itemInventoryLocations].some(([itemId, location]) => !Number.isInteger(itemId) || itemId < 1 || ![1, 2, 4].includes(location))) {
  throw new Error('itemInventoryLocations must map item IDs to Cloth 1, Equip 2, or Consume 4');
}
const inventoryLocationFor = (itemId, fallback) => itemInventoryLocations.get(itemId) ?? fallback;
const clientPacketNames = new Map([[0x0c, 'CheckOutReq'], [0x40, 'ZoneJoinReq'], [0x43, 'ZoneExitReq'], [0x6a, 'MoveReq'], [0x6c, 'MoveCompleteReq'], [0x70, 'ChatReq'], [0xc9, 'FishingReadyReq'], [0x12f, 'ItemMoveReq'], [0x133, 'ItemBuyReq'], [0x235, 'FriendListReq'], [0x250, 'CashRefreshReq'], [0x252, 'CashItemBuyReq']]);
let pendingAccount = null;
let lastAuthenticatedAccount = null;
const accountServer = http.createServer((request, response) => {
  if (request.method !== 'POST' || request.url !== '/session') { response.writeHead(404).end(); return; }
  let body = '';
  request.on('data', chunk => {
    body += chunk;
    if (body.length > 4096) request.destroy();
  });
  request.on('end', () => {
    try {
      const { username, password } = JSON.parse(body);
      const { account, created } = database.authenticate(username, password);
      pendingAccount = { account, createdAt: Date.now() };
      lastAuthenticatedAccount = account;
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ username: account.username, created }));
      console.log(`Launcher authenticated ${account.username}${created ? ' (new account)' : ''}`);
    } catch (error) {
      response.writeHead(401, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: error.message }));
    }
  });
});
accountServer.on('error', error => { console.error(`Launcher port: ${error.message}`); shutdown(1); });
accountServer.listen(config.sessionPort ?? 19000, '127.0.0.1', () => console.log(`Launcher login listening on 127.0.0.1:${accountServer.address().port}`));
for (const port of [...new Set(config.ports)]) {
  const server = net.createServer(socket => {
    sockets.add(socket);
    const id = `${Date.now()}-${port}-${++sequence}`;
    const file = path.join(captureDir, `${id}.jsonl`);
    let received = 0;
    let account = guestAccount;
    let selectedCharacter = null;
    let zoneJoined = false;
    let currentPosition = { ...spawn, heading: 0 };
    const sessionItems = new Map();
    const itemKey = (location, slot) => `${location}:${slot}`;
    const nextFreeSlot = location => {
      for (let slot = 0; slot < 30; slot++) if (!sessionItems.has(itemKey(location, slot))) return slot;
      return -1;
    };
    let goldSent = false;
    const decoder = new PacketDecoder();
    const record = event => fs.appendFileSync(file, JSON.stringify({ time: new Date().toISOString(), ...event }) + '\n');
    record({ event: 'open', port, peer: socket.remoteAddress, peerPort: socket.remotePort });
    console.log(`[${id}] connected`);
    socket.setTimeout(config.idleTimeoutMs || 120000, () => socket.destroy());
    const connectionGreeting = port === (config.gamePort || 4001) ? Buffer.from('09000000', 'hex') : greeting;
    if (connectionGreeting.length) {
      record({ event: 'data', direction: 'server-to-client', hex: connectionGreeting.toString('hex'), bytes: connectionGreeting.length });
      socket.write(connectionGreeting);
    }
    socket.on('data', data => {
      received += data.length;
      if (received > (config.maxCaptureBytesPerConnection || 1048576)) {
        record({ event: 'capture-limit', received });
        socket.destroy();
        return;
      }
      record({ event: 'data', direction: 'client-to-server', hex: data.toString('hex'), bytes: data.length });
      console.log(`[${id}] received ${data.length} bytes: ${data.subarray(0, 64).toString('hex')}`);
      for (const packet of decoder.push(data)) {
        record({ event: 'packet', id: packet.id, payloadBytes: packet.payload.length, payloadHex: packet.payload.toString('hex') });
        const packetName = clientPacketNames.get(packet.id);
        console.log(`[${id}] packet ${packet.id}${packetName ? ` (${packetName})` : ''}, payload ${packet.payload.length} bytes`);
        if (packet.id === 4 && config.enableLoginReply) {
          // Captured empty LoginReq has 15 bytes. Other lengths may be valid
          // for nonempty credentials; decoding those fields is a later milestone.
          if (packet.payload.length < 15) {
            record({ event: 'invalid-login', reason: 'payload shorter than captured minimum' });
            socket.destroy();
            break;
          }
          const selected = pendingAccount && Date.now() - pendingAccount.createdAt < 120000 ? pendingAccount.account : (lastAuthenticatedAccount ?? guestAccount);
          pendingAccount = null;
          const key = selected === guestAccount ? 1 : crypto.randomInt(2, 0x7fffffff);
          sessionAccounts.set(key, selected);
          account = selected;
          const reply = loginReply(key);
          record({ event: 'data', direction: 'server-to-client', hex: reply.toString('hex'), bytes: reply.length });
          socket.write(reply);
          console.log(`[${id}] sent experimental LoginReply success`);
          if (config.enableServerList) {
            const list = serverListNotify({ port: config.gamePort || 4001 });
            record({ event: 'data', direction: 'server-to-client', hex: list.toString('hex'), bytes: list.length });
            socket.write(list);
            console.log(`[${id}] sent experimental ServerListNotify`);
          }
        } else if (packet.id === 6 && config.enableCheckInReply) {
          const reply = checkInReply();
          record({ event: 'data', direction: 'server-to-client', hex: reply.toString('hex'), bytes: reply.length });
          socket.write(reply);
          console.log(`[${id}] sent experimental CheckInReply success`);
        } else if (packet.id === 10 && port === (config.gamePort || 4001) && config.enableGameLoginReply) {
          const keyOffset = 1 + (packet.payload[0] || 0);
          const key = packet.payload.length >= keyOffset + 4 ? packet.payload.readUInt32LE(keyOffset) : 0;
          account = sessionAccounts.get(key) || guestAccount;
          const reply = gameLoginReply();
          record({ event: 'data', direction: 'server-to-client', hex: reply.toString('hex'), bytes: reply.length });
          socket.write(reply);
          console.log(`[${id}] sent experimental GSLoginReply success`);
          if (config.enableMyCharacterList) {
            const list = myCharacterListNotify({ characters: account.characters });
            record({ event: 'data', direction: 'server-to-client', hex: list.toString('hex'), bytes: list.length });
            socket.write(list);
            console.log(`[${id}] sent ${account.characters.length} characters for ${account.username}`);
            if (config.enableChannelListReply) {
              const transition = channelListReply({ maps: database.enabledMaps().map(map => ({ id: Number(map.id), name: map.name, minimumLevel: Number(map.minimum_level), maximumLevel: map.maximum_level == null ? 0xffff : Number(map.maximum_level), enabled: Number(map.enabled) })) });
              record({ event: 'data', direction: 'server-to-client', hex: transition.toString('hex'), bytes: transition.length });
              socket.write(transition);
              console.log(`[${id}] sent experimental ChannelListReply`);
            }
          }
        } else if (packet.id === 0x3e && port === (config.gamePort || 4001) && config.enableZoneListReply) {
          const requestedValue = packet.payload.length === 2 ? packet.payload.readUInt16LE(0) : 0;
          const requestedMap = requestedValue === 0xffff ? 0 : requestedValue;
          const channels = database.enabledChannels(requestedMap).map(channel => ({ id: Number(channel.channel_number - 1), name: channel.name, status: 0 }));
          const reply = zoneListReply({ channels });
          record({ event: 'data', direction: 'server-to-client', hex: reply.toString('hex'), bytes: reply.length });
          socket.write(reply);
          console.log(`[${id}] sent experimental ZoneListReply`);
        } else if (packet.id === 0x35 && port === (config.gamePort || 4001) && config.enableCharacterCreation) {
          const nameLength = packet.payload[1];
          const valid = packet.payload.length === 3 + nameLength && nameLength > 0 && nameLength <= 24;
          const name = valid ? packet.payload.subarray(2, 2 + nameLength).toString('ascii') : '';
          const characters = account.characters;
          if (!valid || !/^[A-Za-z0-9_]+$/.test(name) || characters.some(character => character.name.toLowerCase() === name.toLowerCase()) || characters.length >= 5) {
            record({ event: 'character-create-rejected', name, reason: 'invalid, duplicate, or no free slot' });
            continue;
          }
          let character = { name, id: Math.max(0, ...characters.map(c => c.id)) + 1, slot: characters.length + 1, appearance: packet.payload[0], level: 1, grade: 1 };
          if (account !== guestAccount) character = database.createCharacter(account, character);
          else characters.push(character);
          const reply = characterCreateReply({ ...character, appearance: packet.payload[0] });
          record({ event: 'data', direction: 'server-to-client', hex: reply.toString('hex'), bytes: reply.length });
          socket.write(reply);
          console.log(`[${id}] created experimental character ${name}`);
        } else if (packet.id === 0x3a && port === (config.gamePort || 4001) && config.enableCharacterSelectReply) {
          const length = packet.payload[0];
          const name = length && packet.payload.length === 1 + length ? packet.payload.subarray(1).toString('ascii') : '';
          const character = account.characters.find(character => character.name === name);
          if (!character) { record({ event: 'character-select-rejected', name }); continue; }
          if (selectedCharacter?.name === name) { record({ event: 'character-select-duplicate', name }); continue; }
          selectedCharacter = character;
          const replies = [characterSelectReply(name)];
          if (config.sendZoneJoinAfterCharacterSelect) {
            replies.push(zoneJoinReply({ characterId: character.id, x: spawn.x, z: spawn.z, slot: character.slot }));
            zoneJoined = true;
          }
          const reply = Buffer.concat(replies);
          record({ event: 'data', direction: 'server-to-client', hex: reply.toString('hex'), bytes: reply.length });
          socket.write(reply);
          console.log(`[${id}] sent experimental CharSelectReply${zoneJoined ? ' and ZoneJoinReply' : ''} for ${name}`);
        } else if (packet.id === 0x40 && port === (config.gamePort || 4001) && config.enableZoneJoinReply) {
          const zone = packet.payload.length === 4 ? packet.payload.readUInt32LE(0) : -1;
          if (zone !== 0 || !selectedCharacter) { record({ event: 'zone-join-rejected', zone, reason: 'unknown zone or character' }); continue; }
          if (zoneJoined) {
            record({ event: 'zone-join-duplicate', zone });
            const capacity = inventorySizeNotify();
            const items = account === guestAccount ? [] : database.inventoryFor(selectedCharacter);
            sessionItems.clear();
            for (const item of items) sessionItems.set(itemKey(item.inventoryWhere, item.inventorySlot), item);
            const inventory = itemListNotify({ items });
            const aquarium = account === guestAccount ? null : database.aquariumFor(selectedCharacter);
            const aquariumState = aquaListNotify({ aquariums: aquarium ? [{ id: Number(aquarium.id), characterId: selectedCharacter.id, level: Number(aquarium.level), name: aquarium.name }] : [] });
            const fishState = fishListNotify();
            record({ event: 'data', direction: 'server-to-client', hex: capacity.toString('hex'), bytes: capacity.length, purpose: 'inventory-capacities' });
            record({ event: 'data', direction: 'server-to-client', hex: inventory.toString('hex'), bytes: inventory.length, purpose: 'persistent-inventory' });
            record({ event: 'data', direction: 'server-to-client', hex: aquariumState.toString('hex'), bytes: aquariumState.length, purpose: 'aquarium-list-initialization' });
            record({ event: 'data', direction: 'server-to-client', hex: fishState.toString('hex'), bytes: fishState.length, purpose: 'fish-list-initialization' });
            socket.write(Buffer.concat([capacity, inventory, aquariumState, fishState]));
            console.log(`[${id}] loaded ${items.length} persistent inventory item(s)`);
            continue;
          }
          zoneJoined = true;
          const reply = zoneJoinReply({ characterId: selectedCharacter.id, x: spawn.x, z: spawn.z, slot: selectedCharacter.slot });
          record({ event: 'data', direction: 'server-to-client', hex: reply.toString('hex'), bytes: reply.length });
          socket.write(reply);
          console.log(`[${id}] sent experimental ZoneJoinReply for ${selectedCharacter.name}`);
        } else if (packet.id === 0x235 && port === (config.gamePort || 4001)) {
          const replies = [friendListReply()];
          let sentGoldNow = false;
          if (selectedCharacter && !goldSent) {
            replies.push(updateGoldNotify({ gold: maxCurrency, ping: maxCurrency }));
            goldSent = true;
            sentGoldNow = true;
          }
          const reply = Buffer.concat(replies);
          record({ event: 'data', direction: 'server-to-client', hex: reply.toString('hex'), bytes: reply.length });
          socket.write(reply);
          console.log(`[${id}] sent empty FriendListReply${sentGoldNow ? ' and maximum UpdateGoldNotify' : ''}`);
        } else if (packet.id === 0x250 && port === (config.gamePort || 4001)) {
          const reply = cashRefreshReply({ cash: maxCurrency });
          record({ event: 'data', direction: 'server-to-client', hex: reply.toString('hex'), bytes: reply.length });
          socket.write(reply);
          console.log(`[${id}] sent CashRefreshReply`);
        } else if (packet.id === 0x70 && port === (config.gamePort || 4001) && selectedCharacter) {
          const length = packet.payload[0];
          const valid = length > 0 && packet.payload.length === length + 2;
          const message = valid ? packet.payload.subarray(1, 1 + length).toString('ascii') : '';
          const type = valid ? packet.payload[1 + length] : 3;
          if (!valid) { record({ event: 'chat-rejected', reason: 'invalid payload' }); continue; }
          const reply = chatNotify({ characterId: selectedCharacter.id, sender: selectedCharacter.name, message, type });
          record({ event: 'data', direction: 'server-to-client', hex: reply.toString('hex'), bytes: reply.length });
          socket.write(reply);
          console.log(`[${id}] echoed chat from ${selectedCharacter.name}: ${message}`);
        } else if (packet.id === 0x6c && port === (config.gamePort || 4001) && selectedCharacter) {
          if (packet.payload.length >= 8) {
            const x = packet.payload.readFloatLE(0);
            const z = packet.payload.readFloatLE(4);
            const heading = packet.payload.length >= 12 ? packet.payload.readFloatLE(8) : currentPosition.heading;
            if (Number.isFinite(x) && Number.isFinite(z) && Number.isFinite(heading)) currentPosition = { x, z, heading };
          }
        } else if (packet.id === 0xc9 && port === (config.gamePort || 4001) && selectedCharacter) {
          if (packet.payload.length !== 1) { record({ event: 'fishing-ready-rejected', reason: 'invalid payload' }); continue; }
          const fishingPoint = packet.payload[0];
          // Selecting a chair only enters ready/aiming mode. The original flow
          // then waits for the client to send D1 after the user clicks the water.
          const castActorId = 1;
          const reply = fishingReadyNotify({ fishingPoint: castActorId });
          record({ event: 'data', direction: 'server-to-client', hex: reply.toString('hex'), bytes: reply.length, purpose: 'fishing-ready-await-target', fishingPoint, castActorId });
          socket.write(reply);
          console.log(`[${id}] readied fishing point ${fishingPoint} for ${selectedCharacter.name}; awaiting water target`);
        } else if (packet.id === 0xd1 && port === (config.gamePort || 4001) && selectedCharacter) {
          // ThrowCorkReq is exactly three floats (x, y, z). Letting the client
          // originate it ensures its local targeting/animation state exists.
          if (packet.payload.length !== 12) { record({ event: 'throw-cork-rejected', reason: 'invalid payload', payloadHex: packet.payload.toString('hex') }); continue; }
          const x = packet.payload.readFloatLE(0);
          const y = packet.payload.readFloatLE(4);
          const z = packet.payload.readFloatLE(8);
          if (![x, y, z].every(Number.isFinite)) { record({ event: 'throw-cork-rejected', reason: 'non-finite coordinates' }); continue; }
          const reply = Buffer.concat([
            throwCorkReply(),
            throwCorkNotify({ characterId: 1, x, z }),
          ]);
          record({ event: 'data', direction: 'server-to-client', hex: reply.toString('hex'), bytes: reply.length, purpose: 'client-targeted-cast', characterId: selectedCharacter.id, target: { x, y, z } });
          socket.write(reply);
          console.log(`[${id}] accepted cast target (${x}, ${y}, ${z}) from ${selectedCharacter.name}`);
        } else if (packet.id === 0xd8 && port === (config.gamePort || 4001) && selectedCharacter) {
          // A fighting motion references combat state that does not exist until
          // BiteFishNotify has created a fish. Echoing it before then crashes the
          // client while copying a null fish-state structure.
          record({ event: 'fighting-motion-deferred', payloadHex: packet.payload.toString('hex'), reason: 'fish state not initialized' });
        } else if (packet.id === 0x162 && port === (config.gamePort || 4001) && selectedCharacter) {
          const requestedAquariumId = packet.payload.length === 4 ? packet.payload.readUInt32LE(0) : 0;
          const aquarium = account === guestAccount ? null : database.aquariumFor(selectedCharacter);
          const valid = aquarium && Number(aquarium.id) === requestedAquariumId;
          const reply = aquaSelectReply({ success: Boolean(valid), aquariumId: requestedAquariumId, characterId: selectedCharacter.id });
          record({ event: 'data', direction: 'server-to-client', hex: reply.toString('hex'), bytes: reply.length, purpose: 'aquarium-select', aquariumId: requestedAquariumId, success: Boolean(valid) });
          socket.write(reply);
        } else if (packet.id === 0x166 && port === (config.gamePort || 4001) && selectedCharacter) {
          const reply = aquaStatusReply({ success: false });
          record({ event: 'data', direction: 'server-to-client', hex: reply.toString('hex'), bytes: reply.length, purpose: 'aquarium-status-placeholder' });
          socket.write(reply);
        } else if (packet.id === 0x0c && port === (config.gamePort || 4001)) {
          const reply = checkOutReply();
          record({ event: 'data', direction: 'server-to-client', hex: reply.toString('hex'), bytes: reply.length });
          socket.write(reply);
          console.log(`[${id}] accepted checkout to map selection`);
        } else if (packet.id === 0x43 && port === (config.gamePort || 4001)) {
          const reply = zoneExitReply();
          selectedCharacter = null;
          zoneJoined = false;
          record({ event: 'data', direction: 'server-to-client', hex: reply.toString('hex'), bytes: reply.length });
          socket.write(reply);
          console.log(`[${id}] accepted zone exit to character selection`);
        } else if (packet.id === 0x252 && port === (config.gamePort || 4001) && selectedCharacter) {
          if (packet.payload.length !== 5) { record({ event: 'cash-buy-rejected', reason: 'invalid payload' }); continue; }
          const itemId = packet.payload.readUInt32LE(0);
          const definition = database.itemDefinition(itemId);
          const definitionLocation = definition?.category === 'equipment' ? 2 : definition?.category === 'consumable' ? 4 : definition?.category === 'clothing' ? 1 : null;
          const inventoryWhere = definitionLocation ?? inventoryLocationFor(itemId, 1);
          const inventorySlot = nextFreeSlot(inventoryWhere);
          if (inventorySlot < 0) { record({ event: 'cash-buy-rejected', reason: 'inventory full', inventoryWhere }); continue; }
          const item = { itemId, instanceId: crypto.randomInt(1, 0x7fffffff), quantity: 1, inventorySlot, inventoryWhere, modifiers: [0, 0, 0, 0], duration: definition?.maximum_durability ?? (inventoryWhere === 4 ? 0 : 100) };
          sessionItems.set(itemKey(inventoryWhere, item.inventorySlot), item);
          if (account !== guestAccount) database.addItem(selectedCharacter, item);
          const reply = cashItemBuyReply(item);
          record({ event: 'data', direction: 'server-to-client', hex: reply.toString('hex'), bytes: reply.length });
          socket.write(reply);
          console.log(`[${id}] granted experimental cash item ${itemId} to inventory ${inventoryWhere}`);
        } else if (packet.id === 0x133 && port === (config.gamePort || 4001) && selectedCharacter) {
          if (packet.payload.length < 6) { record({ event: 'item-buy-rejected', reason: 'invalid payload' }); continue; }
          const itemId = packet.payload.readUInt32LE(0);
          const quantity = packet.payload[4] || 1;
          const definition = database.itemDefinition(itemId);
          const definitionLocation = definition?.category === 'equipment' ? 2 : definition?.category === 'consumable' ? 4 : definition?.category === 'clothing' ? 1 : null;
          const inventoryWhere = definitionLocation ?? inventoryLocationFor(itemId, 2);
          const inventorySlot = nextFreeSlot(inventoryWhere);
          if (inventorySlot < 0) { record({ event: 'item-buy-rejected', reason: 'inventory full', inventoryWhere }); continue; }
          const item = { itemId, instanceId: crypto.randomInt(1, 0x7fffffff), quantity, inventorySlot, inventoryWhere, modifiers: [0, 0, 0, 0], duration: definition?.maximum_durability ?? (inventoryWhere === 4 ? 0 : 100) };
          sessionItems.set(itemKey(inventoryWhere, item.inventorySlot), item);
          if (account !== guestAccount) database.addItem(selectedCharacter, item);
          const reply = itemBuyReply(item);
          record({ event: 'data', direction: 'server-to-client', hex: reply.toString('hex'), bytes: reply.length });
          socket.write(reply);
          console.log(`[${id}] granted experimental shop item ${itemId} x${quantity} to inventory ${inventoryWhere}`);
        } else if (packet.id === 0x12f && port === (config.gamePort || 4001) && selectedCharacter) {
          if (packet.payload.length !== 4) { record({ event: 'item-move-rejected', reason: 'invalid payload' }); continue; }
          const [destinationLocation, destinationSlot, sourceLocation, sourceSlot] = packet.payload;
          const sourceKey = itemKey(sourceLocation, sourceSlot);
          const item = sessionItems.get(sourceKey);
          if (!item) {
            record({ event: 'item-move-rejected', reason: 'unknown source', destinationLocation, destinationSlot, sourceLocation, sourceSlot });
            socket.write(itemMoveReply({ destinationLocation, destinationSlot, item: {}, sourceLocation, sourceSlot, status: 0 }));
            continue;
          }
          const destinationKey = itemKey(destinationLocation, destinationSlot);
          const displacedItem = sessionItems.get(destinationKey) ?? null;
          try {
            if (account !== guestAccount) database.moveItem(selectedCharacter, item, destinationLocation, destinationSlot, displacedItem, sourceLocation, sourceSlot);
          } catch (error) {
            record({ event: 'item-move-rejected', reason: 'database error', message: error.message, destinationLocation, destinationSlot, sourceLocation, sourceSlot });
            const failed = itemMoveReply({ destinationLocation, destinationSlot, item: {}, sourceLocation, sourceSlot, status: 0 });
            socket.write(failed);
            continue;
          }
          sessionItems.delete(sourceKey);
          sessionItems.delete(destinationKey);
          item.inventoryWhere = destinationLocation;
          item.inventorySlot = destinationSlot;
          sessionItems.set(destinationKey, item);
          if (displacedItem) {
            displacedItem.inventoryWhere = sourceLocation;
            displacedItem.inventorySlot = sourceSlot;
            sessionItems.set(sourceKey, displacedItem);
          }
          const reply = itemMoveReply({ destinationLocation, destinationSlot, item, sourceLocation, sourceSlot, displacedItem });
          record({ event: 'data', direction: 'server-to-client', hex: reply.toString('hex'), bytes: reply.length, purpose: 'item-move' });
          socket.write(reply);
          console.log(`[${id}] moved item ${item.itemId} from ${sourceLocation}:${sourceSlot} to ${destinationLocation}:${destinationSlot}${displacedItem ? ` and swapped item ${displacedItem.itemId} back` : ''}`);
        }
      }
    });
    socket.on('error', error => record({ event: 'error', message: error.message }));
    socket.on('close', () => { sockets.delete(socket); record({ event: 'close', received }); });
  });
  servers.push(server);
  server.on('error', error => { console.error(`Port ${port}: ${error.message}`); shutdown(1); });
  server.listen(port, config.host || '127.0.0.1', () => console.log(`Capture server listening on ${config.host || '127.0.0.1'}:${port}`));
}
let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const socket of sockets) socket.destroy();
  for (const server of servers) server.close();
  accountServer.close();
  database.close();
  process.exitCode = code;
}
process.on('SIGINT', () => shutdown());
process.on('SIGTERM', () => shutdown());
