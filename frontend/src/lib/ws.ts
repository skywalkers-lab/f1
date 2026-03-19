import { AppState } from './types'

const pageProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
const currentHost = window.location.hostname
const backendPort = '8765'
const WS_URL = `${pageProtocol}://${currentHost}:${backendPort}/ws`
const API_BASE = `${window.location.protocol}//${currentHost}:${backendPort}`

export function connectState(onState: (s: AppState) => void, onStatus: (s: string) => void): () => void {
  let ws: WebSocket | null = null
  let closed = false
  let retryMs = 500

  const connect = () => {
    if (closed) return
    ws = new WebSocket(WS_URL)
    onStatus('connecting')

    ws.onopen = () => {
      retryMs = 500
      onStatus('connected')
    }

    ws.onclose = () => {
      onStatus('disconnected')
      if (!closed) {
        setTimeout(connect, retryMs)
        retryMs = Math.min(retryMs * 2, 5000)
      }
    }

    ws.onerror = () => {
      onStatus('error')
    }

    ws.onmessage = (ev) => {
      const data = JSON.parse(ev.data) as AppState | { type: string }
      if ('type' in data && data.type === 'heartbeat') {
        if (ws?.readyState === WebSocket.OPEN) ws.send('pong')
        return
      }
      onState(data as AppState)
    }
  }

  connect()

  return () => {
    closed = true
    ws?.close()
  }
}

export async function postStrategyFeedback(params: {
  userId: string
  sessionType: string
  action: string
  reward: number
}): Promise<boolean> {
  try {
    const resp = await fetch(`${API_BASE}/ml/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: params.userId,
        session_type: params.sessionType,
        action: params.action,
        reward: params.reward,
      }),
    })
    return resp.ok
  } catch {
    return false
  }
}
