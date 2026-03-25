/**
 * LapTimerOverlay — Focused lap timer with sector deltas.
 * Inspired by pits-n-giggles' lap_timer overlay (current/last/best + delta).
 * Designed for transparent background overlay placement.
 */
import { memo, useMemo } from 'react'

type Props = {
  currentLapMs: number
  lastLapMs: number
  bestLapMs: number
  lap: number
  totalLaps: number
  position: number
  sectors?: {
    sector1Ms: number
    sector2Ms: number
    sector3Ms: number
    bestSector1Ms: number
    bestSector2Ms: number
    bestSector3Ms: number
  }
}

function formatLapTime(ms: number): string {
  if (ms <= 0) return '--:--.---'
  const totalS = ms / 1000
  const minutes = Math.floor(totalS / 60)
  const seconds = totalS % 60
  return `${minutes}:${seconds.toFixed(3).padStart(6, '0')}`
}

function formatDelta(deltaMs: number): string {
  if (deltaMs === 0) return '±0.000'
  const sign = deltaMs > 0 ? '+' : '-'
  return `${sign}${(Math.abs(deltaMs) / 1000).toFixed(3)}`
}

function deltaClass(deltaMs: number): string {
  if (deltaMs < -50) return 'is-purple'
  if (deltaMs < 0) return 'is-green'
  if (deltaMs > 500) return 'is-bad'
  if (deltaMs > 0) return 'is-yellow'
  return ''
}

function LapTimerComponent({ currentLapMs, lastLapMs, bestLapMs, lap, totalLaps, position, sectors }: Props) {
  const deltaToLastMs = lastLapMs > 0 && bestLapMs > 0 ? lastLapMs - bestLapMs : 0
  const isPersonalBest = lastLapMs > 0 && lastLapMs <= bestLapMs

  const sectorDeltas = useMemo(() => {
    if (!sectors) return null
    return [
      { ms: sectors.sector1Ms, bestMs: sectors.bestSector1Ms, label: 'S1' },
      { ms: sectors.sector2Ms, bestMs: sectors.bestSector2Ms, label: 'S2' },
      { ms: sectors.sector3Ms, bestMs: sectors.bestSector3Ms, label: 'S3' },
    ]
  }, [sectors])

  return (
    <div className="overlay-lap-timer">
      {/* Position & Lap badge */}
      <div className="lap-timer-header">
        <span className="lap-timer-position">P{position}</span>
        <span className="lap-timer-lap">LAP {lap}/{totalLaps}</span>
      </div>

      {/* Current lap time (large) */}
      <div className="lap-timer-current">
        <span className="lap-timer-time">{formatLapTime(currentLapMs)}</span>
      </div>

      {/* Last lap + delta */}
      <div className="lap-timer-row">
        <span className="lap-timer-label">LAST</span>
        <span className={`lap-timer-value ${isPersonalBest ? 'is-green' : ''}`}>
          {formatLapTime(lastLapMs)}
        </span>
        {deltaToLastMs !== 0 && (
          <span className={`lap-timer-delta ${deltaClass(deltaToLastMs)}`}>
            {formatDelta(deltaToLastMs)}
          </span>
        )}
      </div>

      {/* Best lap */}
      <div className="lap-timer-row">
        <span className="lap-timer-label">BEST</span>
        <span className="lap-timer-value is-purple">{formatLapTime(bestLapMs)}</span>
      </div>

      {/* Sector deltas */}
      {sectorDeltas && (
        <div className="lap-timer-sectors">
          {sectorDeltas.map((s) => {
            const delta = s.ms > 0 && s.bestMs > 0 ? s.ms - s.bestMs : 0
            const active = s.ms > 0
            return (
              <div key={s.label} className={`sector-delta-cell ${active ? deltaClass(delta) : 'is-inactive'}`}>
                <span className="sector-label">{s.label}</span>
                {active ? (
                  <span className="sector-delta-value">{formatDelta(delta)}</span>
                ) : (
                  <span className="sector-delta-value">-</span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export const LapTimerOverlay = memo(LapTimerComponent)
