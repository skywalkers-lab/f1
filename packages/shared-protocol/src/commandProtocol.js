import crypto from 'node:crypto'

export const PROTOCOL_VERSION = 1

export const COMMAND_TYPES = Object.freeze({
  BOX_THIS_LAP: 'BOX_THIS_LAP',
  PUSH: 'PUSH',
  SAVE_FUEL: 'SAVE_FUEL',
  TYRE_CHANGE: 'TYRE_CHANGE',
  PLAN_B: 'PLAN_B',
  PIT_CONFIRM: 'PIT_CONFIRM',
  ERS_DEPLOY: 'ERS_DEPLOY',
  ERS_HARVEST: 'ERS_HARVEST',
  DELTA_TARGET: 'DELTA_TARGET',
  OVERTAKE_MODE: 'OVERTAKE_MODE',
  DEFEND_MODE: 'DEFEND_MODE',
  LIFT_AND_COAST: 'LIFT_AND_COAST',
  TYRE_TEMP_MANAGE: 'TYRE_TEMP_MANAGE',
  DRS_ASSIST: 'DRS_ASSIST',
  CUSTOM: 'CUSTOM',
})

export const COMMAND_PRIORITIES = Object.freeze({
  LOW: 1,
  NORMAL: 2,
  HIGH: 3,
  CRITICAL: 4,
})

export const COMMAND_SOURCES = Object.freeze({
  ENGINEER: 'engineer',
  STRATEGY_ENGINE: 'strategy-engine',
  RACE_CONTROL_AUTOMATION: 'race-control-automation',
  USER_DEFINED_AUTOMATION: 'user-defined-automation',
})

const DEFAULT_TTL_MS = 15_000
const MIN_TTL_MS = 1
const MAX_TTL_MS = 120_000
const MAX_TEXT_LENGTH = 280
const MAX_TAGS = 16
const MAX_TAG_LENGTH = 24

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function clampInt(value, min, max, fallback) {
  const asNumber = Number(value)
  if (!Number.isFinite(asNumber)) return fallback
  return Math.max(min, Math.min(max, Math.round(asNumber)))
}

function normalizeText(value, { maxLength = MAX_TEXT_LENGTH, fallback = '' } = {}) {
  const normalized = String(value ?? fallback).replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return normalized
  return normalized.slice(0, maxLength)
}

function normalizeType(type) {
  const normalized = normalizeText(type, { maxLength: 64 }).toUpperCase()
  if (!normalized) return ''
  if (Object.values(COMMAND_TYPES).includes(normalized)) return normalized
  return COMMAND_TYPES.CUSTOM
}

function normalizeSource(source) {
  const normalized = normalizeText(source, { maxLength: 64 }).toLowerCase()
  if (!normalized) return COMMAND_SOURCES.ENGINEER
  if (Object.values(COMMAND_SOURCES).includes(normalized)) return normalized
  return COMMAND_SOURCES.ENGINEER
}

function normalizePayload(payload) {
  if (!isObject(payload)) return {}
  return { ...payload }
}

function normalizeTags(input) {
  if (!Array.isArray(input)) return []
  const tags = []
  const seen = new Set()
  for (const item of input) {
    const normalized = normalizeText(item, { maxLength: MAX_TAG_LENGTH }).toLowerCase()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    tags.push(normalized)
    if (tags.length >= MAX_TAGS) break
  }
  return tags
}

function buildStableCommandId({ type, roomId, createdAtMs, source }) {
  const digest = crypto
    .createHash('sha1')
    .update(`${type}|${roomId || ''}|${createdAtMs}|${source}`)
    .digest('hex')
    .slice(0, 12)
  return `cmd_${digest}`
}

export function clampCommandTtl(ttlMs, fallback = DEFAULT_TTL_MS) {
  return clampInt(ttlMs, MIN_TTL_MS, MAX_TTL_MS, fallback)
}

export function isCommandExpired(command, nowMs = Date.now()) {
  if (!isObject(command)) return true
  const expiresAtMs = Number(command.expiresAtMs)
  if (!Number.isFinite(expiresAtMs)) return true
  return nowMs >= expiresAtMs
}

export function remainingCommandTtl(command, nowMs = Date.now()) {
  if (!isObject(command)) return 0
  const expiresAtMs = Number(command.expiresAtMs)
  if (!Number.isFinite(expiresAtMs)) return 0
  return Math.max(0, expiresAtMs - nowMs)
}

export function validateAndNormalizeCommand(input, nowMs = Date.now()) {
  if (!isObject(input)) {
    return { ok: false, error: 'command must be an object' }
  }

  const type = normalizeType(input.type)
  if (!type) {
    return { ok: false, error: 'command.type is required' }
  }

  const createdAtMs = clampInt(input.createdAtMs, 0, Number.MAX_SAFE_INTEGER, nowMs)
  const ttlMs = clampCommandTtl(input.ttlMs, DEFAULT_TTL_MS)
  const expiresAtMs = createdAtMs + ttlMs
  const priority = clampInt(input.priority, COMMAND_PRIORITIES.LOW, COMMAND_PRIORITIES.CRITICAL, COMMAND_PRIORITIES.NORMAL)

  const roomId = normalizeText(input.roomId, { maxLength: 96 }) || null
  const source = normalizeSource(input.source)

  const command = {
    protocolVersion: PROTOCOL_VERSION,
    id: normalizeText(input.id, { maxLength: 96 }) || buildStableCommandId({ type, roomId, createdAtMs, source }),
    roomId,
    type,
    priority,
    ttlMs,
    createdAtMs,
    expiresAtMs,
    source,
    title: normalizeText(input.title || type.replaceAll('_', ' '), { maxLength: 80 }),
    body: normalizeText(input.body, { maxLength: MAX_TEXT_LENGTH }),
    payload: normalizePayload(input.payload),
    tags: normalizeTags(input.tags),
    requireAck: Boolean(input.requireAck),
    targetDriverIndex: Number.isInteger(input.targetDriverIndex) ? input.targetDriverIndex : null,
    meta: normalizePayload(input.meta),
  }

  if (command.targetDriverIndex !== null && (command.targetDriverIndex < 0 || command.targetDriverIndex > 21)) {
    return { ok: false, error: 'targetDriverIndex must be in range 0..21' }
  }

  return { ok: true, command }
}
