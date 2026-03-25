import { useMemo, memo } from 'react'
import { AppState } from '../lib/types'
import { useStableLeaderboard } from '../hooks/useStableLeaderboard'
import { useGapTrends } from '../hooks/useGapTrends'
import { buildGapMetrics, gapForMode } from '../lib/leaderboardGap'
import { getTeamColors } from '../lib/teamColors'

type Props = { state: AppState | null }

function formatLapTime(ms: number): string {
  if (!ms || ms <= 0) return '-:--'
  const totalSeconds = ms / 1000
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toFixed(3).padStart(6, '0')}`
}

function tyreClass(compound: string): string {
  const c = (compound ?? '').toLowerCase()
  if (c.includes('soft') || c === 'c5' || c === 'c4') return 'is-soft'
  if (c.includes('medium') || c === 'c3') return 'is-medium'
  if (c.includes('hard') || c === 'c2' || c === 'c1') return 'is-hard'
  if (c.includes('inter')) return 'is-inter'
  if (c.includes('wet')) return 'is-wet'
  return 'is-medium'
}

function tyreRingClass(compound: string): string {
  const c = (compound ?? '').toLowerCase()
  if (c.includes('soft') || c === 'c5' || c === 'c4') return 'tyre-ring-soft'
  if (c.includes('medium') || c === 'c3') return 'tyre-ring-medium'
  if (c.includes('hard') || c === 'c2' || c === 'c1') return 'tyre-ring-hard'
  if (c.includes('inter')) return 'tyre-ring-inter'
  if (c.includes('wet')) return 'tyre-ring-wet'
  return 'tyre-ring-medium'
}

function compoundShort(compound: string): string {
  const c = (compound ?? '').toUpperCase()
  if (c.includes('SOFT') || c === 'C5' || c === 'C4') return 'S'
  if (c.includes('MEDIUM') || c === 'C3') return 'M'
  if (c.includes('HARD') || c === 'C2' || c === 'C1') return 'H'
  if (c.includes('INTER')) return 'I'
  if (c.includes('WET')) return 'W'
  return 'M'
}

export const TimingTower = memo(function TimingTower({ state }: Props) {
  const rows = useStableLeaderboard(state?.leaderboard ?? [])
  const gapMetrics = useMemo(() => buildGapMetrics(rows), [rows])

  const trendSamples = useMemo(
    () => rows.map((row) => {
      const metrics = gapMetrics.get(row.car_index)
      const gapS = metrics ? gapForMode('player', metrics, row.position === 1) : 0
      return { carIndex: row.car_index, gapS }
    }),
    [rows, gapMetrics],
  )
  const trendMap = useGapTrends(trendSamples)

  return (
    <section className="timing-tower pw-panel">
      <div className="pw-panel-header">
        <span className="pw-panel-title">TIMING TOWER</span>
        <span className="pw-panel-subtitle">LAP {state?.player.lap ?? '-'}/{state?.total_laps ?? '-'}</span>
      </div>
      <div className="pw-panel-body">
        {rows.length === 0 && (
          <div className="panel-empty-state">타이밍 데이터 대기 중</div>
        )}
        {rows.map((row) => {
          const isPlayer = row.car_index === state?.player_car_index
          const displayName = row.driver_name?.trim() || row.driver_code
          const wear = Number(row.tyre_wear_pct ?? 0)
          const wearClamped = Math.max(0, Math.min(100, wear))
          const circumference = 2 * Math.PI * 14
          const dashoffset = circumference * (1 - wearClamped / 100)
          const metrics = gapMetrics.get(row.car_index)
          const gapS = metrics ? gapForMode('player', metrics, row.position === 1) : 0
          const trend = trendMap.get(row.car_index)
          const trendArrow = trend?.direction === 'closing' ? '↗' : trend?.direction === 'dropping' ? '↘' : ''
          const trendClass = trend?.direction === 'closing' ? 'is-closing' : trend?.direction === 'dropping' ? 'is-dropping' : 'is-stable'
          const teamColors = getTeamColors(row.driver_code)

          return (
            <div key={row.car_index} className={`driver-card ${isPlayer ? 'is-player' : ''}`}>
              <span className="driver-pos" style={{ color: teamColors.body }}>{String(row.position).padStart(2, '0')}</span>

              <div className="driver-info">
                <div className="driver-name-row">
                  <span className="driver-code" title={displayName}>{displayName}</span>
                  <span className={`driver-tyre-dot ${tyreClass(row.tyre_compound)}`} />
                </div>
                <span className="driver-stint-info">
                  {compoundShort(row.tyre_compound)} ({row.stint_lap ?? '-'}L)
                </span>
              </div>

              <div className="driver-laptime-col">
                <div className="driver-laptime">{formatLapTime(row.last_lap_ms)}</div>
                <div className={`driver-gap ${row.position === 1 ? 'is-leader' : gapS > 0 ? 'is-positive' : ''}`}>
                  {row.position === 1 ? 'INTERVAL' : `+${Math.abs(gapS).toFixed(3)}`}
                  {trendArrow && <span className={`trend-arrow ${trendClass}`}>{trendArrow}</span>}
                </div>
              </div>

              <div className="tyre-wear-ring">
                <svg viewBox="0 0 36 36">
                  <circle className="tyre-ring-bg" cx="18" cy="18" r="14" />
                  <circle
                    className={`tyre-ring-fill ${tyreRingClass(row.tyre_compound)}`}
                    cx="18" cy="18" r="14"
                    strokeDasharray={circumference}
                    strokeDashoffset={dashoffset}
                  />
                </svg>
                <span className="tyre-ring-text" style={{
                  position: 'absolute', top: '50%', left: '50%',
                  transform: 'translate(-50%, -50%)',
                  fontFamily: 'var(--font-mono)', fontSize: '9px',
                  color: 'var(--text-secondary)',
                }}>
                  {wearClamped.toFixed(0)}%
                </span>
              </div>

              {row.is_pitting && <span className="pit-badge">PIT</span>}
            </div>
          )
        })}
      </div>
    </section>
  )
})
