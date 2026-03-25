const PACKET_IDS = {
  MOTION: 0,
  SESSION: 1,
  LAP_DATA: 2,
  PARTICIPANTS: 4,
  CAR_TELEMETRY: 6,
  CAR_STATUS: 7,
}

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

function parseHeader(buffer) {
  if (buffer.length < 29) return null
  return {
    packetFormat: buffer.readUInt16LE(0),
    gameMajorVersion: buffer.readUInt8(2),
    gameMinorVersion: buffer.readUInt8(3),
    packetVersion: buffer.readUInt8(4),
    packetId: buffer.readUInt8(5),
    sessionUID: Number(buffer.readBigUInt64LE(6)),
    sessionTime: buffer.readFloatLE(14),
    frameIdentifier: buffer.readUInt32LE(18),
    overallFrameIdentifier: buffer.readUInt32LE(22),
    playerCarIndex: buffer.readUInt8(26),
    secondaryPlayerCarIndex: buffer.readUInt8(27),
  }
}

function parseSessionData(buffer) {
  const o = 29
  return {
    weather: canRead(buffer, o, 1) ? buffer.readUInt8(o) : 0,
    sessionType: canRead(buffer, o + 5, 1) ? buffer.readUInt8(o + 5) : 0,
    trackId: canRead(buffer, o + 12, 1) ? buffer.readInt8(o + 12) : -1,
    totalLaps: canRead(buffer, o + 13, 1) ? buffer.readUInt8(o + 13) : 0,
    safetyCarStatus: canRead(buffer, o + 45, 1) ? buffer.readUInt8(o + 45) : 0,
  }
}

function parseLapData(buffer) {
  const entryLen = 58
  const out = []
  let offset = 29
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

function parseTelemetryData(buffer) {
  const entryLen = 60
  const out = []
  let offset = 29
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

function parseCarStatus(buffer) {
  const entryLen = 45
  const out = []
  let offset = 29
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

function parseParticipants(buffer) {
  const numCars = canRead(buffer, 29, 1) ? buffer.readUInt8(29) : 22
  const entryLen = 58
  let offset = 30
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

function parseMotion(buffer) {
  const entryLen = 60
  let offset = 29
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
  const header = parseHeader(buffer)
  if (!header) return null

  switch (header.packetId) {
    case PACKET_IDS.SESSION:
      return { header, type: 'session', data: parseSessionData(buffer) }
    case PACKET_IDS.LAP_DATA:
      return { header, type: 'lap', data: parseLapData(buffer) }
    case PACKET_IDS.CAR_TELEMETRY:
      return { header, type: 'telemetry', data: parseTelemetryData(buffer) }
    case PACKET_IDS.CAR_STATUS:
      return { header, type: 'status', data: parseCarStatus(buffer) }
    case PACKET_IDS.PARTICIPANTS:
      return { header, type: 'participants', data: parseParticipants(buffer) }
    case PACKET_IDS.MOTION:
      return { header, type: 'motion', data: parseMotion(buffer) }
    default:
      return { header, type: 'unknown', data: null }
  }
}
