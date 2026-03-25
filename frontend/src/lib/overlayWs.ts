/**
 * WebSocket connection for Stream Overlay mode.
 * Connects to /ws/overlay endpoint and receives compact race state at ~20Hz.
 * Used by StreamOverlayView for OBS browser source rendering.
 */
import { createLogger } from './logger'
import { SESSION_ID, WS_MAX_RETRY_MS } from './env'

const log = createLogger('overlay-ws')

const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
const pageHost = window.location.host
const pageHostname = window.location.hostname

const OVERLAY_WS_CANDIDATES = [
  `${wsProtocol}://${pageHost}/ws/overlay`,
  `${wsProtocol}://${pageHostname}:8765/ws/overlay`,
  `${wsProtocol}://127.0.0.1:8765/ws/overlay`,
].map((base) => `${base}?sessionId=${encodeURIComponent(SESSION_ID)}`)

export type OverlayState = {
  type: 'overlay'
  player: {
    position: number
    lap: number
    speed: number
    gear: number
    throttle: number
    brake: number
    steer: number
    rpm: number
    drs: boolean
    tyre_compound: string
    tyre_wear_pct: number
    fuel: number
    ers: number
    last_lap_ms: number
    best_lap_ms: number
    current_lap_ms: number
    time_penalties_s: number
    total_warnings: number
    tyre_surface_temps_c: number[]
    tyre_inner_temps_c: number[]
  }
  leaderboard: Array<{
    car_index: number
    driver_code: string
    position: number
    gap_to_leader_s: number
    gap_to_player_s: number
    last_lap_ms: number
    best_lap_ms: number
    tyre_compound: string
    stint_lap: number
    tyre_wear_pct: number
    is_pitting: boolean
    sector1_ms: number
    sector2_ms: number
    sector3_ms: number
  }>
  minimap: Record<string, unknown>
  race_control_state: string
  weather_state: string
  total_laps: number
  track: string
  session_type: string
  driver_codes: Record<string, string>
  last_event_summary: string
}

export function connectOverlay(
  onState: (s: OverlayState) => void,
  onStatus: (s: string) => void,
): () => void {
  let ws: WebSocket | null = null
  let closed = false
  let retryMs = 500
  let connectTimer: number | null = null
  let endpointCursor = 0
  let pendingFrame: OverlayState | null = null
  let rafId: number | null = null

  const flush = () => {
    rafId = null
    if (!pendingFrame) return
    onState(pendingFrame)
    pendingFrame = null
  }

  const queue = (next: OverlayState) => {
    pendingFrame = next
    if (rafId !== null) return
    rafId = requestAnimationFrame(flush)
  }

  const connect = () => {
    if (closed) return
    const url = OVERLAY_WS_CANDIDATES[endpointCursor % OVERLAY_WS_CANDIDATES.length]
    log.info('connecting overlay', { url })
    ws = new WebSocket(url)
    onStatus('connecting')

    ws.onopen = () => {
      retryMs = 500
      onStatus('connected')
      log.info('overlay connected')
    }

    ws.onclose = () => {
      onStatus('disconnected')
      if (!closed) {
        endpointCursor += 1
        connectTimer = window.setTimeout(connect, retryMs)
        retryMs = Math.min(retryMs * 2, WS_MAX_RETRY_MS)
      }
    }

    ws.onerror = () => {
      onStatus('error')
    }

    ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data) as OverlayState
        queue(data)
      } catch {
        // skip malformed frames
      }
    }
  }

  connectTimer = window.setTimeout(connect, 0)

  return () => {
    closed = true
    if (connectTimer !== null) clearTimeout(connectTimer)
    if (rafId !== null) cancelAnimationFrame(rafId)
    pendingFrame = null
    if (ws) {
      ws.onopen = null
      ws.onclose = null
      ws.onerror = null
      ws.onmessage = null
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close()
      }
    }
  }
}
