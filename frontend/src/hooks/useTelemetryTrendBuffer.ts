import { useEffect, useRef, useState } from 'react'
import { AppState } from '../lib/types'
import { sanitizeTelemetrySample, TelemetryTrendSample, trimTrendWindow } from '../lib/telemetryTrend'

type Options = {
  windowMs: number
  maxPoints: number
}

export function useTelemetryTrendBuffer(state: AppState | null, options: Options): TelemetryTrendSample[] {
  const [points, setPoints] = useState<TelemetryTrendSample[]>([])
  const pointsRef = useRef<TelemetryTrendSample[]>([])
  const rafRef = useRef<number | null>(null)
  const isMountedRef = useRef(true)
  const lastFrameRef = useRef<number>(-1)

  // Cleanup RAF on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (!state) return

    const packetType = state.ingest_stats?.last_packet_type ?? ''
    const frame = state.last_frame_identifier ?? 0
    const isTelemetryTick = packetType === 'car_telemetry' || packetType === 'car_status' || packetType === 'lap_data'
    if (!isTelemetryTick) return
    if (lastFrameRef.current === frame) return
    lastFrameRef.current = frame

    const prev = pointsRef.current[pointsRef.current.length - 1]
    const next = sanitizeTelemetrySample(
      {
        throttle: state.player.throttle,
        brake: state.player.brake,
        speed: state.player.speed,
        gear: state.player.gear,
        rpm: state.player.rpm > 0 ? state.player.rpm : Math.max(0, state.player.speed * 45 + state.player.throttle * 2500 + 800),
        ersPct: Math.max(0, Math.min(100, (state.player.ers / 5_000_000) * 100)),
        lapDeltaMs: state.player.current_lap_ms - (state.pace.best_lap_ms || state.player.current_lap_ms),
      },
      prev,
    )

    const merged = [...pointsRef.current, next]
    pointsRef.current = trimTrendWindow(merged, options.windowMs, options.maxPoints)

    if (rafRef.current !== null) return
    rafRef.current = requestAnimationFrame(() => {
      // Only update state if component is still mounted
      if (isMountedRef.current) {
        setPoints(pointsRef.current)
      }
      rafRef.current = null
    })
  }, [state, options.maxPoints, options.windowMs])

  return points
}
