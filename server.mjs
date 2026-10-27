import net from 'node:net';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PacketDecoder, loginReply, checkInReply, gameLoginReply, checkOutReply, zoneExitReply, characterHitPointsNotify, updateAbilityNotify, myCharacterListNotify, characterCreateReply, characterDeleteReply, characterSelectReply, zoneJoinReply, friendListReply, cashRefreshReply, updateGoldNotify, gameTimeNotify, takeChairReply, takeChairNotify, riseChairNotify, chatNotify, fishingReadyNotify, throwCorkReply, throwCorkNotify, biteFishNotify, strikeFishReply, fightingFinishReply, aquaListNotify, aquaSelectReply, aquaStatusReply, fishListNotify, cashItemBuyReply, itemBuyReply, itemListNotify, inventorySizeNotify, itemMoveReply, channelListReply, zoneListReply, serverListNotify } from './protocol.mjs';
import { openGameDatabase } from './game-database.mjs';
import { baseStatsForAppearance, fightProfileFor } from './gameplay-rules.mjs';

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
const originalBaseStats = baseStatsForAppearance;
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
const clientPacketNames = new Map([[0x0c, 'CheckOutReq'], [0x40, 'ZoneJoinReq'], [0x43, 'ZoneExitReq'], [0x6a, 'MoveReq'], [0x6c, 'MoveCompleteReq'], [0x70, 'ChatReq'], [0xc9, 'TakeChairReq'], [0xcc, 'RiseChairReq'], [0xce, 'FishingReadyReq'], [0xd1, 'ThrowCorkReq'], [0xd9, 'FightingFinishReq'], [0x12f, 'ItemMoveReq'], [0x133, 'ItemBuyReq'], [0x235, 'FriendListReq'], [0x250, 'CashRefreshReq'], [0x252, 'CashItemBuyReq']]);
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
    let occupiedChairId = null;
    let lastChairId = null;
    let biteTimer = null;
    let inventoryRefreshTimer = null;
    let inventoryRefreshedInWorld = false;
    let postEntryEquipmentTimer = null;
    let equipmentReplayedAfterMoveComplete = false;
    let fishStateReady = false;
    let activeFishId = null;
    let fishingReadySent = false;
    let clockTimer = null;
    const decoder = new PacketDecoder();
    const record = event => fs.appendFileSync(file, JSON.stringify({ time: new Date().toISOString(), ...event }) + '\n');
    const buildEquipmentReplay = items => {
      const occupiedInventorySlots = new Set(items
        .filter(item => item.inventoryWhere !== 5)
        .map(item => itemKey(item.inventoryWhere, item.inventorySlot)));
      const packets = [];
      const slots = [];
      for (const item of items.filter(item => item.inventoryWhere === 5 && item.active)) {
        const definition = database.itemDefinition(item.itemId);
        const sourceLocation = definition?.category === 'clothing' ? 1 : definition?.category === 'consumable' ? 4 : 2;
        let sourceSlot = 29;
        while (sourceSlot >= 0 && occupiedInventorySlots.has(itemKey(sourceLocation, sourceSlot))) sourceSlot--;
        if (sourceSlot < 0) continue;
        occupiedInventorySlots.add(itemKey(sourceLocation, sourceSlot));
        packets.push(itemMoveReply({ destinationLocation: 5, destinationSlot: item.inventorySlot, item, sourceLocation, sourceSlot }));
        slots.push(item.inventorySlot);
      }
      return { packets, slots };
    };
    const replayStoredEquipment = purpose => {
      if (socket.destroyed || !selectedCharacter || account === guestAccount) return;
      const items = database.inventoryFor(selectedCharacter);
      const { packets, slots } = buildEquipmentReplay(items);
      if (packets.length) socket.write(Buffer.concat(packets));
      record({ event: 'equipment-replay', purpose, count: packets.length, slots });
    };
    const sendGameTime = () => {
      if (!zoneJoined || socket.destroyed) return;
      const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
        timeZone: config.gameTimeZone || 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
      }).formatToParts(new Date()).filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
      const reply = gameTimeNotify({ hour: parts.hour, minute: parts.minute });
      record({ event: 'data', direction: 'server-to-client', hex: reply.toString('hex'), bytes: reply.length, purpose: 'game-time', hour: parts.hour, minute: parts.minute });
      socket.write(reply);
    };
    const startGameClock = () => {
      sendGameTime();
      if (!clockTimer) {
        clockTimer = setInterval(sendGameTime, 30_000);
        clockTimer.unref();
      }
    };
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
            for (const character of account.characters) {
              const abilities = updateAbilityNotify({
                slot: character.slot,
                equipmentCapacity: character.equipmentCapacity ?? 100,
                strength: character.strength ?? 100,
                luck: character.luck ?? 100,
                focusPower: character.focusPower ?? 100,
                focusRate: character.focusRate ?? 100,
                currentHitPoints: character.hitPoints ?? 1000,
                maximumHitPoints: character.hitPoints ?? 1000,
              });
              record({ event: 'data', direction: 'server-to-client', hex: abilities.toString('hex'), bytes: abilities.length, purpose: 'character-abilities', characterId: character.id, slot: character.slot });
              socket.write(abilities);
            }
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
          const appearance = packet.payload[0];
          const slot = account === guestAccount
            ? [1, 2, 3, 4, 5].find(candidate => !characters.some(character => Number(character.slot) === candidate))
            : database.nextCharacterSlot(account);
          if (slot == null) {
            record({ event: 'character-create-rejected', name, reason: 'no free slot' });
            continue;
          }
          let character = { name, id: Math.max(0, ...characters.map(c => c.id)) + 1, slot, appearance, level: 1, grade: 1, equipmentCapacity: 100, ...originalBaseStats(appearance), hitPoints: 100 };
          if (account !== guestAccount) character = database.createCharacter(account, character);
          else characters.push(character);
          const created = characterCreateReply({ ...character, appearance: packet.payload[0] });
          const abilities = updateAbilityNotify({
            slot: character.slot,
            equipmentCapacity: character.equipmentCapacity ?? 100,
            strength: character.strength ?? 100,
            luck: character.luck ?? 100,
            focusPower: character.focusPower ?? 100,
            focusRate: character.focusRate ?? 100,
            currentHitPoints: character.hitPoints ?? 100,
            maximumHitPoints: character.hitPoints ?? 100,
          });
          const reply = Buffer.concat([created, abilities]);
          record({ event: 'data', direction: 'server-to-client', hex: reply.toString('hex'), bytes: reply.length, purpose: 'character-created-with-abilities', characterId: character.id, slot: character.slot });
          socket.write(reply);
          console.log(`[${id}] created experimental character ${name}`);
        } else if (packet.id === 0x38 && port === (config.gamePort || 4001)) {
          const nameLength = packet.payload[0];
          const name = nameLength && packet.payload.length === nameLength + 1 ? packet.payload.subarray(1).toString('ascii') : '';
          const character = account.characters.find(candidate => candidate.name === name);
          const deleted = Boolean(character) && (account === guestAccount
            ? account.characters.splice(account.characters.indexOf(character), 1).length === 1
            : database.deleteCharacter(account, character));
          const reply = characterDeleteReply({ status: deleted ? 1 : 0, name });
          record({ event: 'data', direction: 'server-to-client', hex: reply.toString('hex'), bytes: reply.length, purpose: 'character-delete', name, deleted });
          socket.write(reply);
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
            replies.push(characterHitPointsNotify({ characterId: character.id, currentHitPoints: character.hitPoints ?? 1000, maximumHitPoints: character.hitPoints ?? 1000 }));
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
            if (postEntryEquipmentTimer) clearTimeout(postEntryEquipmentTimer);
            postEntryEquipmentTimer = setTimeout(() => {
              postEntryEquipmentTimer = null;
              replayStoredEquipment('post-zone-entry');
            }, 2500);
            postEntryEquipmentTimer.unref();
            startGameClock();
            console.log(`[${id}] loaded ${items.length} persistent inventory item(s)`);
            continue;
          }
          zoneJoined = true;
          const reply = Buffer.concat([
            zoneJoinReply({ characterId: selectedCharacter.id, x: spawn.x, z: spawn.z, slot: selectedCharacter.slot }),
            characterHitPointsNotify({ characterId: selectedCharacter.id, currentHitPoints: selectedCharacter.hitPoints ?? 1000, maximumHitPoints: selectedCharacter.hitPoints ?? 1000 }),
          ]);
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
          if (!equipmentReplayedAfterMoveComplete) {
            equipmentReplayedAfterMoveComplete = true;
            replayStoredEquipment('first-move-complete');
          }
        } else if (packet.id === 0x6a && port === (config.gamePort || 4001) && selectedCharacter) {
          // The first movement packet proves StateMainGame has finished creating
          // the local avatar. ItemListNotify sent before this point fills the
          // grids but cannot attach the stored active equipment to that avatar.
          if (!inventoryRefreshedInWorld && !inventoryRefreshTimer) {
            inventoryRefreshTimer = setTimeout(() => {
              inventoryRefreshTimer = null;
              if (socket.destroyed || !selectedCharacter) return;
              const refreshedItems = account === guestAccount ? [] : database.inventoryFor(selectedCharacter);
              sessionItems.clear();
              for (const item of refreshedItems) sessionItems.set(itemKey(item.inventoryWhere, item.inventorySlot), item);
              const refresh = itemListNotify({ items: refreshedItems });
              const { packets: equipmentReplays, slots } = buildEquipmentReplay(refreshedItems);
              inventoryRefreshedInWorld = true;
              record({ event: 'data', direction: 'server-to-client', hex: refresh.toString('hex'), bytes: refresh.length, purpose: 'in-world-inventory-refresh' });
              socket.write(Buffer.concat([refresh, ...equipmentReplays]));
              record({ event: 'equipment-replay', purpose: 'first-move-start', count: equipmentReplays.length, slots });
            }, 500);
            inventoryRefreshTimer.unref();
          }
        } else if (packet.id === 0xc9 && port === (config.gamePort || 4001) && selectedCharacter) {
          if (packet.payload.length !== 1) { record({ event: 'take-chair-rejected', reason: 'invalid payload' }); continue; }
          const chairId = packet.payload[0];
          const runtimeActorId = selectedCharacter.id;
          occupiedChairId = chairId;
          lastChairId = chairId;
          fishingReadySent = false;
          const reply = Buffer.concat([takeChairReply(), takeChairNotify({ characterId: runtimeActorId, chairId })]);
          record({ event: 'data', direction: 'server-to-client', hex: reply.toString('hex'), bytes: reply.length, purpose: 'take-chair', chairId, runtimeActorId });
          socket.write(reply);
          console.log(`[${id}] seated ${selectedCharacter.name} at chair ${chairId}`);
        } else if (packet.id === 0xcc && port === (config.gamePort || 4001) && selectedCharacter) {
          if (packet.payload.length !== 0) { record({ event: 'rise-chair-rejected', reason: 'invalid payload' }); continue; }
          const runtimeActorId = selectedCharacter.id;
          const chairId = occupiedChairId ?? lastChairId ?? 0;
          if (biteTimer) { clearTimeout(biteTimer); biteTimer = null; }
          fishStateReady = false;
          fishingReadySent = false;
          const rise = riseChairNotify({ characterId: runtimeActorId, chairId });
          // RiseChairReq is a normal local action. DA is a failed-catch reply and
          // causes the slap animation; it must not be synthesized for standing.
          // Clear seating before writing CD so any delayed D1 recast is rejected.
          occupiedChairId = null;
          record({ event: 'data', direction: 'server-to-client', hex: rise.toString('hex'), bytes: rise.length, purpose: 'rise-chair', chairId, runtimeActorId });
          socket.write(rise);
          console.log(`[${id}] released ${selectedCharacter.name} from chair ${chairId}`);
        } else if (packet.id === 0xce && port === (config.gamePort || 4001) && selectedCharacter) {
          if (packet.payload.length !== 0) { record({ event: 'fishing-ready-rejected', reason: 'invalid payload' }); continue; }
          if (occupiedChairId == null) { record({ event: 'fishing-ready-rejected', reason: 'character is not seated' }); continue; }
          if (fishingReadySent) {
            record({ event: 'fishing-ready-duplicate-ignored', reason: 'already armed for this chair session' });
            continue;
          }
          const runtimeActorId = selectedCharacter.id;
          const reply = fishingReadyNotify({ fishingPoint: runtimeActorId });
          fishingReadySent = true;
          record({ event: 'data', direction: 'server-to-client', hex: reply.toString('hex'), bytes: reply.length, purpose: 'fishing-ready', runtimeActorId });
          socket.write(reply);
          console.log(`[${id}] readied ${selectedCharacter.name} for casting`);
        } else if (packet.id === 0xd1 && port === (config.gamePort || 4001) && selectedCharacter) {
          // ThrowCorkReq is exactly three floats (x, y, z). Letting the client
          // originate it ensures its local targeting/animation state exists.
          if (packet.payload.length !== 12) { record({ event: 'throw-cork-rejected', reason: 'invalid payload', payloadHex: packet.payload.toString('hex') }); continue; }
          if (occupiedChairId == null) {
            // A movement click can race the local fishing-target cursor after a
            // successful CC/CD stand-up. Silently dropping this D1 leaves the
            // client waiting forever and every later click remains a cast. A
            // failed D2 resolves that pending request; repeating CD applies the
            // already-requested chair release after targeting has been cleared.
            const cancelCast = throwCorkReply({ success: false });
            const confirmRise = riseChairNotify({ characterId: selectedCharacter.id, chairId: lastChairId ?? 0 });
            const reply = Buffer.concat([cancelCast, confirmRise]);
            record({ event: 'data', direction: 'server-to-client', hex: reply.toString('hex'), bytes: reply.length, purpose: 'cancel-delayed-cast-after-rise', payloadHex: packet.payload.toString('hex') });
            socket.write(reply);
            continue;
          }
          const x = packet.payload.readFloatLE(0);
          const z = packet.payload.readFloatLE(4);
          const height = packet.payload.readFloatLE(8);
          if (![x, z, height].every(Number.isFinite)) { record({ event: 'throw-cork-rejected', reason: 'non-finite coordinates' }); continue; }
          const reply = Buffer.concat([
            throwCorkReply(),
            throwCorkNotify({ characterId: selectedCharacter.id, x, z }),
          ]);
          record({ event: 'data', direction: 'server-to-client', hex: reply.toString('hex'), bytes: reply.length, purpose: 'client-targeted-cast', characterId: selectedCharacter.id, target: { x, z, height } });
          socket.write(reply);
          if (biteTimer) clearTimeout(biteTimer);
          // Leave enough time for this early client to enter its waiting state
          // and construct the cork/bobber camera before advancing to a bite.
          const biteDelayMs = 10000;
          const castAcceptedAt = Date.now();
          const selectedFish = database.fishFor({ mapId: 0, fishingPoint: occupiedChairId, level: selectedCharacter.level ?? 1 });
          activeFishId = Number(selectedFish?.fish_id ?? 100);
          record({ event: 'fish-bite-scheduled', characterId: selectedCharacter.id, fishId: activeFishId, modelCode: selectedFish?.model_code ?? null, delayMs: biteDelayMs });
          biteTimer = setTimeout(() => {
            if (socket.destroyed || occupiedChairId == null) return;
            // Fishing motion packets identify this local character with its
            // persistent character id (the client sent 2), unlike cork/chair
            // notifications which use runtime actor id 1.
            const bite = biteFishNotify({ characterId: selectedCharacter.id, fishId: activeFishId ?? 100, value: 1, size: 1 });
            fishStateReady = true;
            record({ event: 'data', direction: 'server-to-client', hex: bite.toString('hex'), bytes: bite.length, purpose: 'fish-bite', fishId: activeFishId ?? 100, characterId: selectedCharacter.id, elapsedMs: Date.now() - castAcceptedAt });
            socket.write(bite);
          }, biteDelayMs);
          biteTimer.unref();
          console.log(`[${id}] accepted cast target (${x}, ${z}, height ${height}) from ${selectedCharacter.name}`);
        } else if (packet.id === 0xd8 && port === (config.gamePort || 4001) && selectedCharacter) {
          // This is the local client's motion report. Sending it back applies
          // the action a second time and caused cancel/stand-up to recast.
          record({ event: 'fighting-motion-observed', payloadHex: packet.payload.toString('hex'), fishStateReady });
        } else if (packet.id === 0xd5 && port === (config.gamePort || 4001) && selectedCharacter) {
          if (packet.payload.length !== 5) { record({ event: 'strike-fish-rejected', reason: 'invalid payload', payloadHex: packet.payload.toString('hex') }); continue; }
          const characterId = packet.payload.readUInt32LE(0);
          const clientStrike = packet.payload[4] !== 0;
          const success = true;
          // The circular fight is simulated locally from the four character
          // stats in D6. Preserve the recovered creation values exactly: zeroed
          // Luck/Focus values make valid direction input fail immediately.
          const fightProfile = fightProfileFor(selectedCharacter);
          const reply = strikeFishReply({ characterId, fishId: activeFishId ?? 100, size: 1, ...fightProfile, success });
          fishStateReady = true;
          fishingReadySent = false;
          record({ event: 'data', direction: 'server-to-client', hex: reply.toString('hex'), bytes: reply.length, purpose: 'strike-fish', characterId, clientStrike, success, fightProfile });
          socket.write(reply);
        } else if (packet.id === 0xd9 && port === (config.gamePort || 4001) && selectedCharacter) {
          // The client sends FightingFinishReq after the strike/fish-up sequence.
          // The status-one reward form requires valid fish/catalog fields that
          // have not yet been recovered. A guessed form crashes this client.
          // Status zero tears down the failed fight. It must be processed on its
          // own before the client is seated and armed again; putting DA/CB/D0 in
          // one write leaves this client frozen in the failed-catch pose.
          if (packet.payload.length !== 26) { record({ event: 'fighting-finish-rejected', reason: 'invalid payload', payloadHex: packet.payload.toString('hex') }); continue; }
          const finishReport = {
            result: packet.payload[0],
            characterField: packet.payload.readUInt32LE(1),
            fishStrength: packet.payload.readUInt32LE(5),
            playerStrength: packet.payload.readUInt32LE(9),
            currentHitPoints: packet.payload.readUInt16LE(22),
            maximumHitPoints: packet.payload.readUInt16LE(24),
          };
          if (biteTimer) { clearTimeout(biteTimer); biteTimer = null; }
          const chairId = occupiedChairId ?? lastChairId ?? 0;
          const finish = fightingFinishReply({ status: 0 });
          fishStateReady = false;
          // Ignore the automatic CE generated while DA is being applied. The
          // delayed CB/D0 below owns the re-seat transition.
          fishingReadySent = true;
          record({ event: 'data', direction: 'server-to-client', hex: finish.toString('hex'), bytes: finish.length, purpose: 'fighting-finish', chairId, finishReport, payloadHex: packet.payload.toString('hex') });
          socket.write(finish);
          const rearmTimer = setTimeout(() => {
            if (socket.destroyed || occupiedChairId == null || occupiedChairId !== chairId) return;
            const rearm = Buffer.concat([
              takeChairReply(),
              takeChairNotify({ characterId: selectedCharacter.id, chairId }),
              fishingReadyNotify({ fishingPoint: selectedCharacter.id }),
            ]);
            record({ event: 'data', direction: 'server-to-client', hex: rearm.toString('hex'), bytes: rearm.length, purpose: 'post-fight-reseat', chairId, runtimeActorId: selectedCharacter.id });
            socket.write(rearm);

            // In this early client, the first CD after a failed fight does not
            // leave the chair. It clears the final fighting animation and
            // returns the avatar to its seated casting pose. Preserve server
            // occupancy so a later user-originated CC/CD still stands up.
            const poseResetTimer = setTimeout(() => {
              if (socket.destroyed || occupiedChairId == null || occupiedChairId !== chairId) return;
              const poseReset = riseChairNotify({ characterId: selectedCharacter.id, chairId });
              record({ event: 'data', direction: 'server-to-client', hex: poseReset.toString('hex'), bytes: poseReset.length, purpose: 'post-fight-pose-reset', chairId, runtimeActorId: selectedCharacter.id });
              socket.write(poseReset);
            }, 1000);
            poseResetTimer.unref();
          }, 250);
          rearmTimer.unref();
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
          item.active = destinationLocation === 5 ? 1 : 0;
          sessionItems.set(destinationKey, item);
          if (displacedItem) {
            displacedItem.inventoryWhere = sourceLocation;
            displacedItem.inventorySlot = sourceSlot;
            displacedItem.active = sourceLocation === 5 ? 1 : 0;
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
    socket.on('close', () => { if (clockTimer) clearInterval(clockTimer); if (biteTimer) clearTimeout(biteTimer); if (inventoryRefreshTimer) clearTimeout(inventoryRefreshTimer); if (postEntryEquipmentTimer) clearTimeout(postEntryEquipmentTimer); sockets.delete(socket); record({ event: 'close', received }); });
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
