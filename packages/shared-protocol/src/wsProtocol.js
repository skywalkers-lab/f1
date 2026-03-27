import crypto from 'node:crypto'
import { PROTOCOL_VERSION } from './commandProtocol.js'

export const WS_MESSAGE_TYPES = Object.freeze({
  HELLO: 'HELLO',
  JOIN_ROOM: 'JOIN_ROOM',
  ROOM_STATE: 'ROOM_STATE',
  TELEMETRY_FRAME: 'TELEMETRY_FRAME',
  TELEMETRY_HEALTH: 'TELEMETRY_HEALTH',
  COMMAND: 'COMMAND',
  COMMAND_ACK: 'COMMAND_ACK',
  RADIO_LOG: 'RADIO_LOG',
  EVENT_LOG: 'EVENT_LOG',
  ACK: 'ACK',
  ERROR: 'ERROR',
  HEARTBEAT: 'HEARTBEAT',
})

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizeString(value, max = 128) {
  const normalized = String(value ?? '').trim()
  return normalized.length > max ? normalized.slice(0, max) : normalized
}

function buildMessageId(type, sentAtMs) {
  const digest = crypto
    .createHash('sha1')
    .update(`${type}|${sentAtMs}|${Math.random()}`)
    .digest('hex')
    .slice(0, 10)
  return `msg_${digest}`
}

export function buildProtocolEnvelope(type, payload, options = {}) {
  const sentAtMs = Number.isFinite(Number(options.sentAtMs))
    ? Number(options.sentAtMs)
    : Date.now()

  return {
    protocolVersion: Number(options.protocolVersion || PROTOCOL_VERSION),
    type: normalizeString(type, 64),
    roomId: normalizeString(options.roomId, 96) || null,
    role: normalizeString(options.role, 32) || null,
    sentAtMs,
    messageId: normalizeString(options.messageId, 96) || buildMessageId(type, sentAtMs),
    correlationId: normalizeString(options.correlationId, 96) || null,
    payload: payload ?? {},
  }
}

export function validateProtocolEnvelope(input) {
  if (!isObject(input)) return { ok: false, error: 'envelope must be an object' }

  const type = normalizeString(input.type, 64)
  if (!type) return { ok: false, error: 'envelope.type is required' }

  const version = Number(input.protocolVersion)
  if (!Number.isFinite(version) || version < 1) {
    return { ok: false, error: 'envelope.protocolVersion must be >= 1' }
  }

  const sentAtMs = Number(input.sentAtMs)
  if (!Number.isFinite(sentAtMs) || sentAtMs < 0) {
    return { ok: false, error: 'envelope.sentAtMs is invalid' }
  }

  const normalized = {
    protocolVersion: Math.round(version),
    type,
    roomId: normalizeString(input.roomId, 96) || null,
    role: normalizeString(input.role, 32) || null,
    sentAtMs,
    messageId: normalizeString(input.messageId, 96) || buildMessageId(type, sentAtMs),
    correlationId: normalizeString(input.correlationId, 96) || null,
    payload: isObject(input.payload) || Array.isArray(input.payload) ? input.payload : {},
  }

  return { ok: true, envelope: normalized }
}
