import crypto from 'node:crypto'

const DEFAULT_AUTH_TTL_MS = 15 * 60_000

function b64url(input) {
  return Buffer.from(input).toString('base64url')
}

function b64urlJson(obj) {
  return b64url(JSON.stringify(obj))
}

function hmac(secret, data) {
  return crypto.createHmac('sha256', secret).update(data).digest('base64url')
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex')
  const derived = crypto.scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${derived}`
}

export function verifyPassword(password, storedHash) {
  const [salt, expectedHex] = String(storedHash || '').split(':')
  if (!salt || !expectedHex) return false
  const actualHex = crypto.scryptSync(password, salt, 64).toString('hex')
  try {
    return crypto.timingSafeEqual(Buffer.from(actualHex, 'hex'), Buffer.from(expectedHex, 'hex'))
  } catch {
    return false
  }
}

export function issueRoomJwt(secret, claims, ttlMs = DEFAULT_AUTH_TTL_MS) {
  const header = { alg: 'HS256', typ: 'JWT' }
  const nowSec = Math.floor(Date.now() / 1000)
  const payload = {
    ...claims,
    iat: nowSec,
    exp: nowSec + Math.max(30, Math.floor(ttlMs / 1000)),
    jti: crypto.randomUUID(),
  }
  const h = b64urlJson(header)
  const p = b64urlJson(payload)
  const sig = hmac(secret, `${h}.${p}`)
  return `${h}.${p}.${sig}`
}

export function verifyRoomJwt(secret, token) {
  try {
    const [h, p, sig] = String(token || '').split('.')
    if (!h || !p || !sig) return { valid: false }
    const expected = hmac(secret, `${h}.${p}`)
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      return { valid: false }
    }
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf-8'))
    const nowSec = Math.floor(Date.now() / 1000)
    if (!payload.exp || nowSec > Number(payload.exp)) {
      return { valid: false, expired: true }
    }
    return { valid: true, payload }
  } catch {
    return { valid: false }
  }
}
