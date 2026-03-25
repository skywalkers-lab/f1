// #35 — Optional telemetry compression over WS (msgpack)
//
// Provides encode/decode helpers for msgpack binary frames.
// Falls back to JSON if msgpack is not requested by the client.

// Minimal msgpack encoder/decoder — no external deps needed for simple
// nested objects with strings, numbers, arrays, booleans, null.

const TEXT_ENCODER = new TextEncoder()
const TEXT_DECODER = new TextDecoder()

/** Encode a JS value to msgpack Uint8Array */
export function msgpackEncode(value) {
  const parts = []
  _encode(value, parts)
  const totalLen = parts.reduce((s, p) => s + p.length, 0)
  const out = new Uint8Array(totalLen)
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}

function _encode(val, parts) {
  if (val === null || val === undefined) {
    parts.push(new Uint8Array([0xc0]))
    return
  }
  if (typeof val === 'boolean') {
    parts.push(new Uint8Array([val ? 0xc3 : 0xc2]))
    return
  }
  if (typeof val === 'number') {
    if (Number.isInteger(val)) {
      if (val >= 0 && val <= 127) {
        parts.push(new Uint8Array([val]))
      } else if (val < 0 && val >= -32) {
        parts.push(new Uint8Array([val & 0xff]))
      } else if (val >= 0 && val <= 0xffff) {
        const b = new Uint8Array(3)
        b[0] = 0xcd
        b[1] = (val >> 8) & 0xff
        b[2] = val & 0xff
        parts.push(b)
      } else {
        // float64 fallback for large ints
        const b = new Uint8Array(9)
        b[0] = 0xcb
        const dv = new DataView(b.buffer, b.byteOffset)
        dv.setFloat64(1, val, false)
        parts.push(b)
      }
    } else {
      const b = new Uint8Array(9)
      b[0] = 0xcb
      const dv = new DataView(b.buffer, b.byteOffset)
      dv.setFloat64(1, val, false)
      parts.push(b)
    }
    return
  }
  if (typeof val === 'string') {
    const encoded = TEXT_ENCODER.encode(val)
    const len = encoded.length
    if (len <= 31) {
      parts.push(new Uint8Array([0xa0 | len]))
    } else if (len <= 0xffff) {
      parts.push(new Uint8Array([0xda, (len >> 8) & 0xff, len & 0xff]))
    } else {
      parts.push(new Uint8Array([0xdb, (len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff]))
    }
    parts.push(encoded)
    return
  }
  if (Array.isArray(val)) {
    const len = val.length
    if (len <= 15) {
      parts.push(new Uint8Array([0x90 | len]))
    } else if (len <= 0xffff) {
      parts.push(new Uint8Array([0xdc, (len >> 8) & 0xff, len & 0xff]))
    } else {
      parts.push(new Uint8Array([0xdd, (len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff]))
    }
    for (const item of val) _encode(item, parts)
    return
  }
  if (typeof val === 'object') {
    const keys = Object.keys(val)
    const len = keys.length
    if (len <= 15) {
      parts.push(new Uint8Array([0x80 | len]))
    } else if (len <= 0xffff) {
      parts.push(new Uint8Array([0xde, (len >> 8) & 0xff, len & 0xff]))
    } else {
      parts.push(new Uint8Array([0xdf, (len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff]))
    }
    for (const key of keys) {
      _encode(key, parts)
      _encode(val[key], parts)
    }
  }
}

/** Decode a msgpack buffer to JS value */
export function msgpackDecode(buffer) {
  const view = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  const result = _decode(view, 0)
  return result.value
}

function _decode(view, offset) {
  const byte = view[offset]

  // positive fixint
  if (byte <= 0x7f) return { value: byte, offset: offset + 1 }

  // negative fixint
  if (byte >= 0xe0) return { value: byte - 256, offset: offset + 1 }

  // fixstr
  if ((byte & 0xe0) === 0xa0) {
    const len = byte & 0x1f
    const str = TEXT_DECODER.decode(view.subarray(offset + 1, offset + 1 + len))
    return { value: str, offset: offset + 1 + len }
  }

  // fixarray
  if ((byte & 0xf0) === 0x90) {
    const len = byte & 0x0f
    return _decodeArray(view, offset + 1, len)
  }

  // fixmap
  if ((byte & 0xf0) === 0x80) {
    const len = byte & 0x0f
    return _decodeMap(view, offset + 1, len)
  }

  switch (byte) {
    case 0xc0: return { value: null, offset: offset + 1 }
    case 0xc2: return { value: false, offset: offset + 1 }
    case 0xc3: return { value: true, offset: offset + 1 }
    case 0xcd: {
      const val = (view[offset + 1] << 8) | view[offset + 2]
      return { value: val, offset: offset + 3 }
    }
    case 0xcb: {
      const dv = new DataView(view.buffer, view.byteOffset + offset + 1, 8)
      return { value: dv.getFloat64(0, false), offset: offset + 9 }
    }
    case 0xda: {
      const len = (view[offset + 1] << 8) | view[offset + 2]
      const str = TEXT_DECODER.decode(view.subarray(offset + 3, offset + 3 + len))
      return { value: str, offset: offset + 3 + len }
    }
    case 0xdb: {
      const len = (view[offset + 1] << 24) | (view[offset + 2] << 16) | (view[offset + 3] << 8) | view[offset + 4]
      const str = TEXT_DECODER.decode(view.subarray(offset + 5, offset + 5 + len))
      return { value: str, offset: offset + 5 + len }
    }
    case 0xdc: {
      const len = (view[offset + 1] << 8) | view[offset + 2]
      return _decodeArray(view, offset + 3, len)
    }
    case 0xdd: {
      const len = (view[offset + 1] << 24) | (view[offset + 2] << 16) | (view[offset + 3] << 8) | view[offset + 4]
      return _decodeArray(view, offset + 5, len)
    }
    case 0xde: {
      const len = (view[offset + 1] << 8) | view[offset + 2]
      return _decodeMap(view, offset + 3, len)
    }
    case 0xdf: {
      const len = (view[offset + 1] << 24) | (view[offset + 2] << 16) | (view[offset + 3] << 8) | view[offset + 4]
      return _decodeMap(view, offset + 5, len)
    }
    default:
      return { value: null, offset: offset + 1 }
  }
}

function _decodeArray(view, offset, len) {
  const arr = []
  for (let i = 0; i < len; i++) {
    const r = _decode(view, offset)
    arr.push(r.value)
    offset = r.offset
  }
  return { value: arr, offset }
}

function _decodeMap(view, offset, len) {
  const obj = {}
  for (let i = 0; i < len; i++) {
    const kr = _decode(view, offset)
    offset = kr.offset
    const vr = _decode(view, offset)
    offset = vr.offset
    obj[kr.value] = vr.value
  }
  return { value: obj, offset }
}

/**
 * Negotiate compression mode from WS query params.
 * @param {URLSearchParams} params
 * @returns {'msgpack' | 'json'}
 */
export function negotiateEncoding(params) {
  const enc = (params.get('encoding') || 'json').toLowerCase()
  return enc === 'msgpack' ? 'msgpack' : 'json'
}

/**
 * Serialize a frame in the requested encoding.
 * @param {object} frame
 * @param {'msgpack' | 'json'} encoding
 * @returns {string | Uint8Array}
 */
export function serializeFrame(frame, encoding) {
  if (encoding === 'msgpack') return msgpackEncode(frame)
  return JSON.stringify(frame)
}
