import { AppState } from './types'
import { createMonacoDemoStream } from './mockMonaco'
import { isMonacoDemoMode } from './demoMode'
import { createLogger } from './logger'
import { normalizeSnapshot } from './normalizer'
import { getStore } from './store'
import { createRelayWsUrl, refreshRoomAuth, type RoomRole } from './multiplayerSession'
import {
  SESSION_ID,
  WS_RELAY_URL,
  RELAY_API_BASE,
  WS_MAX_RETRY_MS,
  STALE_POLL_INTERVAL_MS,
  STALE_SILENCE_MS,
} from './env'

const log = createLogger('ws')

const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
const httpProtocol = window.location.protocol
const pageHost = window.location.host
const pageHostname = window.location.hostname

type StoredConnectionSettings = {
  wsUrl?: string
  roomId?: string
  clientId?: string
  roomRole?: RoomRole
  roomAuthToken?: string
  roomAuthExpiresAt?: number
}

type RuntimeConnection = {
  wsOverride: string
  roomId: string
  viewerRole: RoomRole
  clientId: string
  authToken: string
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const trimmed = value.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    out.push(trimmed)
  }
  return out
}

function getSettingsKeys(sessionId: string): string[] {
  return [
    `pitwall:settings:${sessionId}:all`,
    'pitwall:settings:global:all',
    'pitwall:settings',
  ]
}

function readStoredConnectionSettings(sessionId: string): StoredConnectionSettings {
  try {
    for (const key of getSettingsKeys(sessionId)) {
      const raw = localStorage.getItem(key)
      if (!raw) continue
      const parsed = JSON.parse(raw) as StoredConnectionSettings
      return parsed ?? {}
    }
  } catch {
    // ignore malformed local settings
  }
  return {}
}

function saveStoredConnectionSettings(sessionId: string, next: StoredConnectionSettings): void {
  try {
    const keys = getSettingsKeys(sessionId)
    const merged = {
      ...readStoredConnectionSettings(sessionId),
      ...next,
    }
    localStorage.setItem(keys[0], JSON.stringify(merged))
  } catch {
    // ignore write failures
  }
}

function normalizeRoomRole(role: string | null | undefined): RoomRole {
  if (role === 'driver' || role === 'engineer' || role === 'spectator') return role
  return 'spectator'
}

function createClientId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`
}

function resolveRuntimeConnection(): RuntimeConnection {
  const query = new URLSearchParams(window.location.search)
  const stored = readStoredConnectionSettings(SESSION_ID)

  const roomId =
    String(stored.roomId || '').trim() ||
    String(query.get('sessionId') || query.get('session') || SESSION_ID).trim()

  const viewerRole = normalizeRoomRole(
    String(stored.roomRole || '').trim() || query.get('viewerRole') || 'spectator',
  )

  const queryClientId = String(query.get('clientId') || '').trim()
  const storedClientId = String(stored.clientId || '').trim()
  const clientId = storedClientId || queryClientId || createClientId('viewer')

  const authToken =
    String(stored.roomAuthToken || '').trim() ||
    String(query.get('auth') || '').trim()

  const wsOverride = String(stored.wsUrl || '').trim()

  return {
    wsOverride,
    roomId,
    viewerRole,
    clientId,
    authToken,
  }
}

function withSessionQuery(baseUrl: string, params: Record<string, string>): string {
  const u = new URL(baseUrl, window.location.origin)
  Object.entries(params).forEach(([key, value]) => u.searchParams.set(key, value))
  return u.toString()
}

const urlQuery = new URLSearchParams(window.location.search)
const VIEWER_ROLE = urlQuery.get('viewerRole') || 'spectator'
const INITIAL_AUTH_TOKEN = urlQuery.get('auth') || ''
const VIEWER_CLIENT_ID =
  urlQuery.get('clientId') ||
  `viewer-${Math.random().toString(36).slice(2, 10)}`

let roomAuthToken = INITIAL_AUTH_TOKEN

function toRoomRole(role: string): RoomRole {
  if (role === 'driver' || role === 'engineer' || role === 'spectator') {
    return role
  }
  return 'spectator'
}

const WS_BASE_CANDIDATES = [
  WS_RELAY_URL,
  `${wsProtocol}://${pageHost}/ws`,
  `${wsProtocol}://${pageHost}/api/ws`,
  `${wsProtocol}://${pageHostname}:8765/ws`,
  `${wsProtocol}://${pageHostname}:8765/api/ws`,
  `${wsProtocol}://127.0.0.1:8765/ws`,
  `${wsProtocol}://127.0.0.1:8765/api/ws`,
].filter(Boolean)

function getWsCandidates(runtime: RuntimeConnection): string[] {
  const bases = uniqueStrings([
    runtime.wsOverride,
    ...WS_BASE_CANDIDATES,
  ])

  if (roomAuthToken) {
    const roomRole = toRoomRole(runtime.viewerRole)
    return bases.map((base) =>
      createRelayWsUrl(base, {
        roomId: runtime.roomId,
        role: roomRole,
        clientId: runtime.clientId,
        authToken: roomAuthToken,
      }),
    )
  }

  return bases.map((base) =>
    withSessionQuery(base, {
      role: 'viewer',
      viewerRole: runtime.viewerRole,
      sessionId: runtime.roomId,
      clientId: runtime.clientId,
    }),
  )
}

const API_CANDIDATES = [
  RELAY_API_BASE,
  `${httpProtocol}//${pageHost}`,
  `${httpProtocol}//${pageHost}/api`,
  `${httpProtocol}//${pageHostname}:8765`,
  `${httpProtocol}//${pageHostname}:8765/api`,
  `${httpProtocol}//127.0.0.1:8765`,
  `${httpProtocol}//127.0.0.1:8765/api`,
].filter(Boolean)

let activeApiBase = API_CANDIDATES[0]
const WS_CONNECT_TIMEOUT_MS = 7000
const SSE_RETRY_MS = 1800

function newTraceId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `trace-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function buildSessionQuery(sessionId: string): string {
  return `sessionId=${encodeURIComponent(sessionId)}`
}

function getCurrentSessionQuery(): string {
  return buildSessionQuery(resolveRuntimeConnection().roomId)
}

async function fetchSnapshot(apiBase: string, signal?: AbortSignal): Promise<AppState | null> {
  try {
    const resp = await fetch(`${apiBase}/state?${getCurrentSessionQuery()}`, { cache: 'no-store', signal })
    if (!resp.ok) return null
    return (await resp.json()) as AppState
  } catch {
    return null
  }
}

async function fetchSnapshotFromAny(signal?: AbortSignal): Promise<{ snapshot: AppState; apiBase: string } | null> {
  for (const apiBase of API_CANDIDATES) {
    const snapshot = await fetchSnapshot(apiBase, signal)
    if (snapshot) return { snapshot, apiBase }
  }
  return null
}

export function connectState(onState: (s: AppState) => void, onStatus: (s: string) => void): () => void {
  if (isMonacoDemoMode()) {
    return createMonacoDemoStream(onState, onStatus)
  }

  let ws: WebSocket | null = null
  let closed = false
  let retryMs = 500
  let connectTimer: number | null = null
  let stalePollTimer: number | null = null
  let connectWatchdogTimer: number | null = null
  let endpointCursor = 0
  let failedFullCycles = 0
  const MAX_FULL_CYCLES_BEFORE_DEMO = 2
  let demoCleanup: (() => void) | null = null
  let lastStateAt = 0
  let lastSocketAt = 0
  let pendingFrame: AppState | null = null
  let rafId: number | null = null
  let stalePollAbort: AbortController | null = null
  let sse: EventSource | null = null
  let sseReconnectTimer: number | null = null
  let lastEventId = -1
  let traceId = newTraceId()
  let authRefreshTimer: number | null = null
  const runtime = resolveRuntimeConnection()
  const runtimeSessionId = runtime.roomId
  const runtimeViewerRole = runtime.viewerRole
  const sessionQuery = `sessionId=${encodeURIComponent(runtimeSessionId)}`
  roomAuthToken = runtime.authToken || INITIAL_AUTH_TOKEN

  // Throttle: dynamic frame budget based on measured FPS
  let lastFrameQueuedAt = 0
  let minFrameIntervalMs = 16
  let lastRafTs = 0
  let fpsEma = 60
  let consecutiveErrors = 0
  const MAX_CONSECUTIVE_ERRORS = 5

  const flushRafFrame = () => {
    rafId = null
    const now = performance.now()
    if (lastRafTs > 0) {
      const instantFps = 1000 / Math.max(1, now - lastRafTs)
      fpsEma = fpsEma * 0.85 + instantFps * 0.15
      if (fpsEma < 28) minFrameIntervalMs = 33
      else if (fpsEma < 40) minFrameIntervalMs = 25
      else minFrameIntervalMs = 16
    }
    lastRafTs = now

    if (!pendingFrame) return
    const frame = pendingFrame
    pendingFrame = null
    onState(frame)
    // Forward to the TelemetryStore for hook-based consumers
    getStore().replaceState(frame)
  }

  const queueState = (next: AppState) => {
    // Normalize and validate the incoming payload
    const normalized = normalizeSnapshot(next)
    if (!normalized) return

    consecutiveErrors = 0
    const now = performance.now()
    // Drop intermediate frames if they arrive faster than display refresh
    if (now - lastFrameQueuedAt < minFrameIntervalMs && rafId !== null) {
      pendingFrame = normalized
      return
    }
    lastFrameQueuedAt = now
    pendingFrame = normalized
    if (rafId !== null) return
    rafId = window.requestAnimationFrame(flushRafFrame)
  }

  const clearStalePoll = () => {
    if (stalePollTimer !== null) {
      window.clearInterval(stalePollTimer)
      stalePollTimer = null
    }
    stalePollAbort?.abort()
    stalePollAbort = null
  }

  const clearConnectWatchdog = () => {
    if (connectWatchdogTimer !== null) {
      window.clearTimeout(connectWatchdogTimer)
      connectWatchdogTimer = null
    }
  }

  const clearSseFallback = () => {
    if (sseReconnectTimer !== null) {
      window.clearTimeout(sseReconnectTimer)
      sseReconnectTimer = null
    }
    if (sse) {
      sse.close()
      sse = null
    }
  }

  const clearAuthRefresh = () => {
    if (authRefreshTimer !== null) {
      window.clearTimeout(authRefreshTimer)
      authRefreshTimer = null
    }
  }

  const scheduleAuthRefresh = (expiresInMs = 120000) => {
    clearAuthRefresh()
    if (!roomAuthToken) return

    const refreshInMs = Math.max(5000, Math.floor(expiresInMs * 0.6))
    authRefreshTimer = window.setTimeout(async () => {
      if (closed || !roomAuthToken) return
      try {
        const apiBase = activeApiBase || API_CANDIDATES[0]
        const refreshed = await refreshRoomAuth(apiBase, roomAuthToken)
        roomAuthToken = refreshed.authToken
        saveStoredConnectionSettings(runtimeSessionId, {
          roomId: runtimeSessionId,
          roomRole: runtimeViewerRole,
          clientId: runtime.clientId,
          roomAuthToken: refreshed.authToken,
          roomAuthExpiresAt: Date.now() + refreshed.expiresInMs,
        })
        scheduleAuthRefresh(refreshed.expiresInMs)
        log.info('room auth refreshed')
      } catch (error) {
        log.warn('room auth refresh failed', { error: String(error) })
        scheduleAuthRefresh(30000)
      }
    }, refreshInMs)
  }

  const startSseFallback = () => {
    if (closed || sse) return
    const base = activeApiBase || API_CANDIDATES[0]
    const suffix = lastEventId >= 0 ? `&since=${lastEventId}` : ''
    const url = `${base}/events?${sessionQuery}${suffix}`
    log.warn('starting sse fallback', { url, traceId, lastEventId })
    onStatus('connected')

    sse = new EventSource(url)
    sse.onmessage = () => {
      // no-op; named events handle payload
    }

    sse.addEventListener('state', (ev) => {
      try {
        const parsed = JSON.parse((ev as MessageEvent).data) as { payload?: AppState; eventId?: number; meta?: { eventId?: number } }
        const eventId = Number(parsed?.eventId ?? parsed?.meta?.eventId)
        if (Number.isFinite(eventId)) lastEventId = eventId
        if (parsed.payload) {
          lastStateAt = Date.now()
          queueState(parsed.payload)
        }
      } catch (error) {
        log.error('sse parse error', { error: String(error), traceId })
      }
    })

    sse.addEventListener('ready', (ev) => {
      try {
        const payload = JSON.parse((ev as MessageEvent).data) as { traceId?: string }
        if (payload.traceId) traceId = payload.traceId
      } catch {
        // ignore malformed ready payload
      }
    })

    sse.onerror = () => {
      clearSseFallback()
      if (!closed) {
        sseReconnectTimer = window.setTimeout(() => startSseFallback(), SSE_RETRY_MS)
      }
    }
  }

  const startStalePoll = () => {
    clearStalePoll()
    stalePollTimer = window.setInterval(async () => {
      if (closed) return
      const now = Date.now()
      if (now - lastStateAt < STALE_SILENCE_MS) return
      try {
        stalePollAbort?.abort()
        stalePollAbort = new AbortController()
        const found = await fetchSnapshotFromAny(stalePollAbort.signal)
        if (found) {
          activeApiBase = found.apiBase
          lastStateAt = now
          queueState(found.snapshot)
        }
      } catch {
        // silent - transient network failures are expected
      }
    }, STALE_POLL_INTERVAL_MS)
  }

  const connect = () => {
    if (closed) return
    const wsCandidates = getWsCandidates(runtime)
    if (!wsCandidates.length) {
      onStatus('error')
      return
    }

    const wsUrl = wsCandidates[endpointCursor % wsCandidates.length]
    traceId = newTraceId()
    log.info('connecting', { url: wsUrl, traceId, viewerRole: runtimeViewerRole })
    ws = new WebSocket(wsUrl)
    onStatus('connecting')

    clearConnectWatchdog()
    connectWatchdogTimer = window.setTimeout(() => {
      if (closed) return
      if (ws && ws.readyState === WebSocket.CONNECTING) {
        log.warn('connect timeout, rotating endpoint', { url: wsUrl })
        try {
          ws.close()
        } catch {
          // ignore
        }
      }
    }, WS_CONNECT_TIMEOUT_MS)

    ws.onopen = () => {
      clearConnectWatchdog()
      clearSseFallback()
      retryMs = 500
      activeApiBase = API_CANDIDATES[endpointCursor % API_CANDIDATES.length]
      if (roomAuthToken) {
        scheduleAuthRefresh()
      }
      log.info('connected', { api: activeApiBase, traceId })
      onStatus('connected')
      lastSocketAt = Date.now()
      fetchSnapshotFromAny().then((found) => {
        if (found && !closed) {
          activeApiBase = found.apiBase
          lastStateAt = Date.now()
          queueState(found.snapshot)
        }
      }).catch((error) => {
        log.error('Failed to fetch initial snapshot', { error: String(error) })
        onStatus('error')
      })
      startStalePoll()
    }

    ws.onclose = (ev) => {
      clearConnectWatchdog()
      log.warn('disconnected', { code: ev.code, reason: ev.reason, traceId })
      onStatus('disconnected')
      clearStalePoll()
      startSseFallback()
      if (!closed) {
        endpointCursor += 1
        // Track full cycles through all WS candidates
        if (endpointCursor > 0 && endpointCursor % wsCandidates.length === 0) {
          failedFullCycles += 1
        }
        // After exhausting retries, fall back to demo mode
        if (failedFullCycles >= MAX_FULL_CYCLES_BEFORE_DEMO && !demoCleanup) {
          log.warn('backend unreachable after retries — activating demo mode')
          onStatus('demo')
          // Wrap onStatus so the demo stream doesn't override 'demo' with 'connected'
          const demoStatusHandler = (s: string) => { if (s === 'connected') onStatus('demo'); else onStatus(s) }
          demoCleanup = createMonacoDemoStream(onState, demoStatusHandler)
          return
        }
        connectTimer = window.setTimeout(connect, retryMs)
        retryMs = Math.min(retryMs * 2, WS_MAX_RETRY_MS)
      }
    }

    ws.onerror = () => {
      log.error('ws error', { traceId })
      onStatus('error')
    }

    ws.onmessage = (ev) => {
      lastSocketAt = Date.now()
      try {
        const data = JSON.parse(ev.data) as
          | AppState
          | { type: string; payload?: AppState }

        if ('type' in data && data.type === 'heartbeat') {
          if (ws?.readyState === WebSocket.OPEN) ws.send('pong')
          return
        }

        if ('type' in data && data.type === 'state' && data.payload) {
          const eventId = Number((data as { eventId?: number; meta?: { eventId?: number } }).eventId ?? (data as { meta?: { eventId?: number } }).meta?.eventId)
          if (Number.isFinite(eventId)) lastEventId = eventId
          lastStateAt = Date.now()
          queueState(data.payload)
          return
        }

        lastStateAt = Date.now()
        queueState(data as AppState)
      } catch (error) {
        consecutiveErrors++
        if (consecutiveErrors > MAX_CONSECUTIVE_ERRORS) {
          log.error('too many parse errors, reconnecting')
          ws?.close()
          return
        }
        if (error instanceof SyntaxError) {
          log.error('parse error', { raw: String(ev.data).slice(0, 120) })
        } else {
          log.error('message handler error', { error: String(error) })
        }
      }
    }
  }

  connectTimer = window.setTimeout(connect, 0)

  const deadSocketGuard = window.setInterval(() => {
    if (closed || !ws) return
    if (ws.readyState !== WebSocket.OPEN) return
    if (!lastSocketAt) return
    const silentMs = Date.now() - lastSocketAt
    if (silentMs > STALE_SILENCE_MS * 4) {
      log.warn('socket silent too long, forcing reconnect', { silentMs })
      try {
        ws.close()
      } catch {
        // ignore
      }
    }
  }, Math.max(1000, Math.floor(STALE_SILENCE_MS / 2)))

  return () => {
    closed = true
    if (demoCleanup) {
      demoCleanup()
      demoCleanup = null
    }
    if (connectTimer !== null) {
      window.clearTimeout(connectTimer)
    }
    window.clearInterval(deadSocketGuard)
    clearConnectWatchdog()
    if (rafId !== null) {
      window.cancelAnimationFrame(rafId)
      rafId = null
    }
    pendingFrame = null
    clearStalePoll()
    clearSseFallback()
    clearAuthRefresh()
    if (ws) {
      ws.onopen = null
      ws.onclose = null
      ws.onerror = null
      ws.onmessage = null
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close()
      }
    }
    log.info('disconnected (cleanup)')
  }
}

export async function postStrategyFeedback(params: {
  action: string
  reward: number
  context?: Record<string, unknown>
}): Promise<boolean> {
  const runtime = resolveRuntimeConnection()
  const sessionQuery = `sessionId=${encodeURIComponent(runtime.roomId)}`
  const traceId = newTraceId()
  const body = JSON.stringify({
    action: params.action,
    reward: params.reward,
    context: params.context ?? null,
  })

  for (const apiBase of [activeApiBase, ...API_CANDIDATES]) {
    try {
      const resp = await fetch(`${apiBase}/api/strategy/feedback?${sessionQuery}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Trace-Id': traceId,
          'X-Viewer-Role': runtime.viewerRole,
        },
        body,
      })
      if (resp.ok) {
        activeApiBase = apiBase
        return true
      }
    } catch {
      // try next candidate
    }
  }

  return false
}
