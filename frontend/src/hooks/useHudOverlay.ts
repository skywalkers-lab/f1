/**
 * useHudOverlay — React hook for connecting to the HUD WebSocket endpoint.
 *
 * Provides real-time HUD overlay data from the backend OverlayManager,
 * including composite view models for all registered overlays.
 *
 * Inspired by pits-n-giggles' Socket.IO stream-overlay-update channel
 * and the HUD listener/client architecture.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

export type HudCompositeView = {
  type: 'hud_composite'
  frame: number
  overlays: Record<string, Record<string, unknown>>
}

export type HudConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error'

export type UseHudOverlayReturn = {
  composite: HudCompositeView | null
  status: HudConnectionStatus
  sendCommand: (cmd: Record<string, unknown>) => void
  navigateMfd: (direction: 'next' | 'prev') => void
  toggleOverlay: (overlayId: string, visible: boolean) => void
  setOpacity: (overlayId: string, opacity: number) => void
  toggleAll: (visible: boolean) => void
}

const HUD_WS_CANDIDATES = [
  `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/hud`,
  `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname}:8765/ws/hud`,
  `${location.protocol === 'https:' ? 'wss' : 'ws'}://127.0.0.1:8765/ws/hud`,
]

export function useHudOverlay(): UseHudOverlayReturn {
  const [composite, setComposite] = useState<HudCompositeView | null>(null)
  const [status, setStatus] = useState<HudConnectionStatus>('connecting')
  const wsRef = useRef<WebSocket | null>(null)
  const closedRef = useRef(false)
  const retryMsRef = useRef(500)
  const endpointRef = useRef(0)

  const connect = useCallback(() => {
    if (closedRef.current) return

    const url = HUD_WS_CANDIDATES[endpointRef.current % HUD_WS_CANDIDATES.length]
    setStatus('connecting')

    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => {
      setStatus('connected')
      retryMsRef.current = 500
    }

    ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data)
        if (data.type === 'hud_composite' || data.overlays) {
          setComposite(data as HudCompositeView)
        }
      } catch {
        // ignore parse errors
      }
    }

    ws.onclose = () => {
      if (closedRef.current) return
      setStatus('disconnected')
      endpointRef.current++
      setTimeout(connect, Math.min(retryMsRef.current, 5000))
      retryMsRef.current = Math.min(retryMsRef.current * 1.5, 10000)
    }

    ws.onerror = () => {
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    closedRef.current = false
    connect()
    return () => {
      closedRef.current = true
      wsRef.current?.close()
    }
  }, [connect])

  const sendCommand = useCallback((cmd: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(cmd))
    }
  }, [])

  const navigateMfd = useCallback((direction: 'next' | 'prev') => {
    sendCommand({ type: 'mfd_navigate', direction })
  }, [sendCommand])

  const toggleOverlay = useCallback((overlayId: string, visible: boolean) => {
    sendCommand({ type: 'set_visibility', overlay_id: overlayId, visible })
  }, [sendCommand])

  const setOpacity = useCallback((overlayId: string, opacity: number) => {
    sendCommand({ type: 'set_opacity', overlay_id: overlayId, opacity })
  }, [sendCommand])

  const toggleAll = useCallback((visible: boolean) => {
    sendCommand({ type: 'toggle_all', visible })
  }, [sendCommand])

  return {
    composite,
    status,
    sendCommand,
    navigateMfd,
    toggleOverlay,
    setOpacity,
    toggleAll,
  }
}
