import { describe, expect, it } from 'vitest'
import { encode } from '@msgpack/msgpack'
import { decodeRelayMessage } from './wsDecode'

describe('decodeRelayMessage', () => {
  it('decodes msgpack ArrayBuffer payload', () => {
    const frame = {
      type: 'state',
      payload: {
        session_uid: '12345678901234567890',
        last_frame_identifier: 99,
      },
    }
    const packed = encode(frame)
    const arrayBuffer = packed.buffer.slice(packed.byteOffset, packed.byteOffset + packed.byteLength)

    const decoded = decodeRelayMessage(arrayBuffer)
    expect(decoded).toEqual(frame)
  })

  it('decodes json string payload', () => {
    const frame = {
      type: 'state',
      payload: {
        session_uid: '9',
      },
    }

    const decoded = decodeRelayMessage(JSON.stringify(frame))
    expect(decoded).toEqual(frame)
  })
})
