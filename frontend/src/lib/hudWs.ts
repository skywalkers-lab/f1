/**
 * Lightweight WebSocket connection for Driver HUD overlay.
 * Connects to /ws/hud endpoint and receives only HudState at ~30Hz.
 * Minimizes CPU overhead via requestAnimationFrame batching.
 */
import { HudState } from './hudTypes'
import { createLogger } from './logger'
import { SESSION_ID, WS_MAX_RETRY_MS } from './env'

const log = createLogger('hud-ws')

const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
const pageHost = window.location.host
const pageHostname = window.location.hostname

const HUD_WS_CANDIDATES = [
  `${wsProtocol}://${pageHost}/ws/hud`,
  `${wsProtocol}://${pageHostname}:8765/ws/hud`,
  `${wsProtocol}://127.0.0.1:8765/ws/hud`,
].map((base) => `${base}?sessionId=${encodeURIComponent(SESSION_ID)}`)

export function connectHud(
  onHud: (h: HudState) => void,
  onStatus: (s: string) => void,
): () => void {
  let ws: WebSocket | null = null
  let closed = false
  let retryMs = 500
  let connectTimer: number | null = null
  let endpointCursor = 0
  let pendingFrame: HudState | null = null
  let rafId: number | null = null
  let lastFrameAt = 0
  const MIN_FRAME_MS = 16 // ~60fps cap

  const flush = () => {
    rafId = null
    if (!pendingFrame) return
    onHud(pendingFrame)
    pendingFrame = null
  }

  const queue = (next: HudState) => {
    if (!next || typeof next !== 'object') return
    const now = performance.now()
    if (now - lastFrameAt < MIN_FRAME_MS && rafId !== null) {
      pendingFrame = next
      return
    }
    lastFrameAt = now
    pendingFrame = next
    if (rafId !== null) return
    rafId = requestAnimationFrame(flush)
  }

  const connect = () => {
    if (closed) return
    const url = HUD_WS_CANDIDATES[endpointCursor % HUD_WS_CANDIDATES.length]
    log.info('connecting hud', { url })
    ws = new WebSocket(url)
    onStatus('connecting')

    ws.onopen = () => {
      retryMs = 500
      onStatus('connected')
      log.info('hud connected')
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
        const data = JSON.parse(ev.data) as HudState
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
