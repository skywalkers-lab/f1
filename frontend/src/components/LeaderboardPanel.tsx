import { useMemo, useState, memo } from 'react'
import { AppState } from '../lib/types'
import { buildGapMetrics, formatGap, GapMode, gapForMode, gapModeLabel } from '../lib/leaderboardGap'
import { useStableLeaderboard } from '../hooks/useStableLeaderboard'
import { useGapTrends } from '../hooks/useGapTrends'
import { useLeaderboardTacticalAnalysis } from '../hooks/useLeaderboardTacticalAnalysis'
import { LeaderboardRow } from './leaderboard/LeaderboardRow'

type Props = { state: AppState | null }

const GAP_MODES: GapMode[] = ['player', 'leader', 'interval']

function buildRowRenderVersion(params: {
  carIndex: number
  position: number
  index: number
  isPlayer: boolean
  gapText: string
  intervalText: string
  gapMode: GapMode
  trendDirection: string
  trendDelta: number
}): string {
  return [
    params.carIndex,
    params.position,
    params.index,
    params.isPlayer ? 1 : 0,
    params.gapText,
    params.intervalText,
    params.gapMode,
    params.trendDirection,
    params.trendDelta.toFixed(3),
  ].join('|')
}

export const LeaderboardPanel = memo(function LeaderboardPanel({ state }: Props) {
  const [gapMode, setGapMode] = useState<GapMode>('player')
  const rows = useStableLeaderboard(state?.leaderboard ?? [])

  const gapMetrics = useMemo(() => buildGapMetrics(rows), [rows])
  const pittingCount = rows.filter((row) => row.is_pitting).length

  const trendSamples = useMemo(
    () =>
      rows.map((row) => {
        const metrics = gapMetrics.get(row.car_index)
        const isLeader = row.position === 1
        const gapS = metrics ? gapForMode(gapMode, metrics, isLeader) : 0
        return { carIndex: row.car_index, gapS }
      }),
    [rows, gapMetrics, gapMode],
  )

  const trendMap = useGapTrends(trendSamples)
  const tacticalMap = useLeaderboardTacticalAnalysis(state, rows, trendMap)

  if (!state || rows.length === 0) {
    return (
      <section className="panel leaderboard-panel">
        <div className="panel-header">
          <h3>레이스 타이밍 <span className="badge-raw">LIVE</span></h3>
          <div className="small">정렬된 리더보드 대기</div>
        </div>
        <div className="panel-empty-state">차량 순위, 갭, 섹터 마크가 들어오면 라이브 타이밍 테이블로 전환됩니다.</div>
      </section>
    )
  }

  return (
    <section className="panel leaderboard-panel">
      <div className="panel-header">
        <h3>
          레이스 타이밍 <span className="badge-raw">LIVE</span><span className="badge-est">TREND</span>
        </h3>
        <div className="small">공식 타이밍 스타일 · 섹터 퍼플 단일화 · 표시 {rows.length}대 · 피트 {pittingCount}대</div>
      </div>

      <div className="leaderboard-controls" role="tablist" aria-label="Gap mode selection">
        {GAP_MODES.map((mode) => (
          <button
            key={mode}
            type="button"
            className={`gap-mode-btn ${gapMode === mode ? 'is-active' : ''}`}
            onClick={() => setGapMode(mode)}
            aria-pressed={gapMode === mode}
          >
            {gapModeLabel(mode)}
          </button>
        ))}
      </div>

      <div className="leaderboard-legend" aria-label="Leaderboard legend">
        <span className="legend-item"><span className="legend-dot is-player" />내 차량</span>
        <span className="legend-item"><span className="legend-dot is-purple" />섹터 베스트</span>
        <span className="legend-item"><span className="legend-dot is-green" />개인 베스트</span>
        <span className="legend-item"><span className="legend-dot is-alert" />전략 리스크</span>
      </div>

      <div className="table-wrap leaderboard-table-wrap">
        <table className="table leaderboard-table">
          <thead>
            <tr>
              <th>순위</th>
              <th>드라이버</th>
              <th>GAP</th>
              <th>INT</th>
              <th>타이어 · 스틴트</th>
              <th>랩타임 · 섹터</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const isPlayer = row.car_index === state?.player_car_index
              const metrics = gapMetrics.get(row.car_index)
              const gapValue = metrics ? gapForMode(gapMode, metrics, row.position === 1) : 0
              const gapText = formatGap(gapValue, gapMode, row.position === 1)
              const intervalText = metrics && row.position !== 1 ? `${metrics.intervalAhead.toFixed(3)}s` : row.position === 1 ? 'LEADER' : '-'
              const trend = trendMap.get(row.car_index) ?? { direction: 'stable', delta: 0 }
              const tactical = tacticalMap.get(row.car_index)
              const renderVersion = buildRowRenderVersion({
                carIndex: row.car_index,
                position: row.position,
                index,
                isPlayer,
                gapText,
                intervalText,
                gapMode,
                trendDirection: trend.direction,
                trendDelta: trend.delta,
              })

              if (!tactical) return null

              return (
                <LeaderboardRow
                  key={row.car_index}
                  row={row}
                  index={index}
                  isPlayer={isPlayer}
                  gapText={gapText}
                  intervalText={intervalText}
                  gapMode={gapMode}
                  trend={trend}
                  tactical={tactical}
                  renderVersion={renderVersion}
                />
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
})
