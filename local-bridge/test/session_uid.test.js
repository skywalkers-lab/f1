import test from 'node:test'
import assert from 'node:assert/strict'
import { parseF1Packet } from '../src/f1udpParser.js'

function createHeaderPacket({ packetId = 1, sessionUid = 12345678901234567890n }) {
  const buf = Buffer.alloc(64)
  buf.writeUInt16LE(2025, 0)
  buf.writeUInt8(25, 2)
  buf.writeUInt8(1, 3)
  buf.writeUInt8(0, 4)
  buf.writeUInt8(1, 5)
  buf.writeUInt8(packetId, 6)
  buf.writeBigUInt64LE(sessionUid, 7)
  buf.writeFloatLE(1.23, 15)
  buf.writeUInt32LE(77, 19)
  buf.writeUInt32LE(77, 23)
  buf.writeUInt8(0, 27)
  buf.writeUInt8(255, 28)
  return buf
}

test('sessionUID remains lossless string from parser', () => {
  const packet = createHeaderPacket({ sessionUid: 9876543210123456789n })
  const parsed = parseF1Packet(packet)

  assert.ok(parsed)
  assert.equal(typeof parsed.header.sessionUID, 'string')
  assert.equal(parsed.header.sessionUID, '9876543210123456789')
})
