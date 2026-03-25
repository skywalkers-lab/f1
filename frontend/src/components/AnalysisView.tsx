import { memo } from 'react'
import { AppState } from '../lib/types'
import { RaceStateSnapshot } from '../lib/dashboardMetrics'
import { usePaceAnalysis } from '../hooks/usePaceAnalysis'
import { useTyreHistory } from '../hooks/useTyreHistory'
import { useTyreStrategyAnalysis } from '../hooks/useTyreStrategyAnalysis'
import { useTyreEngineeringAnalysis } from '../hooks/useTyreEngineeringAnalysis'
import { useStrategyHealthAnalysis } from '../hooks/useStrategyHealthAnalysis'

type Props = { state: AppState | null; evaluation: RaceStateSnapshot }

const EMPTY_FEEDBACK: never[] = []

export const AnalysisView = memo(function AnalysisView({ state, evaluation }: Props) {
  const pace = usePaceAnalysis(state)
  const tyreHistory = useTyreHistory(state)
  const tyreStrategy = useTyreStrategyAnalysis(state, tyreHistory)
  const tyreEng = useTyreEngineeringAnalysis(state, tyreHistory)
  const stratHealth = useStrategyHealthAnalysis(state, EMPTY_FEEDBACK)

  return (
    <div className="analysis-view">
      {/* Row 1: Pace Analysis + Strategy Health */}
      <div className="analysis-top-row">
        {/* Pace Analysis */}
        <section className="pw-panel analysis-pace-panel">
          <div className="pw-panel-header">
            <span className="pw-panel-title">PACE ANALYSIS</span>
            <span className={`pw-panel-badge ${pace.trend.direction === 'improving' ? 'is-ok' : pace.trend.direction === 'worsening' ? 'is-critical' : ''}`}>
              {pace.trend.label}
            </span>
          </div>

          <div className="analysis-kpi-grid">
            <div className="analysis-kpi">
              <span className="analysis-kpi-label">BEST LAP</span>
              <span className="analysis-kpi-value is-ok">{pace.bestLapText}</span>
            </div>
            <div className="analysis-kpi">
              <span className="analysis-kpi-label">AVERAGE</span>
              <span className="analysis-kpi-value">{pace.avgLapText}</span>
            </div>
            <div className="analysis-kpi">
              <span className="analysis-kpi-label">ROLLING AVG</span>
              <span className="analysis-kpi-value">{pace.rollingAverageText}</span>
            </div>
            <div className="analysis-kpi">
              <span className="analysis-kpi-label">CONSISTENCY</span>
              <span className={`analysis-kpi-value ${pace.consistency.tone === 'ok' ? 'is-ok' : pace.consistency.tone === 'watch' ? 'is-warn' : 'is-critical'}`}>
                {pace.consistency.label}
              </span>
            </div>
          </div>

          {/* Consistency meter */}
          <div className="consistency-meter">
            <div className="consistency-meter-track">
              <div className={`consistency-meter-fill ${pace.consistency.tone === 'ok' ? 'is-ok' : pace.consistency.tone === 'watch' ? 'is-warn' : 'is-critical'}`} style={{ width: `${pace.consistency.meterPct}%` }} />
            </div>
            <span className="consistency-meter-label">{pace.consistency.band}</span>
          </div>

          {/* Lap-by-lap table */}
          <div className="pace-table-wrap">
            <table className="scenario-table">
              <thead>
                <tr><th>LAP</th><th>TIME</th><th>Δ AVG</th><th>TREND</th></tr>
              </thead>
              <tbody>
                {pace.rows.slice(-10).map((r) => (
                  <tr key={r.lap} className={r.isBestRecent ? 'is-best-row' : ''}>
                    <td className="mono">{r.lap}</td>
                    <td className="mono">{r.lapTimeText}</td>
                    <td className={`mono ${r.deltaTone === 'positive' ? 'is-ok' : r.deltaTone === 'negative' ? 'is-critical' : ''}`}>
                      {r.deltaToRollingAvgText}
                    </td>
                    <td className={r.changeSymbol === 'UP' ? 'is-ok' : r.changeSymbol === 'DOWN' ? 'is-critical' : ''}>
                      {r.changeSymbol === 'UP' ? '↗' : r.changeSymbol === 'DOWN' ? '↘' : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pit signal */}
          <div className={`pit-signal-bar ${pace.pitSignal.shouldPitSoon ? 'is-critical' : 'is-ok'}`}>
            <span className="pit-signal-call">{pace.pitSignal.label}</span>
            <span className="pit-signal-reason">{pace.pitSignal.reason}</span>
          </div>
        </section>

        {/* Strategy Health */}
        <section className="pw-panel analysis-health-panel">
          <div className="pw-panel-header">
            <span className="pw-panel-title">STRATEGY HEALTH</span>
            <span className={`pw-panel-badge ${stratHealth.confidenceIndex.tone === 'ok' ? 'is-ok' : stratHealth.confidenceIndex.tone === 'watch' ? 'is-warn' : 'is-critical'}`}>
              {stratHealth.confidenceIndex.label} ({stratHealth.confidenceIndex.score}%)
            </span>
          </div>

          {/* Confidence Breakdown */}
          <div className="confidence-breakdown">
            {stratHealth.confidenceBreakdown.map((f) => (
              <div key={f.key} className="confidence-row">
                <span className="confidence-key">{f.label}</span>
                <div className="confidence-bar-track">
                  <div className={`confidence-bar-fill ${f.tone === 'ok' ? 'is-ok' : f.tone === 'watch' ? 'is-warn' : 'is-critical'}`} style={{ width: `${f.score}%` }} />
                </div>
                <span className={`confidence-score ${f.tone === 'ok' ? 'is-ok' : f.tone === 'watch' ? 'is-warn' : 'is-critical'}`}>{f.score}</span>
              </div>
            ))}
          </div>

          {/* Candidate Insights */}
          {stratHealth.candidateInsights.length > 0 && (
            <>
              <div className="sub-header">CANDIDATE STRATEGIES</div>
              <div className="candidate-list">
                {stratHealth.candidateInsights.map((c) => (
                  <div key={c.action} className={`candidate-card ${c.isBest ? 'is-best' : ''}`}>
                    <div className="candidate-header">
                      <span className="candidate-action">{c.action}</span>
                      <span className={`candidate-risk is-${c.risk}`}>{c.risk.toUpperCase()}</span>
                    </div>
                    <div className="candidate-body">
                      <span>Score: {c.scoreText}</span>
                      <span className="is-ok">Gain: {c.expectedGainText}</span>
                      <span className="is-critical">Downside: {c.downsideText}</span>
                    </div>
                    <div className="candidate-reason">{c.reason}</div>
                    <div className="candidate-intensity">
                      <div className="candidate-intensity-track">
                        <div className="candidate-intensity-fill" style={{ width: `${c.intensityPct}%` }} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Causal Reasons */}
          {stratHealth.causalReasons.length > 0 && (
            <>
              <div className="sub-header">REASONING</div>
              <div className="causal-list">
                {stratHealth.causalReasons.map((r) => (
                  <div key={r.id} className={`causal-item ${r.tone === 'positive' ? 'is-ok' : r.tone === 'warning' ? 'is-warn' : ''}`}>
                    <span className="causal-cause">{r.cause}</span>
                    <span className="causal-arrow">→</span>
                    <span className="causal-impact">{r.impact}</span>
                    <span className="causal-conclusion">{r.conclusion}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Alerts */}
          {(stratHealth.alerts.confidenceDrop || stratHealth.alerts.gapDrop) && (
            <div className={`health-alert ${stratHealth.alerts.tone === 'ok' ? 'is-ok' : stratHealth.alerts.tone === 'watch' ? 'is-warn' : 'is-critical'}`}>
              ⚠ {stratHealth.alerts.message}
            </div>
          )}

          {/* Feedback trend */}
          <div className="sub-header">FEEDBACK LOOP</div>
          <div className="analysis-kpi-grid">
            <div className="analysis-kpi">
              <span className="analysis-kpi-label">SAMPLES</span>
              <span className="analysis-kpi-value">{stratHealth.feedbackTrend.sampleCount}</span>
            </div>
            <div className="analysis-kpi">
              <span className="analysis-kpi-label">SUCCESS</span>
              <span className={`analysis-kpi-value ${stratHealth.feedbackTrend.tone === 'ok' ? 'is-ok' : 'is-warn'}`}>
                {stratHealth.feedbackTrend.successRatePct}%
              </span>
            </div>
            <div className="analysis-kpi">
              <span className="analysis-kpi-label">AVG ERROR</span>
              <span className="analysis-kpi-value">{stratHealth.feedbackTrend.avgErrorText}</span>
            </div>
            <div className="analysis-kpi">
              <span className="analysis-kpi-label">TREND</span>
              <span className={`analysis-kpi-value ${stratHealth.feedbackTrend.tone === 'ok' ? 'is-ok' : 'is-warn'}`}>
                {stratHealth.feedbackTrend.trendLabel}
              </span>
            </div>
          </div>
        </section>
      </div>

      {/* Row 2: Tyre Strategy + Undercut Windows */}
      <div className="analysis-bottom-row">
        <section className="pw-panel analysis-tyre-panel">
          <div className="pw-panel-header">
            <span className="pw-panel-title" style={{ color: 'var(--tyre-soft)' }}>TYRE STRATEGY</span>
            <span className={`pw-panel-badge ${tyreStrategy.actionSignal.tone === 'ok' ? 'is-ok' : tyreStrategy.actionSignal.tone === 'watch' ? 'is-warn' : 'is-critical'}`}>
              {tyreStrategy.actionSignal.call}
            </span>
          </div>

          <div className="action-signal-card">
            <div className="action-signal-headline">{tyreStrategy.actionSignal.headline}</div>
            <div className="action-signal-rationale">{tyreStrategy.actionSignal.rationale}</div>
          </div>

          {/* Player cliff prediction */}
          {tyreStrategy.playerPrediction && (
            <div className="cliff-prediction-box">
              <span className="clp-label">CLIFF ESTIMATE</span>
              <span className="clp-value">LAP {tyreStrategy.playerPrediction.meanCliffLap.toFixed(0)}</span>
              <span className="clp-range">({tyreStrategy.playerPrediction.lowLap.toFixed(0)}–{tyreStrategy.playerPrediction.highLap.toFixed(0)})</span>
              <span className="clp-conf">{tyreStrategy.playerPrediction.confidencePct.toFixed(0)}%</span>
            </div>
          )}

          {/* Scenarios */}
          {tyreStrategy.scenarios.player.length > 0 && (
            <>
              <div className="sub-header">PIT SCENARIOS</div>
              <table className="scenario-table">
                <thead><tr><th>SCENARIO</th><th>PIT LAP</th><th>LOSS</th><th>Δ TRACK</th></tr></thead>
                <tbody>
                  {tyreStrategy.scenarios.player.map((s) => (
                    <tr key={s.id}>
                      <td><span className={`scenario-tag ${s.tone === 'ok' ? 'is-ok' : s.tone === 'watch' ? 'is-warn' : 'is-critical'}`}>{s.label}</span></td>
                      <td className="mono">{s.pitLap}</td>
                      <td className="mono">{s.expectedLossS.toFixed(1)}s</td>
                      <td className={`mono ${s.projectedTrackDelta < 0 ? 'is-ok' : 'is-critical'}`}>
                        {s.projectedTrackDelta > 0 ? '+' : ''}{s.projectedTrackDelta.toFixed(1)}s
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {/* Decision log */}
          {tyreStrategy.decisionLog.length > 0 && (
            <>
              <div className="sub-header">DECISION LOG</div>
              <div className="decision-log">
                {tyreStrategy.decisionLog.map((d, i) => (
                  <div key={i} className="decision-row">
                    <span className="decision-label">{d.label}</span>
                    <span className={`decision-value ${d.tone === 'ok' ? 'is-ok' : d.tone === 'watch' ? 'is-warn' : 'is-critical'}`}>{d.value}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>

        {/* Undercut Windows */}
        <section className="pw-panel analysis-undercut-panel">
          <div className="pw-panel-header">
            <span className="pw-panel-title">UNDERCUT WINDOWS</span>
            <span className="pw-panel-subtitle">{tyreStrategy.undercutWindows.length} windows</span>
          </div>
          {tyreStrategy.undercutWindows.length === 0 ? (
            <div className="panel-empty-state">언더컷 기회 없음</div>
          ) : (
            <div className="undercut-list">
              {tyreStrategy.undercutWindows.map((w, i) => (
                <div key={i} className="undercut-card">
                  <div className="undercut-header">
                    <span className="undercut-rival">Car #{w.rivalCarIndex}</span>
                    <span className="undercut-laps">L{w.startLap}–L{w.endLap}</span>
                    <span className={`undercut-prob ${w.successProbabilityPct >= 65 ? 'is-ok' : w.successProbabilityPct >= 40 ? 'is-warn' : 'is-critical'}`}>
                      {w.successProbabilityPct.toFixed(0)}%
                    </span>
                  </div>
                  <div className="undercut-body">
                    <span className="is-ok">Gain: {w.expectedGainS.toFixed(2)}s</span>
                    <span className="is-critical">Fail: {w.failureLossS.toFixed(2)}s</span>
                    <span>Score: {w.opportunityScore.toFixed(0)}</span>
                  </div>
                  <div className="undercut-reason">{w.reason}</div>
                  {w.triggerConditions.length > 0 && (
                    <div className="undercut-triggers">
                      {w.triggerConditions.map((t, j) => (
                        <span key={j} className="trigger-tag">{t}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Selection Reasons */}
          {tyreStrategy.selection.reasons.length > 0 && (
            <>
              <div className="sub-header">RIVAL SELECTION</div>
              <div className="selection-list">
                {tyreStrategy.selection.reasons.map((r, i) => (
                  <div key={i} className="selection-row">
                    <span className="selection-role">{r.role}</span>
                    <span className="selection-car">Car #{r.carIndex}</span>
                    <span className="selection-reason">{r.reason}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  )
})
