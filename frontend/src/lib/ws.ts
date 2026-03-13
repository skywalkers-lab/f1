import { AppState } from './types'

const WS_URL = 'ws://127.0.0.1:8765/ws'

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

    ws.onerror = () => onStatus('error')

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
