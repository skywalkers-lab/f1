import { useMemo, useState } from 'react'
import { AppState } from '../lib/types'
import { RaceStateSnapshot } from '../lib/dashboardMetrics'
import { usePaceAnalysis } from '../hooks/usePaceAnalysis'
import { useRaceStateEvaluation } from '../hooks/useRaceStateEvaluation'
import { getTeamColors } from '../lib/teamColors'

type Props = { state: AppState | null; status: string; evaluation: RaceStateSnapshot }

function formatLapTime(ms: number): string {
  if (!ms || ms <= 0) return '-:--'
  return `${Math.floor(ms / 60000)}:${((ms % 60000) / 1000).toFixed(3).padStart(6, '0')}`
}

export function ReplayView({ state, status, evaluation }: Props) {
  const pace = usePaceAnalysis(state)
  const raceState = useRaceStateEvaluation(state, status)
  const [selectedLap, setSelectedLap] = useState<number | null>(null)

  const currentLap = state?.player.lap ?? 0
  const totalLaps = state?.total_laps ?? 0

  // Build lap summary data from pace rows
  const lapSummaries = useMemo(() => {
    return pace.rows.map((r) => ({
      lap: r.lap,
      timeText: r.lapTimeText,
      timeMs: r.lapTimeMs,
      deltaText: r.deltaToRollingAvgText,
      deltaTone: r.deltaTone,
      isBest: r.isBestRecent,
      isOutlier: r.isOutlier,
      trend: r.changeSymbol,
    }))
  }, [pace.rows])

  // Build stint history from leaderboard data
  const stintHistory = useMemo(() => {
    if (!state) return []
    const playerRow = state.leaderboard.find((r) => r.car_index === state.player_car_index)
    const compound = playerRow?.tyre_compound ?? state.player.tyre_compound
    const stintLap = playerRow?.stint_lap ?? currentLap
    const wear = playerRow?.tyre_wear_pct ?? 0
    return [{
      stint: 1,
      compound,
      startLap: Math.max(1, currentLap - stintLap + 1),
      endLap: currentLap,
      laps: stintLap,
      wearPct: wear,
    }]
  }, [state, currentLap])

  // Position history from leaderboard
  const positionChanges = useMemo(() => {
    if (!state) return []
    return state.leaderboard
      .filter((r) => r.is_pitting)
      .map((r) => ({
        driverCode: r.driver_code,
        position: r.position,
        event: 'PIT STOP',
        colors: getTeamColors(r.driver_code),
      }))
  }, [state?.leaderboard])

  // Race events from evaluation
  const events = raceState.events

  const selectedLapData = selectedLap ? lapSummaries.find((l) => l.lap === selectedLap) : null

  return (
    <div className="replay-view">
      {/* Race Progress */}
      <section className="pw-panel replay-section">
        <div className="pw-panel-header">
          <span className="pw-panel-title">RACE PROGRESS</span>
          <span className="pw-panel-subtitle">LAP {currentLap}/{totalLaps}</span>
        </div>
        <div className="progress-bar-wrap">
          <div className="progress-bar-track">
            <div className="progress-bar-fill" style={{ width: `${evaluation.sessionProgressPct}%` }} />
          </div>
          <div className="progress-markers">
            {stintHistory.map((s, i) => (
              <div
                key={i}
                className="progress-stint-marker"
                style={{
                  left: `${totalLaps ? (s.startLap / totalLaps) * 100 : 0}%`,
                  width: `${totalLaps ? (s.laps / totalLaps) * 100 : 0}%`,
                }}
              >
                <span className={`stint-compound-tag is-${(s.compound ?? '').toLowerCase().includes('soft') ? 'soft' : (s.compound ?? '').toLowerCase().includes('hard') ? 'hard' : 'medium'}`}>
                  {s.compound}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Lap-by-Lap Review */}
      <section className="pw-panel replay-section">
        <div className="pw-panel-header">
          <span className="pw-panel-title">LAP-BY-LAP REVIEW</span>
          <span className="pw-panel-subtitle">{lapSummaries.length} laps recorded</span>
        </div>
        <div className="lap-grid-wrap">
          <div className="lap-grid">
            {lapSummaries.map((l) => (
              <button
                key={l.lap}
                type="button"
                className={`lap-cell ${l.isBest ? 'is-best' : ''} ${l.isOutlier ? 'is-outlier' : ''} ${selectedLap === l.lap ? 'is-selected' : ''}`}
                onClick={() => setSelectedLap(l.lap === selectedLap ? null : l.lap)}
              >
                <span className="lap-cell-num">{l.lap}</span>
                <span className="lap-cell-time">{l.timeText}</span>
                <span className={`lap-cell-delta ${l.deltaTone === 'positive' ? 'is-ok' : l.deltaTone === 'negative' ? 'is-critical' : ''}`}>
                  {l.trend === 'UP' ? '↗' : l.trend === 'DOWN' ? '↘' : '—'}
                </span>
              </button>
            ))}
          </div>
        </div>
        {selectedLapData && (
          <div className="lap-detail-box">
            <div className="lap-detail-title">LAP {selectedLapData.lap} DETAIL</div>
            <div className="lap-detail-grid">
              <span>Time: <strong>{selectedLapData.timeText}</strong></span>
              <span>Δ Avg: <strong className={selectedLapData.deltaTone === 'positive' ? 'is-ok' : selectedLapData.deltaTone === 'negative' ? 'is-critical' : ''}>{selectedLapData.deltaText}</strong></span>
              <span>Trend: {selectedLapData.trend}</span>
              {selectedLapData.isBest && <span className="is-ok">★ Session Best</span>}
              {selectedLapData.isOutlier && <span className="is-warn">⚠ Outlier</span>}
            </div>
          </div>
        )}
      </section>

      {/* Stint Summary */}
      <section className="pw-panel replay-section">
        <div className="pw-panel-header">
          <span className="pw-panel-title">STINT HISTORY</span>
        </div>
        {stintHistory.length === 0 ? (
          <div className="panel-empty-state">스틴트 데이터 대기</div>
        ) : (
          <div className="stint-table-wrap">
            <table className="scenario-table">
              <thead><tr><th>STINT</th><th>COMPOUND</th><th>LAPS</th><th>START</th><th>END</th><th>WEAR</th></tr></thead>
              <tbody>
                {stintHistory.map((s) => (
                  <tr key={s.stint}>
                    <td>{s.stint}</td>
                    <td><span className={`stint-compound-tag is-${(s.compound ?? '').toLowerCase().includes('soft') ? 'soft' : (s.compound ?? '').toLowerCase().includes('hard') ? 'hard' : 'medium'}`}>{s.compound}</span></td>
                    <td>{s.laps}</td>
                    <td>{s.startLap}</td>
                    <td>{s.endLap}</td>
                    <td className={`mono ${s.wearPct > 70 ? 'is-critical' : s.wearPct > 50 ? 'is-warn' : ''}`}>{s.wearPct.toFixed(0)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Race Events */}
      <section className="pw-panel replay-section">
        <div className="pw-panel-header">
          <span className="pw-panel-title">RACE EVENTS</span>
          <span className="pw-panel-subtitle">{events.length} events</span>
        </div>
        {events.length === 0 && positionChanges.length === 0 ? (
          <div className="panel-empty-state">이벤트 없음</div>
        ) : (
          <div className="event-timeline">
            {events.map((e) => (
              <div key={e.id} className={`timeline-item ${e.severity === 'critical' ? 'is-critical' : 'is-warn'}`}>
                <span className="timeline-badge">{e.kind.replace(/-/g, ' ').toUpperCase()}</span>
                <span className="timeline-msg">{e.message}</span>
              </div>
            ))}
            {positionChanges.map((p, i) => (
              <div key={i} className="timeline-item is-pit">
                <span className="timeline-badge">PIT</span>
                <span className="timeline-msg" style={{ color: p.colors.body }}>
                  {p.driverCode} P{p.position} — {p.event}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* System Health */}
      <section className="pw-panel replay-section">
        <div className="pw-panel-header">
          <span className="pw-panel-title">SYSTEM STATUS</span>
        </div>
        <div className="analysis-kpi-grid">
          <div className="analysis-kpi">
            <span className="analysis-kpi-label">OVERALL</span>
            <span className={`analysis-kpi-value ${evaluation.overallHealth.tone === 'good' ? 'is-ok' : evaluation.overallHealth.tone === 'warn' ? 'is-warn' : 'is-critical'}`}>
              {evaluation.overallHealth.label} ({evaluation.overallHealth.score})
            </span>
          </div>
          <div className="analysis-kpi">
            <span className="analysis-kpi-label">DATA TRUST</span>
            <span className={`analysis-kpi-value ${evaluation.dataReliability.tone === 'good' ? 'is-ok' : evaluation.dataReliability.tone === 'warn' ? 'is-warn' : 'is-critical'}`}>
              {evaluation.dataReliability.label} ({evaluation.dataReliability.systemReliability})
            </span>
          </div>
          <div className="analysis-kpi">
            <span className="analysis-kpi-label">STRATEGY CONF</span>
            <span className="analysis-kpi-value">{evaluation.strategyConfidence.score}%</span>
          </div>
          <div className="analysis-kpi">
            <span className="analysis-kpi-label">FEED</span>
            <span className={`analysis-kpi-value ${evaluation.feedHealth.tone === 'good' ? 'is-ok' : 'is-warn'}`}>
              {evaluation.feedHealth.label} ({evaluation.feedHealth.score})
            </span>
          </div>
        </div>
        {state?.ingest_stats && (
          <div className="ingest-stats">
            <span>Packets: {state.ingest_stats.packets_received}</span>
            <span>Decoded: {state.ingest_stats.packets_decoded}</span>
            <span>Dropped: {state.ingest_stats.packets_dropped}</span>
            <span>Errors: {state.ingest_stats.decode_errors}</span>
          </div>
        )}
      </section>
    </div>
  )
}
