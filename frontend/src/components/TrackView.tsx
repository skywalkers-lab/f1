import { useMemo, memo } from 'react'
import { AppState } from '../lib/types'
import { RaceStateSnapshot } from '../lib/dashboardMetrics'
import { MinimapPanel } from './MinimapPanel'
import { BattleControlsPanel } from './BattleControlsPanel'
import { TopStatusPanel } from './TopStatusPanel'
import { TelemetryTrendsPanel } from './TelemetryTrendsPanel'
import { getTeamColors } from '../lib/teamColors'

type Props = { state: AppState | null; status: string; evaluation: RaceStateSnapshot }

export const TrackView = memo(function TrackView({ state, status, evaluation }: Props) {
  const playerIdx = state?.player_car_index ?? -1
  const leaderboard = state?.leaderboard ?? []
  const playerRow = leaderboard.find((r) => r.car_index === playerIdx)
  const position = state?.player.position ?? 0
  const totalCars = leaderboard.length

  // Gap to car ahead & behind
  const { sorted, myPos, carAhead, carBehind, pitting } = useMemo(() => {
    const s = [...leaderboard].sort((a, b) => a.position - b.position)
    const pos = s.findIndex((r) => r.car_index === playerIdx)
    return {
      sorted: s,
      myPos: pos,
      carAhead: pos > 0 ? s[pos - 1] : null,
      carBehind: pos >= 0 && pos < s.length - 1 ? s[pos + 1] : null,
      pitting: leaderboard.filter((r) => r.is_pitting),
    }
  }, [leaderboard, playerIdx])

  return (
    <div className="track-view">
      {/* Status strip */}
      <TopStatusPanel state={state} status={status} evaluation={evaluation} />

      <div className="track-view-grid">
        {/* Left: Extended minimap */}
        <div className="track-view-map">
          <MinimapPanel state={state} />
        </div>

        {/* Right: Battle controls + position overview */}
        <div className="track-view-sidebar">
          {/* Position card */}
          <section className="pw-panel track-position-card">
            <div className="pw-panel-header">
              <span className="pw-panel-title">TRACK POSITION</span>
            </div>
            <div className="track-pos-big">P{position}<span className="track-pos-total">/{totalCars}</span></div>
            <div className="track-gap-grid">
              <div className="track-gap-item">
                <span className="track-gap-label">GAP AHEAD</span>
                <span className="track-gap-value is-ok">
                  {carAhead ? `${carAhead.gap_to_player_s > 0 ? '+' : ''}${(carAhead.gap_to_player_s - (playerRow?.gap_to_player_s ?? 0)).toFixed(2)}s` : '-'}
                </span>
                {carAhead && (
                  <span className="track-gap-driver" style={{ color: getTeamColors(carAhead.driver_code).body }}>
                    {carAhead.driver_code} P{carAhead.position}
                  </span>
                )}
              </div>
              <div className="track-gap-item">
                <span className="track-gap-label">GAP BEHIND</span>
                <span className="track-gap-value is-critical">
                  {carBehind ? `${carBehind.gap_to_player_s > 0 ? '+' : ''}${carBehind.gap_to_player_s.toFixed(2)}s` : '-'}
                </span>
                {carBehind && (
                  <span className="track-gap-driver" style={{ color: getTeamColors(carBehind.driver_code).body }}>
                    {carBehind.driver_code} P{carBehind.position}
                  </span>
                )}
              </div>
            </div>
          </section>

          {/* Live pit activity */}
          <section className="pw-panel track-pit-activity">
            <div className="pw-panel-header">
              <span className="pw-panel-title">PIT ACTIVITY</span>
              <span className="pw-panel-badge">{pitting.length} IN PIT</span>
            </div>
            {pitting.length === 0 ? (
              <div className="panel-empty-state">현재 피트 인 차량 없음</div>
            ) : (
              <div className="pit-activity-list">
                {pitting.map((r) => (
                  <div key={r.car_index} className="pit-activity-row">
                    <span className="pit-driver" style={{ color: getTeamColors(r.driver_code).body }}>
                      {r.driver_code}
                    </span>
                    <span className="pit-pos">P{r.position}</span>
                    <span className={`stint-compound-tag is-${(r.tyre_compound ?? '').toLowerCase().includes('soft') ? 'soft' : (r.tyre_compound ?? '').toLowerCase().includes('hard') ? 'hard' : 'medium'}`}>
                      {r.tyre_compound}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Vehicle operations */}
          <BattleControlsPanel state={state} evaluation={evaluation} />
        </div>
      </div>

      {/* Telemetry trends at bottom */}
      <TelemetryTrendsPanel state={state} />
    </div>
  )
})
