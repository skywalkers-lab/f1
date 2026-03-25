// #43 — Security hardening: signed bridge token rotation
//
// Provides HMAC-SHA256 signed tokens with expiration. Bridges present
// a token; the relay validates the signature and checks the expiry.

import crypto from 'node:crypto'

const TOKEN_TTL_MS = 3600_000 // 1 hour default

/**
 * @param {string} secret  — shared HMAC secret (env BRIDGE_TOKEN_SECRET)
 * @param {string} bridgeId
 * @param {number} [ttlMs]
 * @returns {{ token: string, expiresAt: number }}
 */
export function issueSignedToken(secret, bridgeId, ttlMs = TOKEN_TTL_MS) {
  const expiresAt = Date.now() + ttlMs
  const payload = `${bridgeId}:${expiresAt}`
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex')
  const token = Buffer.from(`${payload}:${sig}`).toString('base64url')
  return { token, expiresAt }
}

/**
 * Validate a signed token.
 * @param {string} secret
 * @param {string} token
 * @returns {{ valid: boolean, bridgeId?: string, expired?: boolean }}
 */
export function validateSignedToken(secret, token) {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf-8')
    const parts = decoded.split(':')
    if (parts.length < 3) return { valid: false }

    const sig = parts.pop()
    const expiresAtStr = parts.pop()
    const bridgeId = parts.join(':')
    const expiresAt = Number(expiresAtStr)

    if (!Number.isFinite(expiresAt)) return { valid: false }
    if (Date.now() > expiresAt) return { valid: false, bridgeId, expired: true }

    const expectedPayload = `${bridgeId}:${expiresAtStr}`
    const expectedSig = crypto.createHmac('sha256', secret).update(expectedPayload).digest('hex')

    if (!crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expectedSig, 'hex'))) {
      return { valid: false }
    }

    return { valid: true, bridgeId }
  } catch {
    return { valid: false }
  }
}

/**
 * Token rotator: issues a fresh token and keeps track of the previous
 * one for a grace period so in-flight requests aren't rejected.
 */
export class TokenRotator {
  /**
   * @param {string} secret
   * @param {string} bridgeId
   * @param {{ ttlMs?: number, graceMs?: number }} opts
   */
  constructor(secret, bridgeId, opts = {}) {
    this.secret = secret
    this.bridgeId = bridgeId
    this.ttlMs = opts.ttlMs ?? TOKEN_TTL_MS
    this.graceMs = opts.graceMs ?? 60_000
    this.current = issueSignedToken(secret, bridgeId, this.ttlMs)
    this.previous = null
    this.rotationTimer = null
  }

  /** Start automatic rotation at 80% of TTL. */
  startAutoRotation() {
    const intervalMs = Math.round(this.ttlMs * 0.8)
    this.rotationTimer = setInterval(() => {
      this.rotate()
    }, intervalMs)
    return this
  }

  rotate() {
    this.previous = this.current
    this.current = issueSignedToken(this.secret, this.bridgeId, this.ttlMs)
    // Expire previous after grace period
    setTimeout(() => {
      if (this.previous === this.current) return
      this.previous = null
    }, this.graceMs)
    return this.current
  }

  /** Validate against current OR previous (grace window). */
  validate(token) {
    const c = validateSignedToken(this.secret, token)
    if (c.valid) return c
    if (this.previous) {
      return validateSignedToken(this.secret, this.previous.token === token ? token : token)
    }
    return c
  }

  stop() {
    if (this.rotationTimer) clearInterval(this.rotationTimer)
  }
}
