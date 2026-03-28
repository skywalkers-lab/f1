import test from 'node:test'
import assert from 'node:assert/strict'
import { decode } from '@msgpack/msgpack'
import { decodeEnvelope, encodeFrame } from '../src/msgpack.js'

test('msgpack frame roundtrip works', () => {
  const frame = {
    type: 'state',
    payload: {
      session_uid: '12345678901234567890',
      last_frame_identifier: 42,
    },
  }

  const encoded = encodeFrame(frame, 'msgpack')
  assert.equal(encoded.isBinary, true)
  assert.ok(Buffer.isBuffer(encoded.data))

  const decoded = decode(encoded.data)
  assert.deepEqual(decoded, frame)
})

test('json fallback frame works', () => {
  const frame = { type: 'state', payload: { session_uid: '9' } }
  const encoded = encodeFrame(frame, 'json')

  assert.equal(encoded.isBinary, false)
  assert.equal(typeof encoded.data, 'string')
  assert.deepEqual(JSON.parse(encoded.data), frame)
})

test('decodeEnvelope handles both encodings', () => {
  const jsonRaw = JSON.stringify({ type: 'state', payload: { session_uid: '1' } })
  const jsonDecoded = decodeEnvelope(jsonRaw)
  assert.equal(jsonDecoded?.payload?.session_uid, '1')

  const msgpackPayload = Buffer.from(encodeFrame({ type: 'state', payload: { session_uid: '2' } }, 'msgpack').data)
  const msgpackDecoded = decodeEnvelope(msgpackPayload, 'msgpack')
  assert.equal(msgpackDecoded?.payload?.session_uid, '2')
})
