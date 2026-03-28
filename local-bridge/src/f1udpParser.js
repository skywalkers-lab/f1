import {
  F1_PACKET_IDS,
  createPacketEnvelope,
  validatePacketSize,
} from '@f1/shared-protocol'

function canRead(buffer, offset, size = 1) {
  return offset + size <= buffer.length
}

function readString(buffer, offset, len) {
  if (!canRead(buffer, offset, len)) return ''
  const slice = buffer.subarray(offset, offset + len)
  const zero = slice.indexOf(0)
  const clipped = zero >= 0 ? slice.subarray(0, zero) : slice
  return clipped.toString('utf8').trim()
}

function parseSessionData(buffer, payloadOffset) {
  const o = payloadOffset
  return {
    weather: canRead(buffer, o, 1) ? buffer.readUInt8(o) : 0,
    sessionType: canRead(buffer, o + 5, 1) ? buffer.readUInt8(o + 5) : 0,
    trackId: canRead(buffer, o + 12, 1) ? buffer.readInt8(o + 12) : -1,
    totalLaps: canRead(buffer, o + 13, 1) ? buffer.readUInt8(o + 13) : 0,
    safetyCarStatus: canRead(buffer, o + 45, 1) ? buffer.readUInt8(o + 45) : 0,
  }
}

function parseLapData(buffer, payloadOffset) {
  const entryLen = 58
  const out = []
  let offset = payloadOffset
  for (let i = 0; i < 22; i += 1) {
    if (!canRead(buffer, offset, entryLen)) break
    out.push({
      carIndex: i,
      lastLapMs: buffer.readUInt32LE(offset),
      currentLapMs: buffer.readUInt32LE(offset + 4),
      lapDistance: buffer.readFloatLE(offset + 20),
      carPosition: buffer.readUInt8(offset + 32),
      currentLapNum: buffer.readUInt8(offset + 33),
      pitStatus: buffer.readUInt8(offset + 34),
      penalties: canRead(buffer, offset + 39, 1) ? buffer.readUInt8(offset + 39) : 0,
      totalWarnings: canRead(buffer, offset + 40, 1) ? buffer.readUInt8(offset + 40) : 0,
      cornerCuttingWarnings: canRead(buffer, offset + 41, 1) ? buffer.readUInt8(offset + 41) : 0,
      numUnservedDriveThroughPens: canRead(buffer, offset + 42, 1) ? buffer.readUInt8(offset + 42) : 0,
      numUnservedStopGoPens: canRead(buffer, offset + 43, 1) ? buffer.readUInt8(offset + 43) : 0,
      resultStatus: buffer.readUInt8(offset + 45),
    })
    offset += entryLen
  }
  return out
}

function parseTelemetryData(buffer, payloadOffset) {
  const entryLen = 60
  const out = []
  let offset = payloadOffset
  for (let i = 0; i < 22; i += 1) {
    if (!canRead(buffer, offset, entryLen)) break
    out.push({
      carIndex: i,
      speed: buffer.readUInt16LE(offset),
      throttle: buffer.readFloatLE(offset + 2),
      brake: buffer.readFloatLE(offset + 10),
      gear: buffer.readInt8(offset + 15),
      rpm: buffer.readUInt16LE(offset + 16),
      drs: buffer.readUInt8(offset + 18),
    })
    offset += entryLen
  }
  return out
}

function parseCarStatus(buffer, payloadOffset) {
  const entryLen = 45
  const out = []
  let offset = payloadOffset
  for (let i = 0; i < 22; i += 1) {
    if (!canRead(buffer, offset, entryLen)) break
    out.push({
      carIndex: i,
      tyreCompoundRaw: canRead(buffer, offset + 18, 1) ? buffer.readUInt8(offset + 18) : 16,
      tyreCompoundVisual: canRead(buffer, offset + 19, 1) ? buffer.readUInt8(offset + 19) : 16,
      fuelInTank: canRead(buffer, offset + 26, 4) ? buffer.readFloatLE(offset + 26) : 0,
      ersStoreEnergy: canRead(buffer, offset + 32, 4) ? buffer.readFloatLE(offset + 32) : 0,
    })
    offset += entryLen
  }
  return out
}

function parseParticipants(buffer, payloadOffset) {
  const numCars = canRead(buffer, payloadOffset, 1) ? buffer.readUInt8(payloadOffset) : 22
  const entryLen = 58
  let offset = payloadOffset + 1
  const out = []

  for (let i = 0; i < numCars; i += 1) {
    if (!canRead(buffer, offset, entryLen)) break
    out.push({
      carIndex: i,
      driverId: buffer.readUInt8(offset + 1),
      raceNumber: buffer.readUInt8(offset + 5),
      name: readString(buffer, offset + 7, 48),
    })
    offset += entryLen
  }

  return out
}

function parseMotion(buffer, payloadOffset) {
  const entryLen = 60
  let offset = payloadOffset
  const out = []
  for (let i = 0; i < 22; i += 1) {
    if (!canRead(buffer, offset, entryLen)) break
    out.push({
      carIndex: i,
      x: buffer.readFloatLE(offset),
      y: buffer.readFloatLE(offset + 4),
      z: buffer.readFloatLE(offset + 8),
      vx: buffer.readFloatLE(offset + 32),
      vy: buffer.readFloatLE(offset + 36),
      vz: buffer.readFloatLE(offset + 40),
    })
    offset += entryLen
  }
  return out
}

export function parseF1Packet(buffer) {
  const envelope = createPacketEnvelope(buffer, 'udp_local_bridge')
  if (!envelope) return null

  const sizeCheck = validatePacketSize(envelope.header.packetId, buffer.length)

  const header = {
    ...envelope.header,
    // Keep session UID lossless across JS boundaries.
    sessionUID: String(envelope.header.sessionUID || '0'),
  }
  const payloadOffset = header.headerSize || 29
  const meta = {
    sizeCheck,
  }

  switch (header.packetId) {
    case F1_PACKET_IDS.SESSION:
      return { header, type: 'session', data: parseSessionData(buffer, payloadOffset), raw: envelope, meta }
    case F1_PACKET_IDS.LAP_DATA:
      return { header, type: 'lap', data: parseLapData(buffer, payloadOffset), raw: envelope, meta }
    case F1_PACKET_IDS.CAR_TELEMETRY:
      return { header, type: 'telemetry', data: parseTelemetryData(buffer, payloadOffset), raw: envelope, meta }
    case F1_PACKET_IDS.CAR_STATUS:
      return { header, type: 'status', data: parseCarStatus(buffer, payloadOffset), raw: envelope, meta }
    case F1_PACKET_IDS.PARTICIPANTS:
      return { header, type: 'participants', data: parseParticipants(buffer, payloadOffset), raw: envelope, meta }
    case F1_PACKET_IDS.MOTION:
      return { header, type: 'motion', data: parseMotion(buffer, payloadOffset), raw: envelope, meta }
    case F1_PACKET_IDS.EVENT:
      return { header, type: 'event', data: null, raw: envelope, meta }
    case F1_PACKET_IDS.CAR_SETUPS:
      return { header, type: 'car_setups', data: null, raw: envelope, meta }
    case F1_PACKET_IDS.FINAL_CLASSIFICATION:
      return { header, type: 'final_classification', data: null, raw: envelope, meta }
    case F1_PACKET_IDS.LOBBY_INFO:
      return { header, type: 'lobby_info', data: null, raw: envelope, meta }
    case F1_PACKET_IDS.CAR_DAMAGE:
      return { header, type: 'car_damage', data: null, raw: envelope, meta }
    case F1_PACKET_IDS.SESSION_HISTORY:
      return { header, type: 'session_history', data: null, raw: envelope, meta }
    case F1_PACKET_IDS.TYRE_SETS:
      return { header, type: 'tyre_sets', data: null, raw: envelope, meta }
    case F1_PACKET_IDS.MOTION_EX:
      return { header, type: 'motion_ex', data: null, raw: envelope, meta }
    case F1_PACKET_IDS.TIME_TRIAL:
      return { header, type: 'time_trial', data: null, raw: envelope, meta }
    case F1_PACKET_IDS.LAP_POSITIONS:
      return { header, type: 'lap_positions', data: null, raw: envelope, meta }
    default:
      return { header, type: 'unknown', data: null, raw: envelope, meta }
  }
}
