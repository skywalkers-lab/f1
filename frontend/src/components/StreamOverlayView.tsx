/**
 * StreamOverlayView — OBS-compatible transparent overlay page.
 * Inspired by pits-n-giggles' player-stream-overlay.html.
 *
 * Composes:
 * - TimingTowerOverlay (left side)
 * - LapTimerOverlay (top-center)
 * - InputTelemetryOverlay (bottom-center)
 * - MFDOverlay (right side)
 *
 * Connects to /ws/overlay for compact race data at ~20Hz.
 * Transparent background for chroma-key or browser source overlay.
 */
import { useEffect, useState, useMemo, useRef } from 'react'
import { connectOverlay, OverlayState } from '../lib/overlayWs'
import { connectHud } from '../lib/hudWs'
import { HudState } from '../lib/hudTypes'
import { TimingTowerOverlay } from './overlay/TimingTowerOverlay'
import { LapTimerOverlay } from './overlay/LapTimerOverlay'
import { InputTelemetryOverlay } from './overlay/InputTelemetryOverlay'
import { MFDOverlay } from './overlay/MFDOverlay'

type OverlayMode = 'full' | 'timing' | 'input' | 'mfd' | 'laptimer'

function getOverlayMode(): OverlayMode {
  const params = new URLSearchParams(window.location.search)
  const mode = params.get('mode')
  if (mode === 'timing' || mode === 'input' || mode === 'mfd' || mode === 'laptimer') return mode
  return 'full'
}

export function StreamOverlayView() {
  const [overlayState, setOverlayState] = useState<OverlayState | null>(null)
  const [hudState, setHudState] = useState<HudState | null>(null)
  const [overlayStatus, setOverlayStatus] = useState('connecting')
  const [hudStatus, setHudStatus] = useState('connecting')
  const mode = useMemo(getOverlayMode, [])

  useEffect(() => {
    const disconnectOverlay = connectOverlay(setOverlayState, setOverlayStatus)
    const disconnectHud = connectHud(setHudState, setHudStatus)
    return () => {
      disconnectOverlay()
      disconnectHud()
    }
  }, [])

  const player = overlayState?.player
  const leaderboard = overlayState?.leaderboard ?? []

  // Default values for when data isn't available
  const throttle = player?.throttle ?? 0
  const brake = player?.brake ?? 0
  const steer = player?.steer ?? 0
  const speed = player?.speed ?? 0
  const gear = player?.gear ?? 0
  const rpm = player?.rpm ?? 0
  const drs = player?.drs ?? false
  const position = player?.position ?? 0
  const lap = player?.lap ?? 0
  const totalLaps = overlayState?.total_laps ?? 0
  const currentLapMs = player?.current_lap_ms ?? 0
  const lastLapMs = player?.last_lap_ms ?? 0
  const bestLapMs = player?.best_lap_ms ?? 0
  const tyreCompound = player?.tyre_compound ?? ''
  const tyreWearPct = player?.tyre_wear_pct ?? 0
  const fuelKg = player?.fuel ?? 0
  const ersPct = hudState?.ers_pct ?? 0

  const tyreInfo = useMemo(() => ({
    compound: tyreCompound,
    wearPct: tyreWearPct,
    stintLap: lap, // approximate
    surfaceTemps: player?.tyre_surface_temps_c ?? [0, 0, 0, 0],
    innerTemps: player?.tyre_inner_temps_c ?? [0, 0, 0, 0],
  }), [tyreCompound, tyreWearPct, lap, player])

  const fuelInfo = useMemo(() => ({
    fuelKg,
    fuelLapsRemaining: totalLaps > 0 ? Math.max(0, totalLaps - lap) : 0,
    fuelPerLap: fuelKg > 0 && lap > 1 ? fuelKg / (lap - 1) : 1.5,
    targetDelta: 0,
  }), [fuelKg, totalLaps, lap])

  const weatherInfo = useMemo(() => ({
    state: overlayState?.weather_state ?? 'WEATHER_0',
    trackTempC: 0,
    airTempC: 0,
  }), [overlayState?.weather_state])

  const lapInfo = useMemo(() => ({
    currentMs: currentLapMs,
    lastMs: lastLapMs,
    bestMs: bestLapMs,
    lap,
    totalLaps,
  }), [currentLapMs, lastLapMs, bestLapMs, lap, totalLaps])

  const ersInfo = useMemo(() => ({
    ersPct,
    ersDeployMode: 'BALANCED',
  }), [ersPct])

  const damageInfo = useMemo(() => ({
    frontWing: 0,
    rearWing: 0,
    floor: 0,
    diffuser: 0,
    engine: 0,
    gearbox: 0,
  }), [])

  if (!overlayState) {
    return (
      <div className="stream-overlay-shell">
        <div className="overlay-connecting">
          {overlayStatus === 'connecting' ? 'CONNECTING...' : 'RECONNECTING...'}
        </div>
      </div>
    )
  }

  return (
    <div className="stream-overlay-shell" data-mode={mode}>
      {/* Left: Timing Tower */}
      {(mode === 'full' || mode === 'timing') && (
        <div className="overlay-slot overlay-left">
          <TimingTowerOverlay
            leaderboard={leaderboard as any}
            playerCarIndex={0}
          />
        </div>
      )}

      {/* Top Center: Lap Timer */}
      {(mode === 'full' || mode === 'laptimer') && (
        <div className="overlay-slot overlay-top-center">
          <LapTimerOverlay
            currentLapMs={currentLapMs}
            lastLapMs={lastLapMs}
            bestLapMs={bestLapMs}
            lap={lap}
            totalLaps={totalLaps}
            position={position}
          />
        </div>
      )}

      {/* Bottom Center: Input Telemetry */}
      {(mode === 'full' || mode === 'input') && (
        <div className="overlay-slot overlay-bottom-center">
          <InputTelemetryOverlay
            throttle={throttle}
            brake={brake}
            steer={steer}
            speed={speed}
            gear={gear}
            rpm={rpm}
            drs={drs}
          />
        </div>
      )}

      {/* Right: MFD */}
      {(mode === 'full' || mode === 'mfd') && (
        <div className="overlay-slot overlay-right">
          <MFDOverlay
            tyre={tyreInfo}
            fuel={fuelInfo}
            weather={weatherInfo}
            laps={lapInfo}
            ers={ersInfo}
            damage={damageInfo}
            position={position}
          />
        </div>
      )}

      {/* Race Control Banner (top) */}
      {overlayState.race_control_state && overlayState.race_control_state !== 'SC_0' && (
        <div className="overlay-race-control">
          {overlayState.race_control_state.includes('1') ? '⚠ SAFETY CAR' :
           overlayState.race_control_state.includes('2') ? '⚠ VIRTUAL SAFETY CAR' :
           overlayState.race_control_state.includes('3') ? '🔴 RED FLAG' : ''}
        </div>
      )}
    </div>
  )
}
