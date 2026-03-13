import { AppState } from './types'

export function connectState(onState: (s: AppState) => void, onStatus: (s: string) => void): WebSocket {
  const ws = new WebSocket('ws://127.0.0.1:8765/ws')
  ws.onopen = () => onStatus('connected')
  ws.onclose = () => onStatus('disconnected')
  ws.onerror = () => onStatus('error')
  ws.onmessage = (ev) => onState(JSON.parse(ev.data) as AppState)
  return ws
}
