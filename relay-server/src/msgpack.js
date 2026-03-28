import { decode, encode } from '@msgpack/msgpack'

/**
 * Negotiate wire encoding from query params.
 * Defaults to msgpack for lower bandwidth and parse cost.
 */
export function negotiateEncoding(params) {
  const enc = String(params.get('encoding') || 'msgpack').toLowerCase()
  return enc === 'json' ? 'json' : 'msgpack'
}

/**
 * Encode frame for websocket send.
 * @returns {{ data: Buffer|string, isBinary: boolean }}
 */
export function encodeFrame(frame, encoding) {
  if (encoding === 'json') {
    return { data: JSON.stringify(frame), isBinary: false }
  }

  return {
    data: Buffer.from(encode(frame)),
    isBinary: true,
  }
}

/**
 * Decode raw incoming message payload.
 * Used for future non-JSON bridge payload support.
 */
export function decodeEnvelope(raw, encodingHint = 'json') {
  try {
    if (typeof raw === 'string') {
      return JSON.parse(raw)
    }

    if (raw instanceof Buffer) {
      return encodingHint === 'msgpack' ? decode(raw) : JSON.parse(raw.toString('utf8'))
    }

    if (raw instanceof Uint8Array) {
      return encodingHint === 'msgpack' ? decode(raw) : JSON.parse(Buffer.from(raw).toString('utf8'))
    }

    if (raw instanceof ArrayBuffer) {
      const view = new Uint8Array(raw)
      return encodingHint === 'msgpack' ? decode(view) : JSON.parse(Buffer.from(view).toString('utf8'))
    }
  } catch {
    return null
  }

  return null
}

export function serializeFrame(frame, encoding) {
  return encodeFrame(frame, encoding).data
}
