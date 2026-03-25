import { memo } from 'react'
import { AppState, AdvancedStrategyContext } from '../lib/types'
import { RaceStateSnapshot } from '../lib/dashboardMetrics'
import { formatStrategyAction } from '../lib/f1Terms'
import type { UnifiedStrategyDecision, ScenarioOutcome, DecisionFactor, ExecutionStep } from '../lib/unifiedMonteCarloCore'

type Props = { state: AppState | null; evaluation: RaceStateSnapshot; mcDecision?: UnifiedStrategyDecision | null }

function AdvancedContextPanel({ ctx }: { ctx: AdvancedStrategyContext }) {
  const rec = ctx.action_recommendation
  const urgencyColor = rec.urgency === 'immediate' ? 'var(--critical)' : rec.urgency === 'next_lap' ? 'var(--warn)' : 'var(--ok)'
  const confColor = rec.confidence === 'high' ? 'var(--ok)' : rec.confidence === 'medium' ? 'var(--warn)' : 'var(--text-muted)'

  return (
    <section className="pw-panel">
      <div className="pw-panel-header">
        <span className="pw-panel-title" style={{ color: urgencyColor }}>ACTION: {rec.call}</span>
        <span style={{ fontSize: '0.65rem', color: confColor }}>{rec.confidence.toUpperCase()} · {rec.urgency.toUpperCase()}</span>
      </div>
      <div style={{ padding: '4px 8px', fontSize: '0.72rem', color: 'var(--text)' }}>
        {rec.rationale}
      </div>
      <div style={{ display: 'flex', gap: 4, padding: '2px 8px 6px', flexWrap: 'wrap' }}>
        {rec.key_factors.map((f, i) => (
          <span key={i} style={{ background: 'var(--bg-card)', padding: '1px 6px', borderRadius: 3, fontSize: '0.6rem', color: 'var(--text-muted)' }}>{f}</span>
        ))}
      </div>

      {/* Undercut / SC analysis */}
      <div className="strat-kpi-row" style={{ borderTop: '1px solid var(--bg-card)' }}>
        <div className="strat-kpi-box">
          <div className="strat-kpi-label">SC PROB</div>
          <div className={`strat-kpi-value ${ctx.safety_car.sc_probability > 0.3 ? 'is-warn' : 'is-ok'}`}>
            {(ctx.safety_car.sc_probability * 100).toFixed(0)}%
          </div>
        </div>
        <div className="strat-kpi-box">
          <div className="strat-kpi-label">UNDERCUT</div>
          <div className={`strat-kpi-value ${ctx.undercut_window.undercut_viable ? 'is-ok' : 'is-warn'}`}>
            {ctx.undercut_window.undercut_viable ? `+${ctx.undercut_window.undercut_gain_s}s` : 'N/A'}
          </div>
        </div>
        <div className="strat-kpi-box">
          <div className="strat-kpi-label">CLIFF IN</div>
          <div className={`strat-kpi-value ${ctx.tyre_analysis.laps_to_cliff <= 5 ? 'is-critical' : ctx.tyre_analysis.laps_to_cliff <= 10 ? 'is-warn' : 'is-ok'}`}>
            {ctx.tyre_analysis.laps_to_cliff} LAP
          </div>
        </div>
        <div className="strat-kpi-box">
          <div className="strat-kpi-label">AIR</div>
          <div className={`strat-kpi-value ${ctx.traffic.clean_air ? 'is-ok' : 'is-warn'}`}>
            {ctx.traffic.clean_air ? 'CLEAN' : 'DIRTY'}
          </div>
        </div>
      </div>
    </section>
  )
}

// ── Monte Carlo Decision Sub-Components ──

function scenarioToneClass(o: ScenarioOutcome): string {
  if (o.expectedGain.mean > 0.5) return 'is-ok'
  if (o.expectedGain.mean < -0.3) return 'is-critical'
  return 'is-warn'
}

function ScenarioCompactRow({ outcome, isBest }: { outcome: ScenarioOutcome; isBest: boolean }) {
  const gainMean = outcome.expectedGain.mean
  const gainSign = gainMean >= 0 ? '+' : ''
  const tone = scenarioToneClass(outcome)
  return (
    <div className={`mc-scenario-row ${isBest ? 'is-best' : ''}`}>
      <span className="mc-scenario-label">{outcome.label}</span>
      <span className={`mc-scenario-gain ${tone}`}>{gainSign}{gainMean.toFixed(1)}pos</span>
      <span className="mc-scenario-range">P{outcome.position.p10}–P{outcome.position.p90}</span>
      <span className="mc-scenario-stability" title="결과 안정성">{Math.round(outcome.outcomeStability * 100)}%</span>
      <span className="mc-scenario-positive" title="긍정 확률">{Math.round(outcome.positiveOutcomeProbability * 100)}%↑</span>
    </div>
  )
}

function FactorBadge({ factor }: { factor: DecisionFactor }) {
  const tone = factor.impact > 0.1 ? 'is-ok' : factor.impact < -0.1 ? 'is-critical' : 'is-warn'
  return (
    <div className={`mc-factor-badge ${tone}`} title={factor.description}>
      {factor.factor.replace(/_/g, ' ')}
    </div>
  )
}

function ExecutionRow({ step }: { step: ExecutionStep }) {
  const prioClass = step.priority === 'critical' ? 'is-critical'
    : step.priority === 'high' ? 'is-warn' : 'is-muted'
  return (
    <div className={`mc-exec-row ${prioClass}`}>
      <span className="mc-exec-timing">{step.timing}</span>
      <span className="mc-exec-action">{step.action}</span>
      <span className="mc-exec-detail">{step.details}</span>
    </div>
  )
}

function MCDecisionPanel({ decision }: { decision: UnifiedStrategyDecision }) {
  const rec = decision.recommended
  const confColor = decision.confidenceScore >= 70 ? 'var(--ok)' : decision.confidenceScore >= 45 ? 'var(--warn)' : 'var(--critical)'
  const recTone = scenarioToneClass(rec)

  return (
    <section className="pw-panel mc-decision-panel">
      <div className="pw-panel-header">
        <span className="pw-panel-title" style={{ color: 'var(--accent)' }}>MONTE CARLO STRATEGY</span>
        <span className="mc-meta" title="총 시뮬레이션 런 / 계산 시간">
          {decision.totalRuns} runs · {decision.computeTimeMs}ms
          {decision.cacheHit ? ' · cached' : ''}
        </span>
      </div>

      {/* Recommended action hero */}
      <div className={`mc-hero ${recTone}`}>
        <div className="mc-hero-label">MC RECOMMENDED</div>
        <div className="mc-hero-action">{rec.label}</div>
        <div className="mc-hero-gain">
          <span>기대 이득: {rec.expectedGain.mean >= 0 ? '+' : ''}{rec.expectedGain.mean.toFixed(1)}pos</span>
          <span className="mc-hero-range">(P{rec.position.p10}–P{rec.position.p90})</span>
        </div>
        <div className="mc-hero-conf" style={{ color: confColor }}>
          신뢰도 {decision.confidenceScore}%
        </div>
      </div>

      {/* Risk decomposition KPIs */}
      <div className="strat-kpi-row">
        <div className="strat-kpi-box">
          <div className="strat-kpi-label">SC 의존도</div>
          <div className={`strat-kpi-value ${rec.scDependency > 0.3 ? 'is-warn' : 'is-ok'}`}>
            {Math.round(rec.scDependency * 100)}%
          </div>
        </div>
        <div className="strat-kpi-box">
          <div className="strat-kpi-label">트래픽 리스크</div>
          <div className={`strat-kpi-value ${rec.trafficRisk > 0.3 ? 'is-critical' : rec.trafficRisk > 0.15 ? 'is-warn' : 'is-ok'}`}>
            {Math.round(rec.trafficRisk * 100)}%
          </div>
        </div>
        <div className="strat-kpi-box">
          <div className="strat-kpi-label">타이어 클리프</div>
          <div className={`strat-kpi-value ${rec.tyreCriticalRisk > 0.3 ? 'is-critical' : 'is-ok'}`}>
            {Math.round(rec.tyreCriticalRisk * 100)}%
          </div>
        </div>
        <div className="strat-kpi-box">
          <div className="strat-kpi-label">SC 확률</div>
          <div className={`strat-kpi-value ${rec.scProbabilityUsed > 0.2 ? 'is-warn' : 'is-ok'}`}>
            {Math.round(rec.scProbabilityUsed * 100)}%
          </div>
        </div>
      </div>

      {/* Conditional analysis */}
      <div className="mc-conditional">
        <div className="mc-cond-item">
          <span className="mc-cond-label">SC 발생 시</span>
          <span className={`mc-cond-val ${rec.conditionalWithSC.mean > 0 ? 'is-ok' : 'is-warn'}`}>
            {rec.conditionalWithSC.mean >= 0 ? '+' : ''}{rec.conditionalWithSC.mean.toFixed(1)}pos
          </span>
        </div>
        <div className="mc-cond-item">
          <span className="mc-cond-label">SC 미발생 시</span>
          <span className={`mc-cond-val ${rec.conditionalNoSC.mean > 0 ? 'is-ok' : 'is-warn'}`}>
            {rec.conditionalNoSC.mean >= 0 ? '+' : ''}{rec.conditionalNoSC.mean.toFixed(1)}pos
          </span>
        </div>
      </div>

      {/* All scenarios comparison */}
      <div className="mc-scenarios-header">SCENARIO COMPARISON</div>
      <div className="mc-scenarios-list">
        {decision.allScenarios.map((o) => (
          <ScenarioCompactRow key={o.scenarioId} outcome={o} isBest={o.scenarioId === rec.scenarioId} />
        ))}
      </div>

      {/* Decision factors */}
      {decision.decisionFactors.length > 0 && (
        <div className="mc-factors">
          <div className="mc-factors-header">DECISION FACTORS</div>
          <div className="mc-factors-list">
            {decision.decisionFactors.slice(0, 4).map((f, i) => (
              <FactorBadge key={i} factor={f} />
            ))}
          </div>
          <div className="mc-rationale">{decision.decisionRationale}</div>
        </div>
      )}

      {/* Execution checklist */}
      <div className="mc-exec-header">EXECUTION CHECKLIST</div>
      <div className="mc-exec-list">
        {decision.executionChecklist.map((step) => (
          <ExecutionRow key={step.step} step={step} />
        ))}
      </div>
    </section>
  )
}

export const StrategyPanel = memo(function StrategyPanel({ state, evaluation, mcDecision }: Props) {
  const strategy = state?.strategy
  const action = evaluation.recommendedActionState
  const actionTone = action.tone === 'good' ? 'is-ok' : action.tone === 'warn' ? 'is-warn' : ''

  // Strategy prediction bars (simulated from available data)
  const tyreLifePct = Math.max(5, 100 - (Number(state?.leaderboard?.find((r) => r.car_index === state?.player_car_index)?.tyre_wear_pct) || 30))
  const pitKnockPct = Math.min(90, Math.max(10, Number(strategy?.key_inputs?.pit_loss_est_s ?? 21) * 3))
  const gapRiskPct = Math.min(80, Math.max(10, evaluation.paceStability.trafficImpact))

  // Undercut / traffic gap
  const undercutGain = strategy?.key_inputs?.undercut_gain_s ?? 0.85
  const trafficGap = strategy?.key_inputs?.traffic_density ?? 2.4

  // Recommended text
  const actionText = strategy
    ? `${formatStrategyAction(strategy.action)}. ${strategy.reason}`
    : action.rationale

  return (
    <>
      {/* Monte Carlo Unified Strategy Decision */}
      {mcDecision && <MCDecisionPanel decision={mcDecision} />}

      {/* Advanced Strategy Context — if available */}
      {strategy?.advanced_context && (
        <AdvancedContextPanel ctx={strategy.advanced_context} />
      )}

      {/* Strategy Predictor */}
      <section className="pw-panel">
        <div className="pw-panel-header">
          <span className="pw-panel-title" style={{ color: 'var(--critical)' }}>STRATEGY PREDICTOR</span>
        </div>

        <div className="strat-chart-title">TYRE_LIFE_PRED</div>
        <div className="strategy-predictor-chart">
          <div className="strat-bar-group">
            <div className="strat-bar is-tyre" style={{ height: `${tyreLifePct}%` }} />
            <span className="strat-bar-lbl">L12</span>
          </div>
          <div className="strat-bar-group">
            <div className="strat-bar is-pit" style={{ height: `${pitKnockPct}%` }} />
            <span className="strat-bar-lbl">PIT KNOCK</span>
          </div>
          <div className="strat-bar-group">
            <div className="strat-bar is-gap" style={{ height: `${gapRiskPct}%` }} />
            <span className="strat-bar-lbl">GAP</span>
          </div>
        </div>

        <div className="strat-kpi-row">
          <div className="strat-kpi-box">
            <div className="strat-kpi-label">UNDERCUT GAIN</div>
            <div className={`strat-kpi-value ${Number(undercutGain) > 0 ? 'is-ok' : 'is-warn'}`}>
              {Number(undercutGain) > 0 ? '+' : ''}{Number(undercutGain).toFixed(2)}s
            </div>
          </div>
          <div className="strat-kpi-box">
            <div className="strat-kpi-label">TRAFFIC GAP</div>
            <div className={`strat-kpi-value ${Number(trafficGap) > 3 ? 'is-ok' : 'is-critical'}`}>
              {Number(trafficGap).toFixed(1)}s
            </div>
          </div>
        </div>
      </section>

      {/* Recommended Action — MOST DOMINANT element */}
      <div className={`recommended-action ${actionTone}`}>
        <div className="ra-label">RECOMMENDED ACTION</div>
        <div className="ra-action-word">
          {strategy ? formatStrategyAction(strategy.action) : action.call}
        </div>
        <div className="ra-rationale">
          {strategy?.reason ?? action.rationale}
        </div>
      </div>

    </>
  )
})
