import crypto from 'node:crypto'

// F1 25 UDP packet identifiers.
export const F1_PACKET_IDS = Object.freeze({
  MOTION: 0,
  SESSION: 1,
  LAP_DATA: 2,
  EVENT: 3,
  PARTICIPANTS: 4,
  CAR_SETUPS: 5,
  CAR_TELEMETRY: 6,
  CAR_STATUS: 7,
  FINAL_CLASSIFICATION: 8,
  LOBBY_INFO: 9,
  CAR_DAMAGE: 10,
  SESSION_HISTORY: 11,
  TYRE_SETS: 12,
  MOTION_EX: 13,
  TIME_TRIAL: 14,
  LAP_POSITIONS: 15,
})

export const F1_PACKET_NAMES = Object.freeze({
  0: 'motion',
  1: 'session',
  2: 'lap_data',
  3: 'event',
  4: 'participants',
  5: 'car_setups',
  6: 'car_telemetry',
  7: 'car_status',
  8: 'final_classification',
  9: 'lobby_info',
  10: 'car_damage',
  11: 'session_history',
  12: 'tyre_sets',
  13: 'motion_ex',
  14: 'time_trial',
  15: 'lap_positions',
})

// Expected packet sizes are intentionally marked as minimums to tolerate
// minor game update changes while still detecting malformed packets.
export const F1_PACKET_SPECS = Object.freeze({
  [F1_PACKET_IDS.MOTION]: { name: 'motion', minSize: 1349 },
  [F1_PACKET_IDS.SESSION]: { name: 'session', minSize: 644 },
  [F1_PACKET_IDS.LAP_DATA]: { name: 'lap_data', minSize: 1307 },
  [F1_PACKET_IDS.EVENT]: { name: 'event', minSize: 45 },
  [F1_PACKET_IDS.PARTICIPANTS]: { name: 'participants', minSize: 1306 },
  [F1_PACKET_IDS.CAR_SETUPS]: { name: 'car_setups', minSize: 1107 },
  [F1_PACKET_IDS.CAR_TELEMETRY]: { name: 'car_telemetry', minSize: 1352 },
  [F1_PACKET_IDS.CAR_STATUS]: { name: 'car_status', minSize: 1239 },
  [F1_PACKET_IDS.FINAL_CLASSIFICATION]: { name: 'final_classification', minSize: 1020 },
  [F1_PACKET_IDS.LOBBY_INFO]: { name: 'lobby_info', minSize: 1218 },
  [F1_PACKET_IDS.CAR_DAMAGE]: { name: 'car_damage', minSize: 953 },
  [F1_PACKET_IDS.SESSION_HISTORY]: { name: 'session_history', minSize: 1460 },
  [F1_PACKET_IDS.TYRE_SETS]: { name: 'tyre_sets', minSize: 231 },
  [F1_PACKET_IDS.MOTION_EX]: { name: 'motion_ex', minSize: 257 },
  [F1_PACKET_IDS.TIME_TRIAL]: { name: 'time_trial', minSize: 46 },
  [F1_PACKET_IDS.LAP_POSITIONS]: { name: 'lap_positions', minSize: 117 },
})

// Some packet dumps are 28 bytes header while newer formats expose 29 bytes.
export const F1_HEADER_SIZE = 29

function canRead(buffer, offset, size = 1) {
  return offset + size <= buffer.length
}

function readU8(buffer, offset, fallback = 0) {
  return canRead(buffer, offset, 1) ? buffer.readUInt8(offset) : fallback
}

function readU16LE(buffer, offset, fallback = 0) {
  return canRead(buffer, offset, 2) ? buffer.readUInt16LE(offset) : fallback
}

function readU32LE(buffer, offset, fallback = 0) {
  return canRead(buffer, offset, 4) ? buffer.readUInt32LE(offset) : fallback
}

function readF32LE(buffer, offset, fallback = 0) {
  return canRead(buffer, offset, 4) ? buffer.readFloatLE(offset) : fallback
}

function readU64AsString(buffer, offset) {
  if (!canRead(buffer, offset, 8)) return '0'
  return buffer.readBigUInt64LE(offset).toString(10)
}

export function packetIdToName(packetId) {
  return F1_PACKET_NAMES[packetId] || `unknown_${packetId}`
}

export function parseF1Header(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24) return null

  // Official fields are little-endian packed.
  // We keep a tolerant parser across observed 2023-2025 wire variants.
  const packetFormat = readU16LE(buffer, 0, 0)
  const gameYear = readU8(buffer, 2, 0)
  const gameMajorVersion = readU8(buffer, 3, 0)
  const gameMinorVersion = readU8(buffer, 4, 0)

  const versionCandidateA = readU8(buffer, 5, 0)
  const packetIdCandidateA = readU8(buffer, 6, 255)
  const versionCandidateB = readU8(buffer, 4, 0)
  const packetIdCandidateB = readU8(buffer, 5, 255)

  const isKnownA = packetIdCandidateA in F1_PACKET_NAMES
  const isKnownB = packetIdCandidateB in F1_PACKET_NAMES

  const packetVersion = isKnownA ? versionCandidateA : versionCandidateB
  const packetId = isKnownA ? packetIdCandidateA : packetIdCandidateB

  const sessionUidOffset = isKnownA ? 7 : 6
  const sessionTimeOffset = sessionUidOffset + 8
  const frameOffset = sessionTimeOffset + 4
  const overallFrameOffset = frameOffset + 4
  const playerIndexOffset = overallFrameOffset + 4
  const secondaryIndexOffset = playerIndexOffset + 1

  return {
    packetFormat,
    gameYear,
    gameMajorVersion,
    gameMinorVersion,
    packetVersion,
    packetId,
    packetName: packetIdToName(packetId),
    sessionUID: readU64AsString(buffer, sessionUidOffset),
    sessionTime: readF32LE(buffer, sessionTimeOffset, 0),
    frameIdentifier: readU32LE(buffer, frameOffset, 0),
    overallFrameIdentifier: readU32LE(buffer, overallFrameOffset, 0),
    playerCarIndex: readU8(buffer, playerIndexOffset, 0),
    secondaryPlayerCarIndex: readU8(buffer, secondaryIndexOffset, 255),
    headerSize: Math.min(buffer.length, secondaryIndexOffset + 1),
  }
}

function sha1Hex(buffer) {
  return crypto.createHash('sha1').update(buffer).digest('hex')
}

export function createPacketEnvelope(buffer, source = 'udp') {
  const header = parseF1Header(buffer)
  if (!header) return null

  return {
    source,
    receivedAtMs: Date.now(),
    byteLength: buffer.length,
    checksumSha1: sha1Hex(buffer),
    header,
    rawBase64: buffer.toString('base64'),
  }
}

export function validatePacketSize(packetId, byteLength) {
  const spec = F1_PACKET_SPECS[packetId]
  if (!spec) {
    return {
      ok: true,
      expectedMinSize: null,
      actualSize: byteLength,
      packetName: packetIdToName(packetId),
    }
  }

  return {
    ok: Number(byteLength) >= spec.minSize,
    expectedMinSize: spec.minSize,
    actualSize: Number(byteLength),
    packetName: spec.name,
  }
}
