import path from 'node:path'
import dotenv from 'dotenv'

dotenv.config()

function envNumber(name, fallback) {
  const raw = process.env[name]
  if (!raw) return fallback
  const n = Number(raw)
  return Number.isFinite(n) ? n : fallback
}

const tokens = (process.env.BRIDGE_TOKENS || '')
  .split(',')
  .map((v) => v.trim())
  .filter(Boolean)

if (tokens.length === 0) {
  console.warn('[relay] BRIDGE_TOKENS is empty. No bridge can publish data.')
}

export const config = {
  host: process.env.HOST || '0.0.0.0',
  port: envNumber('PORT', 8080),
  bridgeTokens: new Set(tokens),
  maxStateAgeMs: envNumber('MAX_STATE_AGE_MS', 12000),
  streamHz: envNumber('STREAM_HZ', 15),
  maxSessionIdleMs: envNumber('MAX_SESSION_IDLE_MS', 30 * 60 * 1000),
  stateBufferSize: envNumber('STATE_BUFFER_SIZE', 120),
  corsOrigin: process.env.CORS_ORIGIN || '*',
  defaultSessionId: process.env.DEFAULT_SESSION_ID || 'public',
  rateLimitWindowMs: envNumber('RATE_LIMIT_WINDOW_MS', 60_000),
  rateLimitMaxPerWindow: envNumber('RATE_LIMIT_MAX_PER_WINDOW', 80),
  enablePrometheusMetrics: String(process.env.ENABLE_PROMETHEUS_METRICS || '1') !== '0',
  modelPath: path.resolve(process.cwd(), process.env.MODEL_PATH || './data/strategy-model.json'),
  feedbackLogPath: path.resolve(process.cwd(), process.env.FEEDBACK_LOG_PATH || './data/strategy-feedback.ndjson'),
  bridgeTokenSecret: process.env.BRIDGE_TOKEN_SECRET || '',
  roomAuthSecret: process.env.ROOM_AUTH_SECRET || process.env.BRIDGE_TOKEN_SECRET || 'dev-room-auth-secret',
  roomAuthTtlMs: envNumber('ROOM_AUTH_TTL_MS', 15 * 60_000),
  commandRateLimitPer10s: envNumber('COMMAND_RATE_LIMIT_PER_10S', 20),
  commandBufferSize: envNumber('COMMAND_BUFFER_SIZE', 200),
}
