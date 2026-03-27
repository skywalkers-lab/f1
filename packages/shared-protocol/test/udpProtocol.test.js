import test from 'node:test'
import assert from 'node:assert/strict'
import {
  F1_PACKET_IDS,
  F1_PACKET_SPECS,
  parseF1Header,
  packetIdToName,
  validatePacketSize,
} from '../src/index.js'

function createHeaderBuffer({ packetId = F1_PACKET_IDS.SESSION, frameIdentifier = 100 } = {}) {
  const buffer = Buffer.alloc(64)
  buffer.writeUInt16LE(2025, 0)
  buffer.writeUInt8(25, 2)
  buffer.writeUInt8(1, 3)
  buffer.writeUInt8(0, 4)
  buffer.writeUInt8(1, 5)
  buffer.writeUInt8(packetId, 6)
  buffer.writeBigUInt64LE(123456789n, 7)
  buffer.writeFloatLE(42.5, 15)
  buffer.writeUInt32LE(frameIdentifier, 19)
  buffer.writeUInt32LE(frameIdentifier, 23)
  buffer.writeUInt8(7, 27)
  buffer.writeUInt8(255, 28)
  return buffer
}

test('parseF1Header should decode little-endian header fields', () => {
  const buf = createHeaderBuffer({ packetId: F1_PACKET_IDS.LAP_DATA, frameIdentifier: 321 })
  const header = parseF1Header(buf)

  assert.equal(header.packetFormat, 2025)
  assert.equal(header.packetId, F1_PACKET_IDS.LAP_DATA)
  assert.equal(header.packetName, 'lap_data')
  assert.equal(header.frameIdentifier, 321)
  assert.equal(header.playerCarIndex, 7)
})

test('packetIdToName should return fallback for unknown id', () => {
  assert.equal(packetIdToName(254), 'unknown_254')
})

test('validatePacketSize should enforce minimum packet sizes', () => {
  const min = F1_PACKET_SPECS[F1_PACKET_IDS.MOTION].minSize
  const ok = validatePacketSize(F1_PACKET_IDS.MOTION, min)
  const fail = validatePacketSize(F1_PACKET_IDS.MOTION, min - 1)

  assert.equal(ok.ok, true)
  assert.equal(fail.ok, false)
  assert.equal(fail.expectedMinSize, min)
})
