/**
 * Engineer Briefing Panel — displays race engineer language output
 * from the enhanced strategy engine, including execution plan,
 * triggers, and conditional contingency actions.
 */

import { memo } from 'react'
import type { EnhancedStrategyOutput, DistributionMetrics } from '../hooks/useEnhancedStrategy'

type Props = {
  output: EnhancedStrategyOutput
}

function DistributionBar({ label, dist, unit }: { label: string; dist: DistributionMetrics; unit: string }) {
  const range = Math.max(0.01, dist.worstCase - dist.bestCase)
  const meanPct = ((dist.mean - dist.bestCase) / range) * 100
  const p10Pct = ((dist.p10 - dist.bestCase) / range) * 100
  const p90Pct = ((dist.p90 - dist.bestCase) / range) * 100

  return (
    <div className="dist-bar-row">
      <span className="dist-label">{label}</span>
      <div className="dist-bar-track">
        <div className="dist-bar-range" style={{ left: `${p10Pct}%`, width: `${p90Pct - p10Pct}%` }} />
        <div className="dist-bar-mean" style={{ left: `${meanPct}%` }} />
      </div>
      <span className="dist-value">{dist.mean.toFixed(1)}{unit}</span>
    </div>
  )
}

function PhaseIndicator({ phase }: { phase: 'early' | 'mid' | 'late' }) {
  const colors = { early: 'var(--ok)', mid: 'var(--warn)', late: 'var(--critical)' }
  return (
    <span className="phase-indicator" style={{ color: colors[phase], borderColor: colors[phase] }}>
      {phase.toUpperCase()}
    </span>
  )
}

function ObjectivesGrid({ objectives }: { objectives: EnhancedStrategyOutput['recommended']['objectives'] }) {
  const items = [
    { label: 'TIME', value: objectives.timeGain, unit: 'ms', positive: true },
    { label: 'POSITION', value: objectives.positionGain, unit: 'pos', positive: true },
    { label: 'RISK', value: objectives.riskExposure, unit: '', positive: false },
    { label: 'TRAFFIC', value: objectives.trafficExposure, unit: '', positive: false },
    { label: 'TYRE LIFE', value: objectives.tyreLongevity, unit: 'laps', positive: true },
    { label: 'FLEX', value: objectives.strategicFlexibility, unit: '', positive: true },
  ]

  return (
    <div className="objectives-grid">
      {items.map((item) => {
        const isGood = item.positive ? item.value > 0 : item.value < 0.5
        return (
          <div key={item.label} className="obj-cell">
            <span className="obj-label">{item.label}</span>
            <span className={`obj-value ${isGood ? 'is-ok' : 'is-warn'}`}>
              {item.value >= 0 && item.positive ? '+' : ''}{item.value.toFixed(1)}{item.unit}
            </span>
          </div>
        )
      })}
    </div>
  )
}

export const EngineerBriefingPanel = memo(function EngineerBriefingPanel({ output }: Props) {
  const rec = output.recommended
  const confColor = output.confidence >= 70 ? 'var(--ok)' : output.confidence >= 45 ? 'var(--warn)' : 'var(--critical)'

  return (
    <section className="pw-panel engineer-panel">
      <div className="pw-panel-header">
        <span className="pw-panel-title" style={{ color: 'var(--accent)' }}>RACE ENGINEER</span>
        <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>
          {output.totalRuns} runs · {output.computeTimeMs}ms
        </span>
      </div>

      {/* Engineer briefing text */}
      <div className="engineer-briefing">
        {output.engineerBriefing}
      </div>

      {/* Race phase + confidence */}
      <div className="engineer-meta-row">
        <PhaseIndicator phase={rec.raceEvolution.racePhase} />
        <span className="engineer-conf" style={{ color: confColor }}>
          CONFIDENCE {output.confidence}%
        </span>
        {output.inertia.consecutiveLaps > 0 && (
          <span className="engineer-inertia" title="Laps with same recommendation">
            STABLE {output.inertia.consecutiveLaps}L
          </span>
        )}
      </div>

      {/* Distribution metrics */}
      <div className="engineer-distributions">
        <DistributionBar label="POS Δ" dist={rec.distributions.positionChange} unit="pos" />
        <DistributionBar label="P(FINAL)" dist={rec.distributions.finalPosition} unit="" />
      </div>

      {/* Objectives grid */}
      <ObjectivesGrid objectives={rec.objectives} />

      {/* Engineer notes */}
      {rec.engineerNotes.length > 0 && (
        <div className="engineer-notes">
          {rec.engineerNotes.map((note, i) => (
            <div key={i} className="engineer-note">{note}</div>
          ))}
        </div>
      )}

      {/* Traffic & evolution KPIs */}
      <div className="strat-kpi-row">
        <div className="strat-kpi-box">
          <div className="strat-kpi-label">CLEAN AIR</div>
          <div className={`strat-kpi-value ${rec.trafficAnalysis.cleanAirScore >= 60 ? 'is-ok' : rec.trafficAnalysis.cleanAirScore >= 30 ? 'is-warn' : 'is-critical'}`}>
            {Math.round(rec.trafficAnalysis.cleanAirScore)}
          </div>
        </div>
        <div className="strat-kpi-box">
          <div className="strat-kpi-label">SC/LAP</div>
          <div className={`strat-kpi-value ${rec.raceEvolution.scProbabilityPerLap > 0.1 ? 'is-warn' : 'is-ok'}`}>
            {Math.round(rec.raceEvolution.scProbabilityPerLap * 100)}%
          </div>
        </div>
        <div className="strat-kpi-box">
          <div className="strat-kpi-label">DRS TRAIN</div>
          <div className={`strat-kpi-value ${rec.trafficAnalysis.inDrsTrain ? 'is-warn' : 'is-ok'}`}>
            {rec.trafficAnalysis.inDrsTrain ? `${rec.trafficAnalysis.drsTrainLength}` : 'NONE'}
          </div>
        </div>
        <div className="strat-kpi-box">
          <div className="strat-kpi-label">STABILITY</div>
          <div className={`strat-kpi-value ${rec.scenarioVariance.crossScenarioStability > 0.7 ? 'is-ok' : 'is-warn'}`}>
            {Math.round(rec.scenarioVariance.crossScenarioStability * 100)}%
          </div>
        </div>
      </div>

      {/* Execution plan triggers */}
      {rec.executionPlan.triggers.length > 0 && (
        <div className="engineer-triggers">
          <div className="engineer-section-header">TRIGGERS</div>
          {rec.executionPlan.triggers.slice(0, 4).map((t) => (
            <div key={t.id} className={`engineer-trigger ${t.priority === 'critical' ? 'is-critical' : t.priority === 'high' ? 'is-warn' : ''}`}>
              <span className="trigger-note">{t.engineerNote}</span>
            </div>
          ))}
        </div>
      )}

      {/* Contingencies */}
      {rec.executionPlan.contingencies.length > 0 && (
        <div className="engineer-contingencies">
          <div className="engineer-section-header">CONTINGENCIES</div>
          {rec.executionPlan.contingencies.slice(0, 3).map((c, i) => (
            <div key={i} className={`engineer-contingency ${c.priority === 'critical' ? 'is-critical' : ''}`}>
              <span className="cont-event">{c.event}</span>
              <span className="cont-action">{c.action}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
})
