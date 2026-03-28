import http from 'node:http'
import { URL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { WebSocketServer } from 'ws'
import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from 'prom-client'
import { config } from './config.js'
import { StrategyTrainer } from './strategyTrainer.js'
import { BackpressureQueue } from './backpressure.js'
import { decodeEnvelope, encodeFrame, negotiateEncoding } from './msgpack.js'
import { validateSignedToken } from './tokenRotation.js'
import { hashPassword, issueRoomJwt, verifyPassword, verifyRoomJwt } from './auth.js'
import { initOtel } from './otel.js'

const trainer = new StrategyTrainer({
  modelPath: config.modelPath,
  feedbackLogPath: config.feedbackLogPath,
})

const otel = await initOtel('pitwall-relay-server')

const sessions = new Map()
const viewers = new Set()
const bridges = new Set()
const sessionTickMs = Math.max(16, Math.round(1000 / Math.max(1, config.streamHz)))
const rateLimitWindow = new Map()
const COMMAND_TYPES = new Set(['BOX', 'PUSH', 'SAVE', 'TYRE', 'INFO'])
const COMMAND_PRIORITIES = new Set(['critical', 'high', 'normal'])

const serverMetrics = {
  httpRequests: 0,
  http4xx: 0,
  http5xx: 0,
  wsConnections: 0,
  wsMessages: 0,
  wsDroppedOutOfOrder: 0,
  wsDroppedDuplicate: 0,
  wsAccepted: 0,
  rateLimited: 0,
  commandSubmitted: 0,
  commandAcked: 0,
  authRejected: 0,
}

const promRegistry = new Registry()
collectDefaultMetrics({ register: promRegistry })

const metricWsConnectedClients = new Gauge({
  name: 'pitwall_ws_connected_clients',
  help: 'Connected websocket clients by role',
  labelNames: ['role'],
  registers: [promRegistry],
})
const metricSessionActiveCount = new Gauge({
  name: 'pitwall_session_active_count',
  help: 'Active session count',
  registers: [promRegistry],
})
const metricFanoutDuration = new Histogram({
  name: 'pitwall_fanout_frame_duration_seconds',
  help: 'Frame fanout duration in seconds',
  buckets: [0.001, 0.003, 0.005, 0.01, 0.02, 0.05, 0.1],
  registers: [promRegistry],
})
const metricIngestDrop = new Counter({
  name: 'pitwall_ingest_drop_total',
  help: 'Dropped ingest frames by reason',
  labelNames: ['reason'],
  registers: [promRegistry],
})
const metricWsSendBytes = new Counter({
  name: 'pitwall_ws_send_bytes_total',
  help: 'Total websocket bytes sent by encoding',
  labelNames: ['encoding'],
  registers: [promRegistry],
})
const metricStateAgeMs = new Gauge({
  name: 'pitwall_state_age_ms',
  help: 'Latest state age in milliseconds',
  registers: [promRegistry],
})

metricWsConnectedClients.set({ role: 'viewer' }, 0)
metricWsConnectedClients.set({ role: 'bridge' }, 0)

function parseAuthorizationBearer(req) {
  const raw = String(req.headers.authorization || '')
  if (!raw.toLowerCase().startsWith('bearer ')) return ''
  return raw.slice(7).trim()
}

function getRoomAuthToken(url, req) {
  return String(url.searchParams.get('auth') || parseAuthorizationBearer(req) || '')
}

function clampCommandTtl(ttlMs) {
  const n = Number(ttlMs)
  if (!Number.isFinite(n)) return 3000
  return Math.min(4000, Math.max(2000, Math.round(n)))
}

function buildProtocolEnvelope(type, room, sourceClientId, payload) {
  return {
    type,
    version: 1,
    sessionId: room.sessionId,
    sourceClientId,
    ts: Date.now(),
    ...payload,
  }
}

function validateCommandShape(command) {
  if (!command || typeof command !== 'object') return { ok: false, reason: 'command is required' }
  const type = String(command.type || '').toUpperCase()
  const priority = String(command.priority || '').toLowerCase()
  const message = String(command.message || '').trim()
  if (!COMMAND_TYPES.has(type)) return { ok: false, reason: 'invalid command.type' }
  if (!COMMAND_PRIORITIES.has(priority)) return { ok: false, reason: 'invalid command.priority' }
  if (!message) return { ok: false, reason: 'command.message is required' }
  return {
    ok: true,
    normalized: {
      type,
      priority,
      message,
      timestamp: Number(command.timestamp) || Date.now(),
      ttlMs: clampCommandTtl(command.ttlMs),
      idempotencyKey: String(command.idempotencyKey || ''),
    },
  }
}

function generateTraceId() {
  return randomUUID()
}

function writeTrace(res, traceId) {
  if (traceId) res.setHeader('X-Trace-Id', traceId)
}

function logInfo(message, meta = {}) {
  console.log(JSON.stringify({ level: 'info', ts: nowIso(), message, ...meta }))
}

function logWarn(message, meta = {}) {
  console.warn(JSON.stringify({ level: 'warn', ts: nowIso(), message, ...meta }))
}

function isRateLimited({ key, maxHits = config.rateLimitMaxPerWindow, windowMs = config.rateLimitWindowMs }) {
  const now = Date.now()
  const bucket = rateLimitWindow.get(key)
  if (!bucket || now - bucket.startedAt >= windowMs) {
    rateLimitWindow.set(key, { startedAt: now, hits: 1 })
    return false
  }
  bucket.hits += 1
  if (bucket.hits > maxHits) return true
  return false
}

function viewerFeatureFlags(role) {
  if (role === 'engineer') {
    return {
      canSeeStrategyInternals: true,
      canSubmitFeedback: true,
      canViewDiagnostics: true,
      canControlReplay: true,
    }
  }
  if (role === 'driver') {
    return {
      canSeeStrategyInternals: false,
      canSubmitFeedback: false,
      canViewDiagnostics: false,
      canControlReplay: false,
    }
  }
  return {
    canSeeStrategyInternals: false,
    canSubmitFeedback: false,
    canViewDiagnostics: false,
    canControlReplay: true,
  }
}

function normalizeSessionId(raw) {
  const value = String(raw || '').trim()
  return value || config.defaultSessionId
}

function getOrCreateSession(sessionId) {
  const key = normalizeSessionId(sessionId)
  let room = sessions.get(key)
  if (room) return room

  room = {
    sessionId: key,
    passwordHash: null,
    hostDriverId: '',
    engineers: new Set(),
    participants: new Map(),
    latestState: null,
    latestMeta: null,
    viewers: new Set(),
    bridges: new Set(),
    sseClients: new Set(),
    sourceWatermarks: new Map(),
    pendingFrame: null,
    dirty: false,
    lastActivityTs: Date.now(),
    lastEventId: 0,
    recentFrames: [],
    commandHistory: [],
    commandDedupe: new Set(),
    sourceQuality: new Map(),
    metrics: {
      accepted: 0,
      droppedOutOfOrder: 0,
      droppedDuplicate: 0,
      throttledFlush: 0,
      commandsSubmitted: 0,
      commandsAcked: 0,
    },
  }

  room.flushTimer = setInterval(() => {
    if (!room.dirty || !room.pendingFrame) return
    const frame = room.pendingFrame
    room.pendingFrame = null
    room.dirty = false
    room.metrics.throttledFlush += 1
    fanoutSessionFrame(room, frame)
  }, sessionTickMs)

  sessions.set(key, room)
  metricSessionActiveCount.set(sessions.size)
  return room
}

function roomSummary(room) {
  const stateAgeMs = room.latestMeta ? Date.now() - room.latestMeta.ts : null
  return {
    sessionId: room.sessionId,
    protected: !!room.passwordHash,
    hostDriverId: room.hostDriverId || null,
    engineers: room.engineers.size,
    participants: room.participants.size,
    hasState: !!room.latestState,
    stateAgeMs,
    viewers: room.viewers.size,
    bridges: room.bridges.size,
    sseClients: room.sseClients.size,
    metrics: room.metrics,
  }
}

function nowIso() {
  return new Date().toISOString()
}

function withCors(req, res) {
  const origin = req.headers.origin || ''
  const allowOrigin = config.corsOrigin === '*' ? '*' : origin && config.corsOrigin.split(',').map((v) => v.trim()).includes(origin) ? origin : config.corsOrigin
  res.setHeader('Access-Control-Allow-Origin', allowOrigin)
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Bridge-Token')
  res.setHeader('Access-Control-Max-Age', '86400')
}

function extractContextFromState(state) {
  const player = state?.player || {}
  const strategy = state?.strategy || {}
  const keyInputs = strategy?.key_inputs || {}
  const pace = state?.pace || {}
  const recent = Array.isArray(pace.recent) ? pace.recent : []
  const last = recent[recent.length - 1]
  const prev = recent[recent.length - 2]

  const leader = Array.isArray(state?.leaderboard) ? state.leaderboard.find((r) => Number(r.position) === 1) : null
  const playerRow = Array.isArray(state?.leaderboard)
    ? state.leaderboard.find((r) => Number(r.car_index) === Number(state?.player_car_index))
    : null

  const nearbyGaps = Array.isArray(state?.leaderboard)
    ? state.leaderboard
        .map((r) => Number(r.gap_to_player_s))
        .filter((v) => Number.isFinite(v) && Math.abs(v) < 7)
        .map((v) => Math.abs(v))
    : []

  const totalLaps = Number(state?.total_laps || keyInputs.total_laps || 58)
  const lap = Number(player.lap || 1)
  const fuel = Number(player.fuel || 0)
  const lapsRemaining = Math.max(0, totalLaps - lap)
  const fuelBurnPerLap = Number(keyInputs.fuel_delta_per_lap || Math.max(0.5, fuel / Math.max(1, lapsRemaining)))

  return {
    streamKey: state?.session_uid || 'relay',
    sessionUid: state?.session_uid,
    lap: player.lap || 1,
    totalLaps,
    lapsRemaining,
    playerPosition: player.position || 22,
    fuel,
    maxFuel: fuel + fuelBurnPerLap * lapsRemaining,
    fuelBurnPerLap,
    ers: player.ers || 0,
    maxErs: 4_000_000,
    currentCompound: player.tyre_compound || 'MEDIUM',
    tyreWear: Number(keyInputs.tyre_wear_mean || Math.min(1, lap / 35)),
    tyreTemp: Number(keyInputs.tyre_temp || 92),
    score: strategy.score || 0,
    trafficDensity: Number(keyInputs.traffic_density || 0),
    gapAhead: Number(keyInputs.gap_ahead_s || leader?.gap_to_player_s || 5),
    gapBehind: Number(keyInputs.gap_behind_s || Math.abs(playerRow?.gap_to_player_s || 5)),
    nearbyGaps,
    predictedPitRejoinGap: Number(keyInputs.predicted_rejoin_gap || 2.8),
    pitWindowOpen: String(keyInputs.pit_window_status || 'CLOSED') === 'OPEN',
    scProbability: Number(keyInputs.sc_probability || (state?.race_control_state === 'SC_OR_VSC' ? 0.34 : 0.05)),
    vscProbability: Number(keyInputs.vsc_probability || (state?.race_control_state === 'SC_OR_VSC' ? 0.28 : 0.08)),
    trackId: state?.track || 'TRACK_UNKNOWN',
    baseLapTime: Number(pace.best_lap_ms ? pace.best_lap_ms / 1000 : 90),
    lastLapTime: Number(player.last_lap_ms ? player.last_lap_ms / 1000 : 90),
    sector1Time: Number(last?.lap_time_ms ? last.lap_time_ms / 3000 : 30),
    sector2Time: Number(prev?.lap_time_ms ? prev.lap_time_ms / 3000 : 30),
    sector3Time: Number(player.current_lap_ms ? player.current_lap_ms / 3000 : 30),
    degradationSlope: Number(keyInputs.degradation_slope || 0.03),
  }
}

function fanoutSessionFrame(room, frame) {
  const fanoutTimer = metricFanoutDuration.startTimer()
  const span = otel.tracer.startSpan('relay.fanout')
  const jsonFrame = {
    ...frame,
    meta: {
      ...(frame.meta || {}),
      encoding: 'json',
      serverTs: Date.now(),
    },
  }
  const msgpackFrame = {
    ...frame,
    meta: {
      ...(frame.meta || {}),
      encoding: 'msgpack',
      serverTs: Date.now(),
    },
  }
  const jsonEncoded = encodeFrame(jsonFrame, 'json')
  const msgpackEncoded = encodeFrame(msgpackFrame, 'msgpack')

  for (const ws of room.viewers) {
    if (ws.readyState !== ws.OPEN) continue
    const encoded = ws.encoding === 'msgpack' ? msgpackEncoded : jsonEncoded
    const bytes = typeof encoded.data === 'string' ? Buffer.byteLength(encoded.data) : encoded.data.length
    metricWsSendBytes.inc({ encoding: ws.encoding === 'msgpack' ? 'msgpack' : 'json' }, bytes)
    if (ws._bpQueue) {
      ws._bpQueue.enqueue(encoded.data, encoded.isBinary)
    } else {
      try { ws.send(encoded.data, { binary: encoded.isBinary }) } catch { /* closed mid-send */ }
    }
  }
  for (const ws of room.bridges) {
    if (ws.readyState === ws.OPEN) ws.send(jsonEncoded.data)
  }
  for (const res of room.sseClients) {
    try {
      res.write(`id: ${frame.eventId}\n`)
      res.write('event: state\n')
      res.write(`data: ${jsonEncoded.data}\n\n`)
    } catch {
      room.sseClients.delete(res)
    }
  }

  span.end()
  fanoutTimer()
}

function broadcastToViewers(room, predicate, frame) {
  const serialized = JSON.stringify(frame)
  for (const ws of room.viewers) {
    if (ws.readyState !== ws.OPEN) continue
    if (!predicate(ws)) continue
    if (ws._bpQueue) ws._bpQueue.enqueue(serialized)
    else {
      try { ws.send(serialized) } catch { /* noop */ }
    }
  }
}

function broadcastSessionEvent(room, eventType, extra = {}) {
  const frame = buildProtocolEnvelope('session_event', room, 'server', {
    eventType,
    ...extra,
  })
  broadcastToViewers(room, () => true, frame)
}

function publishToRoom(room, payload, meta) {
  room.latestState = payload
  room.latestMeta = meta
  room.lastActivityTs = Date.now()
  room.metrics.accepted += 1
  serverMetrics.wsAccepted += 1

  room.lastEventId += 1
  const frame = {
    type: 'state',
    eventId: room.lastEventId,
    sessionId: room.sessionId,
    payload,
    meta: {
      ...meta,
      eventId: room.lastEventId,
      sessionUID: String(payload?.session_uid || ''),
      frameId: Number(payload?.last_frame_identifier || meta?.frameId || 0),
      serverTs: Date.now(),
    },
  }

  if (room.latestMeta?.ts) {
    metricStateAgeMs.set(Math.max(0, Date.now() - room.latestMeta.ts))
  }

  room.recentFrames.push(frame)
  if (room.recentFrames.length > config.stateBufferSize) {
    room.recentFrames.shift()
  }

  room.pendingFrame = frame
  room.dirty = true
}

function shouldAcceptBridgeFrame(room, source, seq, frameId) {
  const key = String(source || 'bridge')
  const wm = room.sourceWatermarks.get(key) || { lastSeq: -1, lastFrameId: -1 }
  const hasSeq = Number.isFinite(seq)
  const hasFrame = Number.isFinite(frameId)

  if (hasSeq && seq <= wm.lastSeq) {
    room.metrics.droppedOutOfOrder += 1
    serverMetrics.wsDroppedOutOfOrder += 1
    metricIngestDrop.inc({ reason: 'out_of_order' })
    return false
  }
  if (hasFrame && frameId === wm.lastFrameId) {
    room.metrics.droppedDuplicate += 1
    serverMetrics.wsDroppedDuplicate += 1
    metricIngestDrop.inc({ reason: 'duplicate' })
    return false
  }
  if (hasFrame && frameId < wm.lastFrameId) {
    room.metrics.droppedOutOfOrder += 1
    serverMetrics.wsDroppedOutOfOrder += 1
    metricIngestDrop.inc({ reason: 'frame_regression' })
    return false
  }

  room.sourceWatermarks.set(key, {
    lastSeq: hasSeq ? seq : wm.lastSeq,
    lastFrameId: hasFrame ? frameId : wm.lastFrameId,
  })
  return true
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
      if (raw.length > 1_000_000) {
        reject(new Error('payload too large'))
      }
    })
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {})
      } catch {
        reject(new Error('invalid json'))
      }
    })
    req.on('error', reject)
  })
}

function writeJson(res, code, payload, traceId = '') {
  if (code >= 400 && code < 500) serverMetrics.http4xx += 1
  if (code >= 500) serverMetrics.http5xx += 1
  if (traceId) writeTrace(res, traceId)
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(traceId ? { ...payload, traceId } : payload))
}

const server = http.createServer(async (req, res) => {
  serverMetrics.httpRequests += 1
  const traceId = String(req.headers['x-trace-id'] || generateTraceId())
  withCors(req, res)
  writeTrace(res, traceId)

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  const parsed = new URL(req.url || '/', `http://${req.headers.host}`)
  const sessionId = normalizeSessionId(parsed.searchParams.get('sessionId'))
  const room = getOrCreateSession(sessionId)

  if (req.method === 'POST' && parsed.pathname === '/api/rooms/create') {
    const ip = String(req.socket.remoteAddress || 'unknown')
    const key = `room-create:${ip}`
    if (isRateLimited({ key, maxHits: 20 })) {
      serverMetrics.rateLimited += 1
      writeJson(res, 429, { ok: false, error: 'rate limit exceeded' }, traceId)
      return
    }
    try {
      const body = await parseJsonBody(req)
      const roomId = normalizeSessionId(body.roomId)
      const password = String(body.password || '').trim()
      const hostDriverId = String(body.hostDriverId || body.clientId || randomUUID()).trim()
      if (!password) {
        writeJson(res, 400, { ok: false, error: 'password is required' }, traceId)
        return
      }
      const targetRoom = getOrCreateSession(roomId)
      if (targetRoom.passwordHash) {
        writeJson(res, 409, { ok: false, error: 'room already exists' }, traceId)
        return
      }
      targetRoom.passwordHash = hashPassword(password)
      targetRoom.hostDriverId = hostDriverId
      const authToken = issueRoomJwt(config.roomAuthSecret, {
        roomId,
        role: 'driver',
        clientId: hostDriverId,
      }, config.roomAuthTtlMs)
      writeJson(res, 200, {
        ok: true,
        roomId,
        role: 'driver',
        clientId: hostDriverId,
        authToken,
        expiresInMs: config.roomAuthTtlMs,
      }, traceId)
      return
    } catch (err) {
      writeJson(res, 400, { ok: false, error: err.message || 'bad request' }, traceId)
      return
    }
  }

  if (req.method === 'POST' && parsed.pathname === '/api/rooms/join') {
    const ip = String(req.socket.remoteAddress || 'unknown')
    const key = `room-join:${ip}`
    if (isRateLimited({ key, maxHits: 60 })) {
      serverMetrics.rateLimited += 1
      writeJson(res, 429, { ok: false, error: 'rate limit exceeded' }, traceId)
      return
    }
    try {
      const body = await parseJsonBody(req)
      const roomId = normalizeSessionId(body.roomId)
      const password = String(body.password || '').trim()
      const role = String(body.role || 'engineer').toLowerCase()
      const clientId = String(body.clientId || randomUUID()).trim()
      const targetRoom = getOrCreateSession(roomId)

      if (!targetRoom.passwordHash) {
        writeJson(res, 404, { ok: false, error: 'room not found' }, traceId)
        return
      }
      if (!verifyPassword(password, targetRoom.passwordHash)) {
        serverMetrics.authRejected += 1
        writeJson(res, 403, { ok: false, error: 'invalid room password' }, traceId)
        return
      }
      if (!['engineer', 'driver', 'spectator'].includes(role)) {
        writeJson(res, 400, { ok: false, error: 'invalid role' }, traceId)
        return
      }
      if (role === 'driver' && targetRoom.hostDriverId && targetRoom.hostDriverId !== clientId) {
        writeJson(res, 403, { ok: false, error: 'driver id mismatch for room host' }, traceId)
        return
      }
      if (role === 'engineer') {
        targetRoom.engineers.add(clientId)
      }
      const authToken = issueRoomJwt(config.roomAuthSecret, {
        roomId,
        role,
        clientId,
      }, config.roomAuthTtlMs)
      writeJson(res, 200, {
        ok: true,
        roomId,
        role,
        clientId,
        authToken,
        expiresInMs: config.roomAuthTtlMs,
      }, traceId)
      return
    } catch (err) {
      writeJson(res, 400, { ok: false, error: err.message || 'bad request' }, traceId)
      return
    }
  }

  if (req.method === 'POST' && parsed.pathname === '/api/auth/refresh') {
    try {
      const body = await parseJsonBody(req)
      const token = String(body.authToken || parseAuthorizationBearer(req) || '')
      const checked = verifyRoomJwt(config.roomAuthSecret, token)
      if (!checked.valid) {
        serverMetrics.authRejected += 1
        writeJson(res, 401, { ok: false, error: checked.expired ? 'token expired' : 'invalid token' }, traceId)
        return
      }
      const claims = checked.payload || {}
      const authToken = issueRoomJwt(config.roomAuthSecret, {
        roomId: claims.roomId,
        role: claims.role,
        clientId: claims.clientId,
      }, config.roomAuthTtlMs)
      writeJson(res, 200, { ok: true, authToken, expiresInMs: config.roomAuthTtlMs }, traceId)
      return
    } catch (err) {
      writeJson(res, 400, { ok: false, error: err.message || 'bad request' }, traceId)
      return
    }
  }

  if (req.method === 'GET' && parsed.pathname === '/health') {
    writeJson(res, 200, {
      ok: true,
      uptimeSec: process.uptime(),
      defaultSessionId: config.defaultSessionId,
      viewers: viewers.size,
      bridges: bridges.size,
      sessions: Array.from(sessions.values()).map((item) => roomSummary(item)),
      model: trainer.status(),
    })
    return
  }

  if (req.method === 'GET' && parsed.pathname === '/diagnostics') {
    writeJson(res, 200, {
      ok: true,
      traceId,
      sessionId,
      matrix: {
        websocket: {
          connectedViewers: room.viewers.size,
          connectedBridges: room.bridges.size,
          accepted: room.metrics.accepted,
          droppedOutOfOrder: room.metrics.droppedOutOfOrder,
          droppedDuplicate: room.metrics.droppedDuplicate,
        },
        sse: {
          clients: room.sseClients.size,
          bufferedEvents: room.recentFrames.length,
          lastEventId: room.lastEventId,
        },
        snapshots: {
          available: !!room.latestState,
          ageMs: room.latestMeta ? Date.now() - room.latestMeta.ts : null,
          stale: !!room.latestMeta?.stale,
        },
        commands: {
          queued: room.commandHistory.length,
          submitted: room.metrics.commandsSubmitted,
          acked: room.metrics.commandsAcked,
        },
      },
    }, traceId)
    return
  }

  if (req.method === 'GET' && parsed.pathname === '/metrics' && config.enablePrometheusMetrics) {
    metricSessionActiveCount.set(sessions.size)
    metricWsConnectedClients.set({ role: 'viewer' }, viewers.size)
    metricWsConnectedClients.set({ role: 'bridge' }, bridges.size)

    res.writeHead(200, { 'Content-Type': promRegistry.contentType })
    res.end(await promRegistry.metrics())
    return
  }

  if (req.method === 'GET' && parsed.pathname === '/state') {
    if (!room.latestState) {
      writeJson(res, 404, { ok: false, error: 'no state yet' }, traceId)
      return
    }
    writeJson(res, 200, room.latestState, traceId)
    return
  }

  if (req.method === 'GET' && parsed.pathname === '/events') {
    const lastEventFromHeader = Number(req.headers['last-event-id'] || -1)
    const lastEventFromQuery = Number(parsed.searchParams.get('since') || -1)
    const lastEventId = Number.isFinite(lastEventFromHeader) && lastEventFromHeader >= 0
      ? lastEventFromHeader
      : (Number.isFinite(lastEventFromQuery) && lastEventFromQuery >= 0 ? lastEventFromQuery : -1)

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    res.write('event: ready\n')
    res.write(`data: ${JSON.stringify({ sessionId, traceId, resumedFromEventId: lastEventId })}\n\n`)
    room.sseClients.add(res)

    if (lastEventId >= 0 && room.recentFrames.length > 0) {
      for (const frame of room.recentFrames) {
        if (frame.eventId <= lastEventId) continue
        const serialized = JSON.stringify(frame)
        res.write(`id: ${frame.eventId}\n`)
        res.write('event: state\n')
        res.write(`data: ${serialized}\n\n`)
      }
    } else if (room.latestState) {
      const bootstrap = JSON.stringify({
        type: 'state',
        eventId: room.lastEventId,
        sessionId,
        payload: room.latestState,
        meta: {
          ...(room.latestMeta || {}),
          eventId: room.lastEventId,
        },
      })
      res.write(`id: ${room.lastEventId}\n`)
      res.write('event: state\n')
      res.write(`data: ${bootstrap}\n\n`)
    }

    const keepAlive = setInterval(() => {
      try {
        res.write('event: heartbeat\n')
        res.write(`data: ${JSON.stringify({ ts: Date.now() })}\n\n`)
      } catch {
        // Client likely closed.
      }
    }, 15000)

    req.on('close', () => {
      clearInterval(keepAlive)
      room.sseClients.delete(res)
    })
    return
  }

  if (req.method === 'GET' && parsed.pathname === '/api/strategy/stats') {
    writeJson(res, 200, { ok: true, model: trainer.status() })
    return
  }

  if (req.method === 'POST' && parsed.pathname === '/api/strategy/decision') {
    const ip = String(req.socket.remoteAddress || 'unknown')
    const key = `${sessionId}:${ip}:${parsed.pathname}`
    if (isRateLimited({ key })) {
      serverMetrics.rateLimited += 1
      writeJson(res, 429, { ok: false, error: 'rate limit exceeded' }, traceId)
      return
    }

    try {
      const body = await parseJsonBody(req)
      const context = body.context && typeof body.context === 'object'
        ? body.context
        : room.latestState
          ? extractContextFromState(room.latestState)
          : {}

      const rec = trainer.decide(context, {
        policy: body.policy,
        epsilon: body.epsilon,
        temperature: body.temperature,
        blendAlpha: body.blendAlpha,
        horizonLaps: body.horizonLaps,
      })

      writeJson(res, 200, { ok: true, recommendation: rec })
    } catch (err) {
      writeJson(res, 400, { ok: false, error: err.message || 'bad request' })
    }
    return
  }

  if (req.method === 'POST' && parsed.pathname === '/api/strategy/feedback') {
    const ip = String(req.socket.remoteAddress || 'unknown')
    const key = `${sessionId}:${ip}:${parsed.pathname}`
    if (isRateLimited({ key })) {
      serverMetrics.rateLimited += 1
      writeJson(res, 429, { ok: false, error: 'rate limit exceeded' }, traceId)
      return
    }

    try {
      const body = await parseJsonBody(req)
      const action = String(body.action || '')
      const reward = Number(body.reward)

      if (!trainer.isKnownAction(action)) {
        writeJson(res, 400, { ok: false, error: 'invalid action' })
        return
      }
      if (!Number.isFinite(reward) || reward < -1 || reward > 1) {
        writeJson(res, 400, { ok: false, error: 'reward must be in [-1, 1]' })
        return
      }

      const context = body.context && typeof body.context === 'object'
        ? body.context
        : room.latestState
          ? extractContextFromState(room.latestState)
          : {}

      const trained = trainer.update({
        action,
        reward,
        context,
        nStepRewards: Array.isArray(body.nStepRewards) ? body.nStepRewards : [],
      })
      writeJson(res, 200, { ok: true, trained, at: nowIso() })
    } catch (err) {
      writeJson(res, 400, { ok: false, error: err.message || 'bad request' })
    }
    return
  }

  writeJson(res, 404, { ok: false, error: 'not found' })
})

const wss = new WebSocketServer({ noServer: true })

function isBridgeAuthorized(url, req) {
  const tokenFromQuery = url.searchParams.get('token') || ''
  const tokenFromHeader = req.headers['x-bridge-token'] || ''
  const token = String(tokenFromHeader || tokenFromQuery)
  // Static token check
  if (config.bridgeTokens.has(token)) return true
  // Signed token check (if secret is configured)
  if (config.bridgeTokenSecret) {
    const result = validateSignedToken(config.bridgeTokenSecret, token)
    return result.valid
  }
  return false
}

server.on('upgrade', (req, socket, head) => {
  const parsed = new URL(req.url || '/', `http://${req.headers.host}`)

  if (parsed.pathname !== '/ws') {
    socket.destroy()
    return
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req, parsed)
  })
})

wss.on('connection', (ws, req, url) => {
  serverMetrics.wsConnections += 1
  const requestedRole = (url.searchParams.get('role') || 'viewer').toLowerCase()
  const role = requestedRole === 'bridge' ? 'bridge' : 'viewer'
  const rawViewerRole = (url.searchParams.get('viewerRole') || 'spectator').toLowerCase()
  const viewerRole = ['engineer', 'driver', 'spectator'].includes(rawViewerRole) ? rawViewerRole : 'spectator'
  const featureFlags = viewerFeatureFlags(viewerRole)
  const sessionId = normalizeSessionId(url.searchParams.get('sessionId'))
  const room = getOrCreateSession(sessionId)
  const authToken = getRoomAuthToken(url, req)
  let clientId = String(url.searchParams.get('clientId') || randomUUID())

  if (role !== 'bridge') {
    const roomProtected = !!room.passwordHash
    if (roomProtected || viewerRole === 'driver' || viewerRole === 'engineer') {
      const authResult = verifyRoomJwt(config.roomAuthSecret, authToken)
      if (!authResult.valid) {
        serverMetrics.authRejected += 1
        ws.send(JSON.stringify({ type: 'error', reason: authResult.expired ? 'auth expired' : 'auth required' }))
        ws.close(4401, 'unauthorized')
        return
      }
      const claims = authResult.payload || {}
      if (normalizeSessionId(claims.roomId) !== sessionId || String(claims.role || '').toLowerCase() !== viewerRole) {
        serverMetrics.authRejected += 1
        ws.send(JSON.stringify({ type: 'error', reason: 'room/role mismatch' }))
        ws.close(4403, 'forbidden')
        return
      }
      clientId = String(claims.clientId || clientId)
      if (viewerRole === 'driver' && room.hostDriverId && room.hostDriverId !== clientId) {
        serverMetrics.authRejected += 1
        ws.send(JSON.stringify({ type: 'error', reason: 'driver identity mismatch' }))
        ws.close(4403, 'forbidden')
        return
      }
    }
  }

  if (role === 'bridge' && !isBridgeAuthorized(url, req)) {
    logWarn('bridge unauthorized', { sessionId, remoteAddress: req.socket.remoteAddress || 'unknown' })
    ws.send(JSON.stringify({ type: 'error', reason: 'unauthorized bridge token' }))
    ws.close(4401, 'unauthorized')
    return
  }

  ws.role = role
  ws.sessionId = sessionId
  ws.viewerRole = viewerRole
  ws.clientId = clientId
  ws.featureFlags = featureFlags
  ws.isAlive = true
  ws.encoding = negotiateEncoding(url.searchParams)

  ws.on('pong', () => {
    ws.isAlive = true
  })

  if (role === 'bridge') {
    bridges.add(ws)
    room.bridges.add(ws)
    metricWsConnectedClients.set({ role: 'bridge' }, bridges.size)
    ws.send(JSON.stringify({ type: 'ready', role: 'bridge', sessionId }))
  } else {
    viewers.add(ws)
    room.viewers.add(ws)
    metricWsConnectedClients.set({ role: 'viewer' }, viewers.size)
    room.participants.set(clientId, {
      clientId,
      role: viewerRole,
      connectedAt: Date.now(),
    })
    if (viewerRole === 'engineer') room.engineers.add(clientId)
    ws._bpQueue = new BackpressureQueue(ws)
    ws.send(JSON.stringify({ type: 'ready', role: 'viewer', sessionId, viewerRole, clientId, featureFlags }))
    broadcastSessionEvent(room, 'client_joined', {
      clientId,
      viewerRole,
      participants: room.participants.size,
    })
    if (room.latestState) {
      ws.send(
        JSON.stringify({
          type: 'state',
          eventId: room.lastEventId,
          sessionId,
          payload: room.latestState,
          meta: {
            ...(room.latestMeta || {}),
            eventId: room.lastEventId,
          },
        }),
      )
    }
  }

  ws.on('message', (raw) => {
    serverMetrics.wsMessages += 1
    const encodingHint = ws.role === 'bridge' ? 'json' : ws.encoding
    const parsed = decodeEnvelope(raw, encodingHint)
    if (!parsed || typeof parsed !== 'object') {
      return
    }

    if (parsed?.type === 'pong') return

    if (ws.role !== 'bridge') {
      if (ws.viewerRole === 'engineer' && parsed?.type === 'command_submit') {
        const limiterKey = `cmd:${ws.sessionId}:${ws.clientId}`
        if (isRateLimited({ key: limiterKey, maxHits: config.commandRateLimitPer10s, windowMs: 10_000 })) {
          serverMetrics.rateLimited += 1
          ws.send(JSON.stringify({ type: 'error', reason: 'command rate limit exceeded' }))
          return
        }

        const checked = validateCommandShape(parsed.command)
        if (!checked.ok) {
          ws.send(JSON.stringify({ type: 'error', reason: checked.reason }))
          return
        }

        const normalized = checked.normalized
        if (normalized.idempotencyKey && room.commandDedupe.has(normalized.idempotencyKey)) {
          ws.send(JSON.stringify(buildProtocolEnvelope('command_accepted', room, 'server', {
            duplicate: true,
            idempotencyKey: normalized.idempotencyKey,
          })))
          return
        }

        const commandId = `cmd_${randomUUID().slice(0, 8)}`
        const command = {
          id: commandId,
          type: normalized.type,
          priority: normalized.priority,
          message: normalized.message,
          timestamp: normalized.timestamp,
          ttlMs: normalized.ttlMs,
        }

        if (normalized.idempotencyKey) {
          room.commandDedupe.add(normalized.idempotencyKey)
        }
        room.commandHistory.push({ ...command, from: ws.clientId })
        if (room.commandHistory.length > config.commandBufferSize) {
          room.commandHistory.shift()
        }
        room.metrics.commandsSubmitted += 1
        serverMetrics.commandSubmitted += 1

        const toDriver = buildProtocolEnvelope('driver_command', room, ws.clientId, { command })
        broadcastToViewers(room, (client) => client.viewerRole === 'driver', toDriver)

        const accepted = buildProtocolEnvelope('command_accepted', room, 'server', {
          commandId,
          status: 'sent_to_driver',
        })
        if (ws._bpQueue) ws._bpQueue.enqueue(JSON.stringify(accepted))
        else ws.send(JSON.stringify(accepted))
        return
      }

      if (ws.viewerRole === 'driver' && parsed?.type === 'command_ack') {
        const commandId = String(parsed.commandId || '')
        const status = String(parsed.status || 'received')
        if (!commandId) return
        room.metrics.commandsAcked += 1
        serverMetrics.commandAcked += 1
        const ack = buildProtocolEnvelope('command_ack', room, ws.clientId, {
          commandId,
          status,
          timestamp: Number(parsed.timestamp) || Date.now(),
        })
        broadcastToViewers(room, (client) => client.viewerRole === 'engineer', ack)
        return
      }

      if (ws.viewerRole === 'driver' && (parsed?.type === 'telemetry_snapshot' || parsed?.type === 'telemetry_delta')) {
        if (!parsed?.payload || typeof parsed.payload !== 'object') return
        const source = ws.clientId || 'driver'
        const seq = Number(parsed.seq)
        const frameId = Number(parsed?.payload?.last_frame_identifier)
        if (!shouldAcceptBridgeFrame(room, source, seq, frameId)) return
        const meta = {
          ts: Date.now(),
          source,
          seq: Number.isFinite(seq) ? seq : 0,
          frameId: Number.isFinite(frameId) ? frameId : null,
          profile: String(parsed.profile || parsed?.payload?.profile || 'hud'),
          at: nowIso(),
          sessionId,
          delta: parsed.type === 'telemetry_delta',
        }
        publishToRoom(room, parsed.payload, meta)
        return
      }

      return
    }

    if (parsed?.type !== 'state' || !parsed?.payload || typeof parsed.payload !== 'object') {
      return
    }

    const source = parsed.source || url.searchParams.get('bridgeId') || 'bridge'
    const seq = Number(parsed.seq)
    const frameId = Number(parsed?.payload?.last_frame_identifier)
    if (!shouldAcceptBridgeFrame(room, source, seq, frameId)) return

    const meta = {
      ts: Date.now(),
      source,
      seq: Number.isFinite(seq) ? seq : 0,
      frameId: Number.isFinite(frameId) ? frameId : null,
      profile: String(parsed.profile || parsed?.payload?.profile || 'engineer'),
      at: nowIso(),
      sessionId,
    }

    publishToRoom(room, parsed.payload, meta)
  })

  ws.on('close', () => {
    viewers.delete(ws)
    bridges.delete(ws)
    metricWsConnectedClients.set({ role: 'viewer' }, viewers.size)
    metricWsConnectedClients.set({ role: 'bridge' }, bridges.size)
    room.viewers.delete(ws)
    room.bridges.delete(ws)
    if (ws.clientId) {
      room.participants.delete(ws.clientId)
      if (ws.viewerRole === 'engineer') {
        room.engineers.delete(ws.clientId)
      }
      if (ws.role !== 'bridge') {
        broadcastSessionEvent(room, 'client_left', {
          clientId: ws.clientId,
          viewerRole: ws.viewerRole,
          participants: room.participants.size,
        })
      }
    }
  })
})

const heartbeat = setInterval(() => {
  const all = [...viewers, ...bridges]
  for (const ws of all) {
    if (ws.isAlive === false) {
      ws.terminate()
      viewers.delete(ws)
      bridges.delete(ws)
      continue
    }
    ws.isAlive = false
    ws.ping()
  }

  for (const room of sessions.values()) {
    if (room.latestMeta && Date.now() - room.latestMeta.ts > config.maxStateAgeMs) {
      room.latestMeta.stale = true
    }
    if (
      room.viewers.size === 0
      && room.bridges.size === 0
      && room.sseClients.size === 0
      && Date.now() - room.lastActivityTs > config.maxSessionIdleMs
    ) {
      clearInterval(room.flushTimer)
      sessions.delete(room.sessionId)
      metricSessionActiveCount.set(sessions.size)
    }
  }
}, 5000)

server.listen(config.port, config.host, () => {
  logInfo('relay listening', {
    host: config.host,
    port: config.port,
    defaultSessionId: config.defaultSessionId,
    promMetrics: config.enablePrometheusMetrics,
  })
})

process.on('SIGINT', () => {
  clearInterval(heartbeat)
  trainer.saveModel()
  server.close(async () => {
    await otel.shutdown()
    process.exit(0)
  })
})

process.on('SIGTERM', () => {
  clearInterval(heartbeat)
  trainer.saveModel()
  server.close(async () => {
    await otel.shutdown()
    process.exit(0)
  })
})
