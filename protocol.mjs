export function encodePacket(id, payload = Buffer.alloc(0)) {
  if (!Number.isInteger(id) || id < 0 || id > 65535 || payload.length > 65535) throw new Error('Invalid packet ID or payload size');
  const packet = Buffer.alloc(4 + payload.length);
  packet.writeUInt16LE(id, 0);
  packet.writeUInt16LE(payload.length, 2);
  payload.copy(packet, 4);
  return packet;
}

export class PacketDecoder {
  buffer = Buffer.alloc(0);
  push(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const packets = [];
    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt16LE(2);
      if (this.buffer.length < length + 4) break;
      packets.push({ id: this.buffer.readUInt16LE(0), payload: Buffer.from(this.buffer.subarray(4, length + 4)) });
      this.buffer = this.buffer.subarray(length + 4);
    }
    return packets;
  }
}

export function loginReply(field8 = 1, field12 = 0) {
  const payload = Buffer.alloc(9);
  payload[0] = 1; // Client handler's success branch.
  payload.writeUInt32LE(field8, 1);
  payload.writeUInt32LE(field12, 5);
  return encodePacket(5, payload);
}

export function checkInReply() {
  return encodePacket(7, Buffer.from([1]));
}

export function gameLoginReply() {
  const payload = Buffer.alloc(4);
  payload.writeUInt32LE(1);
  return encodePacket(11, payload);
}

export function checkOutReply() {
  // CheckOutReply (ID 13) reads/writes a single result byte.
  return encodePacket(13, Buffer.from([1]));
}

export function zoneExitReply() {
  // ZoneExitReply (ID 68) reads/writes a single result byte.
  return encodePacket(68, Buffer.from([1]));
}

export function myCharacterListNotify({ characters = [{ name: 'TestAngler', id: 1, slot: 1 }] } = {}) {
  if (characters.length > 5) throw new Error('Client supports at most five character slots');
  const names = characters.map(character => Buffer.from(character.name, 'ascii'));
  if (names.some(name => !name.length || name.length > 255)) throw new Error('Invalid character name length');
  const payload = Buffer.alloc(9 + names.reduce((size, name) => size + 4 + 1 + 1 + name.length + 2 + 4 + 4 + 2 + 4 + 4 + 4, 0));
  let offset = 0;
  payload[offset++] = 1; // Handler accepts statuses 1 through 4; maps to slot zero.
  payload.writeUInt32LE(0, offset); offset += 4; // Unknown field.
  payload.writeUInt32LE(characters.length, offset); offset += 4;
  for (let index = 0; index < characters.length; index++) {
    const character = characters[index];
    const encodedName = names[index];
    if (!Number.isInteger(character.slot) || character.slot < 1 || character.slot > 5) throw new Error('Invalid character slot');
    payload.writeUInt32LE(character.id, offset); offset += 4;
    payload[offset++] = character.slot;
    payload[offset++] = encodedName.length; encodedName.copy(payload, offset); offset += encodedName.length;
    // The in-world HUD reads this 16-bit field for the visible Lv. value.
    payload.writeUInt16LE(character.level ?? 1, offset); offset += 2;
    payload.writeFloatLE(0, offset); offset += 4; // Equipment capacity/stat field.
    payload.writeUInt32LE(character.rankExperience ?? 0, offset); offset += 4;
    payload.writeUInt16LE(character.grade ?? 1, offset); offset += 2;
    payload.writeUInt32LE(character.level ?? 1, offset); offset += 4;
    payload.writeUInt32LE(character.experienceIntoLevel ?? character.experience ?? 0, offset); offset += 4;
    payload.writeUInt32LE(0, offset); offset += 4;
  }
  return encodePacket(0x33, payload);
}

export function characterCreateReply({ name, id, appearance = 0 } = {}) {
  const encodedName = Buffer.from(name || '', 'ascii');
  if (!encodedName.length || encodedName.length > 255) throw new Error('Invalid character name');
  const payload = Buffer.alloc(4 + 1 + 1 + encodedName.length + 2 + 2 + 4 + 4);
  let offset = 0;
  payload.writeUInt32LE(1, offset); offset += 4;
  payload[offset++] = appearance;
  payload[offset++] = encodedName.length; encodedName.copy(payload, offset); offset += encodedName.length;
  payload.writeUInt16LE(1, offset); offset += 2;
  payload.writeUInt16LE(1, offset); offset += 2;
  payload.writeUInt32LE(id, offset); offset += 4;
  payload.writeUInt32LE(0, offset);
  return encodePacket(0x37, payload);
}

export function characterListNotify() {
  const payload = Buffer.alloc(4); // Zero entries, per writer at 0x482a50.
  return encodePacket(0x34, payload);
}

export function channelListReply({ maps = [{ id: 0, name: 'Pangaea', minimumLevel: 1, maximumLevel: 0xffff, enabled: 1 }] } = {}) {
  // Entry: u16 ID, u16 value, short string, three u16 values.
  const encoded = maps.map(map => ({ ...map, encodedName: Buffer.from(map.name, 'ascii') }));
  if (encoded.some(map => map.encodedName.length > 255)) throw new Error('Map name exceeds client wire limit');
  const payload = Buffer.alloc(4 + encoded.reduce((total, map) => total + 11 + map.encodedName.length, 0));
  let offset = 0;
  payload.writeUInt32LE(encoded.length, offset); offset += 4;
  for (const map of encoded) {
    payload.writeUInt16LE(map.id, offset); offset += 2;
    payload.writeUInt16LE(map.id, offset); offset += 2;
    payload[offset++] = map.encodedName.length; map.encodedName.copy(payload, offset); offset += map.encodedName.length;
    payload.writeUInt16LE(map.minimumLevel ?? 1, offset); offset += 2;
    payload.writeUInt16LE(map.maximumLevel ?? 0xffff, offset); offset += 2;
    payload.writeUInt16LE(map.enabled ?? 1, offset); offset += 2;
  }
  return encodePacket(0x3d, payload);
}

export function zoneListReply({ channels = [{ id: 0, name: 'Pangaea 1', status: 0 }] } = {}) {
  // Entry: u16 zone index, short string, u16 availability/status.
  const encoded = channels.map(channel => ({ ...channel, encodedName: Buffer.from(channel.name, 'ascii') }));
  if (encoded.some(channel => channel.encodedName.length > 255)) throw new Error('Channel name exceeds client wire limit');
  const payload = Buffer.alloc(4 + encoded.reduce((total, channel) => total + 5 + channel.encodedName.length, 0));
  let offset = 0;
  payload.writeUInt32LE(encoded.length, offset); offset += 4;
  for (const channel of encoded) {
    payload.writeUInt16LE(channel.id, offset); offset += 2;
    payload[offset++] = channel.encodedName.length;
    channel.encodedName.copy(payload, offset); offset += channel.encodedName.length;
    payload.writeUInt16LE(channel.status ?? 0, offset); offset += 2;
  }
  return encodePacket(0x3f, payload);
}

export function characterSelectReply(name) {
  const encodedName = Buffer.from(name, 'ascii');
  if (!encodedName.length || encodedName.length > 255) throw new Error('Invalid character name');
  return encodePacket(0x3b, Buffer.concat([Buffer.from([1, encodedName.length]), encodedName]));
}

export function zoneJoinReply({ characterId = 1, x = 64, z = 64, slot = 1 } = {}) {
  // Writer at 0x47f980: status u8, ID u32, X/Z floats, selected slot u8.
  const payload = Buffer.alloc(14);
  payload[0] = 1;
  payload.writeUInt32LE(characterId, 1);
  payload.writeFloatLE(x, 5);
  payload.writeFloatLE(z, 9);
  payload[13] = slot;
  return encodePacket(0x41, payload);
}

export function friendListReply() {
  // FriendListReply writer serializes a u32 entry count followed by entries.
  return encodePacket(0x236, Buffer.alloc(4));
}

export function cashRefreshReply({ cash = 0 } = {}) {
  // CashRefreshReply writer: status u8 followed by balance u32.
  const payload = Buffer.alloc(5);
  payload[0] = 1;
  payload.writeUInt32LE(cash, 1);
  return encodePacket(0x251, payload);
}

export function updateGoldNotify({ gold = 0x7fffffff, ping = 0x7fffffff } = {}) {
  // UpdateGoldNotify writer: Gold u32 followed by Ping u32.
  const payload = Buffer.alloc(8);
  payload.writeUInt32LE(gold, 0);
  payload.writeUInt32LE(ping, 4);
  return encodePacket(0x74, payload);
}

export function chatNotify({ characterId = 1, sender = 'Player', message, type = 3 } = {}) {
  const encodedSender = Buffer.from(sender, 'ascii');
  const encodedMessage = Buffer.from(message || '', 'ascii');
  if (!encodedSender.length || encodedSender.length > 255 || !encodedMessage.length || encodedMessage.length > 255) throw new Error('Invalid chat sender or message');
  const payload = Buffer.alloc(4 + 1 + encodedSender.length + 1 + encodedMessage.length + 1);
  let offset = 0;
  payload.writeUInt32LE(characterId, offset); offset += 4;
  payload[offset++] = encodedSender.length; encodedSender.copy(payload, offset); offset += encodedSender.length;
  payload[offset++] = encodedMessage.length; encodedMessage.copy(payload, offset); offset += encodedMessage.length;
  payload[offset] = type;
  return encodePacket(0x71, payload);
}

export function fishingReadyNotify({ fishingPoint } = {}) {
  if (!Number.isInteger(fishingPoint) || fishingPoint < 0 || fishingPoint > 0xffffffff) throw new Error('Invalid fishing point ID');
  const payload = Buffer.alloc(4);
  payload.writeUInt32LE(fishingPoint, 0);
  return encodePacket(0xd0, payload);
}

export function throwCorkReply({ success = true } = {}) {
  // ThrowCorkReply ID 0xd2 uses the shared one-byte result writer 0x481fe0.
  return encodePacket(0xd2, Buffer.from([success ? 1 : 0]));
}

export function throwCorkNotify({ characterId, x = 64, z = 64 } = {}) {
  const payload = Buffer.alloc(12);
  payload.writeUInt32LE(characterId, 0);
  payload.writeFloatLE(x, 4);
  payload.writeFloatLE(z, 8);
  return encodePacket(0xd3, payload);
}

export function biteFishNotify({ characterId, fishId = 100, value = 1, size = 1 } = {}) {
  // Writer 0x474fc0: actor u32, fish/catalog u32, state/value u32, size float.
  const payload = Buffer.alloc(16);
  payload.writeUInt32LE(characterId, 0);
  payload.writeUInt32LE(fishId, 4);
  payload.writeUInt32LE(value, 8);
  payload.writeFloatLE(size, 12);
  return encodePacket(0xd4, payload);
}

export function fightingMotionTrade(payload) {
  if (!Buffer.isBuffer(payload) || payload.length !== 6) throw new Error('Invalid fighting motion payload');
  return encodePacket(0xd8, payload);
}

export function aquaSelectReply({ success = true, aquariumId, rating = 0, characterId } = {}) {
  // Writer 0x487a70: result u8, aquarium key u32, rating float, owner/key u32.
  const payload = Buffer.alloc(13);
  payload[0] = success ? 1 : 0;
  payload.writeUInt32LE(aquariumId ?? 0, 1);
  payload.writeFloatLE(rating, 5);
  payload.writeUInt32LE(characterId ?? 0, 9);
  return encodePacket(0x163, payload);
}

export function aquaStatusReply({ success = false } = {}) {
  // Failure is a complete one-byte form; the success form contains a larger
  // nested status structure that has not yet been recovered.
  return encodePacket(0x167, Buffer.from([success ? 1 : 0]));
}

export function aquaListNotify({ success = true, aquariums = [] } = {}) {
  // Writer 0x487570: result u8, u32 count, then u32/u32/u8/string/float.
  const encoded = aquariums.map(aquarium => ({ ...aquarium, encodedName: Buffer.from(aquarium.name || 'My Aquarium', 'ascii') }));
  if (encoded.some(aquarium => !aquarium.encodedName.length || aquarium.encodedName.length > 255)) throw new Error('Invalid aquarium name');
  const payload = Buffer.alloc(5 + encoded.reduce((size, aquarium) => size + 14 + aquarium.encodedName.length, 0));
  payload[0] = success ? 1 : 0;
  payload.writeUInt32LE(encoded.length, 1);
  let offset = 5;
  for (const aquarium of encoded) {
    payload.writeUInt32LE(aquarium.id, offset); offset += 4;
    payload.writeUInt32LE(aquarium.characterId, offset); offset += 4;
    payload[offset++] = aquarium.level ?? 1;
    payload[offset++] = aquarium.encodedName.length;
    aquarium.encodedName.copy(payload, offset); offset += aquarium.encodedName.length;
    payload.writeFloatLE(aquarium.rating ?? 0, offset); offset += 4;
  }
  return encodePacket(0x160, payload);
}

export function fishListNotify() {
  // Writer 0x484b50 begins with a u32 count. Individual catch records are not
  // sent until their complete 48-byte layout has been recovered.
  return encodePacket(0x12e, Buffer.alloc(4));
}

export function cashItemBuyReply({ itemId, instanceId = 1, quantity = 1, inventorySlot = 0, inventoryWhere = 1 } = {}) {
  if (!Number.isInteger(itemId) || itemId < 1 || itemId > 0xffffffff) throw new Error('Invalid cash item ID');
  // Recovered success layout: status, instance ID, inventory slot/location, item ID,
  // quantity, flags, duration, four modifiers, and a final value.
  const payload = Buffer.alloc(32);
  let offset = 0;
  payload[offset++] = 1;
  payload.writeUInt32LE(instanceId, offset); offset += 4;
  payload[offset++] = inventorySlot;
  payload[offset++] = inventoryWhere;
  payload.writeUInt32LE(itemId, offset); offset += 4;
  payload.writeUInt32LE(quantity, offset); offset += 4;
  payload[offset++] = 0;
  payload.writeUInt32LE(0, offset); offset += 4;
  for (let i = 0; i < 4; i++) { payload.writeUInt16LE(0, offset); offset += 2; }
  payload.writeUInt32LE(0, offset);
  return encodePacket(0x253, payload);
}

export function itemBuyReply({ itemId, instanceId = 1, quantity = 1, inventorySlot = 0, inventoryWhere = 1 } = {}) {
  if (!Number.isInteger(itemId) || itemId < 1 || itemId > 0xffffffff) throw new Error('Invalid item ID');
  // ItemBuyReply writer/handler: status u8, inventory location u8, slot u8, instance ID u32,
  // item ID u32, quantity u8.
  const payload = Buffer.alloc(12);
  payload[0] = 1;
  payload[1] = inventoryWhere;
  payload[2] = inventorySlot;
  payload.writeUInt32LE(instanceId, 3);
  payload.writeUInt32LE(itemId, 7);
  payload[11] = quantity;
  return encodePacket(0x134, payload);
}

export function itemListNotify({ items = [] } = {}) {
  // Writer at 0x4846c0: status u8, count u32, then each item as
  // instance u32, item ID u32, active u8, quantity u32, four u16
  // modifiers, duration u32, inventory location u8, inventory slot u8.
  const payload = Buffer.alloc(5 + items.length * 27);
  let offset = 0;
  payload[offset++] = 1;
  payload.writeUInt32LE(items.length, offset); offset += 4;
  for (const item of items) {
    payload.writeUInt32LE(item.instanceId ?? 1, offset); offset += 4;
    payload.writeUInt32LE(item.itemId, offset); offset += 4;
    payload[offset++] = item.active ?? 0;
    payload.writeUInt32LE(item.quantity ?? 1, offset); offset += 4;
    for (let i = 0; i < 4; i++) { payload.writeUInt16LE(item.modifiers?.[i] ?? 0, offset); offset += 2; }
    payload.writeUInt32LE(item.duration ?? 0, offset); offset += 4;
    payload[offset++] = item.inventoryWhere ?? 1;
    payload[offset++] = item.inventorySlot ?? 0;
  }
  return encodePacket(0x12d, payload);
}

export function inventorySizeNotify({ capacities = [30, 30, 30, 30, 30, 30] } = {}) {
  if (!Array.isArray(capacities) || capacities.length !== 6 || capacities.some(value => !Number.isInteger(value) || value < 1 || value > 255)) {
    throw new Error('Inventory capacities must contain six nonzero bytes');
  }
  // InvenSizeNotify writer at 0x485350 serializes six capacity bytes.
  return encodePacket(0x132, Buffer.from(capacities));
}

function writeMoveItem(payload, offset, item = {}) {
  payload.writeUInt32LE(item.instanceId ?? 0, offset); offset += 4;
  payload.writeUInt32LE(item.itemId ?? 0, offset); offset += 4;
  payload[offset++] = item.active ?? 0;
  payload.writeUInt32LE(item.quantity ?? 0, offset); offset += 4;
  for (let i = 0; i < 4; i++) { payload.writeUInt16LE(item.modifiers?.[i] ?? 0, offset); offset += 2; }
  payload.writeUInt32LE(item.duration ?? 0, offset); offset += 4;
  return offset;
}

export function itemMoveReply({ destinationLocation, destinationSlot, item, sourceLocation, sourceSlot, displacedItem = null, status = 1 } = {}) {
  const payload = Buffer.alloc(55);
  let offset = 0;
  payload[offset++] = status;
  payload[offset++] = destinationLocation;
  payload[offset++] = destinationSlot;
  offset = writeMoveItem(payload, offset, item);
  payload[offset++] = sourceLocation;
  payload[offset++] = sourceSlot;
  writeMoveItem(payload, offset, displacedItem ?? {});
  return encodePacket(0x130, payload);
}

export function serverListNotify({ name = 'Local Server', address = '127.0.0.1', port = 4001 } = {}) {
  const first = Buffer.from(name, 'ascii');
  const second = Buffer.from(address, 'ascii');
  if (first.length > 255 || second.length > 255) throw new Error('Server list strings exceed the client wire limit');
  const payload = Buffer.alloc(4 + 4 + 1 + first.length + 1 + second.length + 4 + 8 + 4);
  let offset = 0;
  payload.writeUInt32LE(1, offset); offset += 4; // Number of entries.
  payload.writeUInt32LE(10, offset); offset += 4; // First valid server-list ID group.
  payload[offset++] = first.length; first.copy(payload, offset); offset += first.length;
  payload[offset++] = second.length; second.copy(payload, offset); offset += second.length;
  payload.writeUInt32LE(port, offset); offset += 4;
  payload.writeUInt16LE(1, offset); offset += 2;
  payload.writeUInt16LE(0, offset); offset += 2;
  payload.writeUInt16LE(0, offset); offset += 2;
  payload.writeUInt16LE(0, offset); offset += 2;
  payload.writeUInt32LE(0, offset); // Trailing field.
  return encodePacket(8, payload);
}
