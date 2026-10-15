import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodePacket, PacketDecoder, loginReply, checkInReply, gameLoginReply, checkOutReply, zoneExitReply, myCharacterListNotify, characterCreateReply, characterSelectReply, zoneJoinReply, friendListReply, cashRefreshReply, updateGoldNotify, chatNotify, fishingReadyNotify, throwCorkReply, throwCorkNotify, biteFishNotify, fightingMotionTrade, aquaListNotify, aquaSelectReply, aquaStatusReply, fishListNotify, cashItemBuyReply, itemBuyReply, itemListNotify, inventorySizeNotify, itemMoveReply, channelListReply, zoneListReply, serverListNotify } from './protocol.mjs';

test('reassembles split headers/payloads and coalesced messages', () => {
  const stream = Buffer.concat([encodePacket(4, Buffer.alloc(15)), encodePacket(1)]);
  const decoder = new PacketDecoder();
  assert.deepEqual(decoder.push(stream.subarray(0, 1)), []);
  assert.deepEqual(decoder.push(stream.subarray(1, 7)), []);
  const packets = decoder.push(stream.subarray(7));
  assert.deepEqual(packets.map(p => [p.id, p.payload.length]), [[4, 15], [1, 0]]);
  assert.equal(decoder.buffer.length, 0);
});

test('post-entry menu replies use recovered layouts', () => {
  assert.equal(friendListReply().toString('hex'), '3602040000000000');
  assert.equal(cashRefreshReply().toString('hex'), '510205000100000000');
  assert.equal(cashRefreshReply({ cash: 0x7fffffff }).readUInt32LE(5), 0x7fffffff);
  const gold = updateGoldNotify({ gold: 0x7fffffff, ping: 0x7fffffff });
  assert.equal(gold.readUInt16LE(0), 0x74);
  assert.equal(gold.readUInt32LE(4), 0x7fffffff);
  assert.equal(gold.readUInt32LE(8), 0x7fffffff);
  const chat = chatNotify({ characterId: 2, sender: 'girl', message: 'gaming', type: 3 });
  assert.equal(chat.readUInt16LE(0), 0x71);
  assert.ok(chat.includes(Buffer.from('gaming')));
  assert.equal(fishingReadyNotify({ fishingPoint: 12 }).toString('hex'), 'd00004000c000000');
  assert.equal(throwCorkReply().toString('hex'), 'd200010001');
  assert.equal(throwCorkNotify({ characterId: 2 }).readUInt16LE(0), 0xd3);
  assert.equal(biteFishNotify({ characterId: 2 }).readUInt32LE(8), 100);
  assert.equal(fightingMotionTrade(Buffer.from('020000000900', 'hex')).toString('hex'), 'd8000600020000000900');
  assert.equal(aquaListNotify().toString('hex'), '600105000100000000');
  const aquarium = aquaListNotify({ aquariums: [{ id: 7, characterId: 2, level: 1, name: 'girl Aquarium' }] });
  assert.equal(aquarium.readUInt32LE(5), 1);
  assert.ok(aquarium.includes(Buffer.from('girl Aquarium')));
  assert.equal(aquaSelectReply({ aquariumId: 7, characterId: 2 }).toString('hex'), '63010d0001070000000000000002000000');
  assert.equal(aquaStatusReply().toString('hex'), '6701010000');
  assert.equal(fishListNotify().toString('hex'), '2e01040000000000');
  const purchase = cashItemBuyReply({ itemId: 0x10264, instanceId: 9 });
  assert.equal(purchase.readUInt16LE(0), 0x253);
  assert.equal(purchase.readUInt16LE(2), 32);
  assert.equal(purchase.readUInt32LE(11), 0x10264);
  assert.equal(purchase[10], 1);
  const shopPurchase = itemBuyReply({ itemId: 393729, instanceId: 10, quantity: 1 });
  assert.equal(shopPurchase.readUInt16LE(0), 0x134);
  assert.equal(shopPurchase.readUInt16LE(2), 12);
  assert.equal(shopPurchase.readUInt32LE(11), 393729);
  assert.equal(shopPurchase[5], 1);
  assert.equal(shopPurchase[6], 0);
  const inventory = itemListNotify({ items: [{ instanceId: 11, itemId: 0x080264, inventoryWhere: 1 }] });
  assert.equal(inventory.readUInt16LE(0), 0x12d);
  assert.equal(inventory.readUInt16LE(2), 32);
  assert.equal(inventory.readUInt32LE(5), 1);
  assert.equal(inventory.readUInt32LE(13), 0x080264);
  assert.equal(inventory[inventory.length - 2], 1);
  assert.equal(inventory[inventory.length - 1], 0);
  assert.equal(inventorySizeNotify().toString('hex'), '320106001e1e1e1e1e1e');
  const moved = itemMoveReply({ destinationLocation: 5, destinationSlot: 8, sourceLocation: 2, sourceSlot: 0, item: { instanceId: 11, itemId: 0x080201, quantity: 1, duration: 100 } });
  assert.equal(moved.readUInt16LE(0), 0x130);
  assert.equal(moved.readUInt16LE(2), 55);
  assert.equal(moved[5], 5);
  assert.equal(moved[6], 8);
  assert.equal(moved.readUInt32LE(28), 100);
  const swapped = itemMoveReply({ destinationLocation: 5, destinationSlot: 8, sourceLocation: 2, sourceSlot: 0, item: { instanceId: 12, itemId: 0x080207, quantity: 1 }, displacedItem: { instanceId: 11, itemId: 0x080201, quantity: 1 } });
  assert.equal(swapped.readUInt32LE(34), 11);
  assert.equal(swapped.readUInt32LE(38), 0x080201);
});

test('LoginReply uses recovered status/u32/u32 layout', () => {
  assert.equal(loginReply().toString('hex'), '05000900010100000000000000');
});

test('server list packet carries one complete entry and trailing field', () => {
  const packet = serverListNotify();
  assert.equal(packet.readUInt16LE(0), 8);
  assert.equal(packet.readUInt16LE(2), packet.length - 4);
  assert.equal(packet.readUInt32LE(4), 1);
  assert.equal(packet.readUInt32LE(8), 10);
  assert.ok(packet.includes(Buffer.from('Local Server', 'ascii')));
  assert.ok(packet.includes(Buffer.from('127.0.0.1', 'ascii')));
});

test('check-in reply uses recovered success byte', () => {
  assert.equal(checkInReply().toString('hex'), '0700010001');
});

test('game login reply has ID 11 and four-byte success value', () => {
  assert.equal(gameLoginReply().toString('hex'), '0b00040001000000');
});

test('checkout and zone-exit replies carry successful result bytes', () => {
  assert.equal(checkOutReply().toString('hex'), '0d00010001');
  assert.equal(zoneExitReply().toString('hex'), '4400010001');
});

test('personal character list has a usable slot and one named character', () => {
  const packet = myCharacterListNotify();
  assert.equal(packet.readUInt16LE(0), 0x33);
  assert.equal(packet.readUInt16LE(2), packet.length - 4);
  assert.equal(packet[4], 1);
  assert.equal(packet.readUInt32LE(9), 1);
  assert.ok(packet.includes(Buffer.from('TestAngler', 'ascii')));
  const nameEnd = packet.indexOf(Buffer.from('TestAngler')) + 'TestAngler'.length;
  assert.equal(packet.readUInt16LE(nameEnd), 1);
  assert.equal(packet.readUInt16LE(nameEnd + 10), 1);
  const progressed = myCharacterListNotify({ characters: [{ name: 'girl', id: 2, slot: 2, level: 4, grade: 3, rankExperience: 700, experience: 5000, experienceIntoLevel: 200 }] });
  const progressedNameEnd = progressed.indexOf(Buffer.from('girl')) + 4;
  assert.equal(progressed.readUInt16LE(progressedNameEnd), 4);
  assert.equal(progressed.readUInt32LE(progressedNameEnd + 6), 700);
  assert.equal(progressed.readUInt16LE(progressedNameEnd + 10), 3);
  assert.equal(progressed.readUInt32LE(progressedNameEnd + 12), 4);
  assert.equal(progressed.readUInt32LE(progressedNameEnd + 16), 200);
});

test('creation reply and next-login list include the new character', () => {
  const reply = characterCreateReply({ name: 'test1', id: 2, appearance: 2 });
  const list = myCharacterListNotify({ characters: [{ name: 'TestAngler', id: 1, slot: 1 }, { name: 'test1', id: 2, slot: 2 }] });
  assert.equal(reply.readUInt16LE(0), 0x37);
  assert.equal(reply.readUInt32LE(4), 1);
  assert.equal(list.readUInt32LE(9), 2);
  assert.ok(list.includes(Buffer.from('test1')));
});

test('channel and zone lists carry one local entry', () => {
  const channel = channelListReply();
  const zone = zoneListReply();
  assert.equal(channel.readUInt16LE(0), 0x3d);
  assert.equal(channel.readUInt32LE(4), 1);
  assert.equal(zone.readUInt16LE(0), 0x3f);
  assert.equal(zone.readUInt32LE(4), 1);
  assert.equal(zone.readUInt16LE(zone.length - 2), 0);
  assert.equal(characterSelectReply('TestAngler').readUInt16LE(0), 0x3b);
  const join = zoneJoinReply({ characterId: 2, x: 64, z: 64, slot: 1 });
  assert.equal(join.readUInt16LE(0), 0x41);
  assert.equal(join.readUInt16LE(2), 14);
  assert.equal(join.readUInt32LE(5), 2);
  assert.equal(join.readFloatLE(9), 64);
  assert.equal(join.readFloatLE(13), 64);
});
