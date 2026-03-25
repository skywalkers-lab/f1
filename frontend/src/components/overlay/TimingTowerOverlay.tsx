/**
 * TimingTowerOverlay — Compact F1 TV-style timing tower for stream overlay.
 * Inspired by pits-n-giggles' timing_tower overlay.
 * Shows top N drivers + adjacent rivals with tyre/gap info.
 */
import { memo, useMemo } from 'react'

type LeaderboardEntry = {
  car_index: number
  driver_code: string
  position: number
  gap_to_leader_s: number
  gap_to_player_s: number
  last_lap_ms: number
  tyre_compound: string
  stint_lap: number
  is_pitting: boolean
}

type Props = {
  leaderboard: LeaderboardEntry[]
  playerCarIndex: number
  maxVisible?: number
}

function formatGap(gapS: number, isLeader: boolean): string {
  if (isLeader) return 'LEADER'
  if (gapS === 0) return '-'
  return `+${Math.abs(gapS).toFixed(1)}`
}

function compoundClass(compound: string): string {
  const c = compound?.toUpperCase() || ''
  if (c.includes('SOFT') || c === 'C5' || c === 'C4' || c === 'C3') return 'is-soft'
  if (c.includes('MED') || c === 'C2') return 'is-medium'
  if (c.includes('HARD') || c === 'C1') return 'is-hard'
  if (c.includes('INTER')) return 'is-inter'
  if (c.includes('WET')) return 'is-wet'
  return ''
}

function compoundShort(compound: string): string {
  const c = compound?.toUpperCase() || ''
  if (c.includes('SOFT')) return 'S'
  if (c.includes('MED')) return 'M'
  if (c.includes('HARD')) return 'H'
  if (c.includes('INTER')) return 'I'
  if (c.includes('WET')) return 'W'
  return c.charAt(0) || '?'
}

function TimingTowerComponent({ leaderboard, playerCarIndex, maxVisible = 8 }: Props) {
  const visibleRows = useMemo(() => {
    if (!leaderboard || leaderboard.length === 0) return []
    const sorted = [...leaderboard].sort((a, b) => a.position - b.position)
    const playerIdx = sorted.findIndex((r) => r.car_index === playerCarIndex)

    if (sorted.length <= maxVisible) return sorted

    // Show top 3 + cars around player + bottom if space
    const selected = new Set<number>()
    // Top 3
    for (let i = 0; i < Math.min(3, sorted.length); i++) selected.add(i)
    // Player + neighbors
    if (playerIdx >= 0) {
      for (let i = Math.max(0, playerIdx - 1); i <= Math.min(sorted.length - 1, playerIdx + 1); i++) {
        selected.add(i)
      }
    }
    // Fill remaining slots
    const indices = Array.from(selected).sort((a, b) => a - b)
    if (indices.length < maxVisible) {
      for (let i = 0; i < sorted.length && indices.length < maxVisible; i++) {
        if (!selected.has(i)) {
          indices.push(i)
          selected.add(i)
        }
      }
      indices.sort((a, b) => a - b)
    }

    return indices.slice(0, maxVisible).map((i) => sorted[i])
  }, [leaderboard, playerCarIndex, maxVisible])

  if (visibleRows.length === 0) return null

  return (
    <div className="overlay-timing-tower">
      {visibleRows.map((row) => {
        const isPlayer = row.car_index === playerCarIndex
        return (
          <div
            key={row.car_index}
            className={`tower-row ${isPlayer ? 'is-player' : ''} ${row.is_pitting ? 'is-pitting' : ''}`}
          >
            <span className="tower-pos">{row.position}</span>
            <span className="tower-code">{row.driver_code || `C${row.car_index}`}</span>
            <span className={`tower-tyre ${compoundClass(row.tyre_compound)}`}>
              {compoundShort(row.tyre_compound)}
            </span>
            <span className="tower-stint">L{row.stint_lap}</span>
            <span className="tower-gap">
              {formatGap(row.gap_to_leader_s, row.position === 1)}
            </span>
            {row.is_pitting && <span className="tower-pit-badge">PIT</span>}
          </div>
        )
      })}
    </div>
  )
}

export const TimingTowerOverlay = memo(TimingTowerComponent)
