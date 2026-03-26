import { useState, useEffect, useCallback } from 'react'
import {
  getSetupRecommendation, applySetup,
  type SetupRecommendation, type SetupAdjustment,
} from '../lib/api'

type Props = { trackId: string }

const PARAM_LABELS: Record<string, string> = {
  front_wing: 'Front Wing',
  rear_wing: 'Rear Wing',
  diff_on: 'Diff (On Throttle)',
  diff_off: 'Diff (Off Throttle)',
  front_suspension: 'Front Suspension',
  rear_suspension: 'Rear Suspension',
  front_anti_roll: 'Front Anti-Roll',
  rear_anti_roll: 'Rear Anti-Roll',
  front_ride_height: 'Front Ride Height',
  rear_ride_height: 'Rear Ride Height',
  front_camber: 'Front Camber',
  rear_camber: 'Rear Camber',
  front_toe: 'Front Toe',
  rear_toe: 'Rear Toe',
  brake_bias: 'Brake Bias %',
}

export function SetupRecommendationPanel({ trackId }: Props) {
  const [data, setData] = useState<SetupRecommendation | null>(null)
  const [loading, setLoading] = useState(false)
  const [applied, setApplied] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const r = await getSetupRecommendation()
      setData(r)
      setApplied(false)
      setDismissed(new Set())
    } catch {
      setData(null)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    refresh()
    const interval = setInterval(refresh, 15000) // Refresh every 15s
    return () => clearInterval(interval)
  }, [refresh])

  const handleApply = useCallback(async () => {
    if (!data?.recommendation?.recommended_setup) return
    const ok = await applySetup(data.recommendation.recommended_setup)
    if (ok) setApplied(true)
  }, [data])

  const handleDismiss = useCallback((param: string) => {
    setDismissed(prev => new Set(prev).add(param))
  }, [])

  if (!data) {
    return (
      <section className="pw-panel setup-panel">
        <div className="pw-panel-header">
          <span className="pw-panel-title">SETUP RECOMMENDATION</span>
        </div>
        <div className="empty-state">{loading ? 'Loading...' : 'No setup data available.'}</div>
      </section>
    )
  }

  const { balance, recommendation } = data
  const adjustments = recommendation.adjustments.filter(a => !dismissed.has(a.parameter))
  const highPriority = adjustments.filter(a => a.priority === 'high')
  const displayAdjustments = showAll ? adjustments : highPriority.length > 0 ? highPriority : adjustments.slice(0, 5)

  const tendencyColor = balance.dominant_tendency === 'understeer' ? 'is-warn'
    : balance.dominant_tendency === 'oversteer' ? 'is-critical' : 'is-ok'

  return (
    <section className="pw-panel setup-panel">
      <div className="pw-panel-header">
        <span className="pw-panel-title">SETUP RECOMMENDATION</span>
        <span className={`pw-panel-badge ${tendencyColor}`}>
          {balance.dominant_tendency.toUpperCase()}
        </span>
      </div>

      {/* Balance Overview */}
      <div className="balance-overview">
        <div className="balance-meters">
          <div className="balance-meter">
            <span className="meter-label">UNDERSTEER</span>
            <div className="meter-track">
              <div className="meter-fill is-warn" style={{ width: `${balance.understeer_score * 100}%` }} />
            </div>
            <span className="meter-value">{(balance.understeer_score * 100).toFixed(0)}%</span>
          </div>
          <div className="balance-meter">
            <span className="meter-label">OVERSTEER</span>
            <div className="meter-track">
              <div className="meter-fill is-critical" style={{ width: `${balance.oversteer_score * 100}%` }} />
            </div>
            <span className="meter-value">{(balance.oversteer_score * 100).toFixed(0)}%</span>
          </div>
        </div>

        {/* Corner Phase */}
        <div className="corner-phase">
          <span className="phase-label">ENTRY</span>
          <div className={`phase-indicator ${balance.corner_phases.entry_balance < -0.1 ? 'is-warn' : balance.corner_phases.entry_balance > 0.1 ? 'is-critical' : ''}`}>
            {balance.corner_phases.entry_balance < -0.1 ? 'US' : balance.corner_phases.entry_balance > 0.1 ? 'OS' : '—'}
          </div>
          <span className="phase-label">MID</span>
          <div className={`phase-indicator ${balance.corner_phases.mid_balance < -0.1 ? 'is-warn' : balance.corner_phases.mid_balance > 0.1 ? 'is-critical' : ''}`}>
            {balance.corner_phases.mid_balance < -0.1 ? 'US' : balance.corner_phases.mid_balance > 0.1 ? 'OS' : '—'}
          </div>
          <span className="phase-label">EXIT</span>
          <div className={`phase-indicator ${balance.corner_phases.exit_balance < -0.1 ? 'is-warn' : balance.corner_phases.exit_balance > 0.1 ? 'is-critical' : ''}`}>
            {balance.corner_phases.exit_balance < -0.1 ? 'US' : balance.corner_phases.exit_balance > 0.1 ? 'OS' : '—'}
          </div>
        </div>

        <div className="balance-confidence">
          <span>Confidence: {(balance.confidence * 100).toFixed(0)}%</span>
          <span>Severity: {balance.corner_phases.severity}</span>
          <span>Samples: {balance.sample_count}</span>
        </div>
      </div>

      {/* Summary */}
      <div className="setup-summary">
        <p>{recommendation.summary}</p>
      </div>

      {/* Adjustments */}
      {displayAdjustments.length > 0 && (
        <div className="setup-adjustments">
          <div className="sub-header">
            RECOMMENDED ADJUSTMENTS
            <button type="button" className="small-btn" onClick={() => setShowAll(!showAll)}>
              {showAll ? 'HIGH PRIORITY' : 'SHOW ALL'}
            </button>
          </div>
          {displayAdjustments.map(a => (
            <div key={a.parameter} className={`adjustment-row priority-${a.priority}`}>
              <div className="adjustment-info">
                <span className="adjustment-param">{PARAM_LABELS[a.parameter] ?? a.parameter}</span>
                <span className="adjustment-reason">{a.reason}</span>
              </div>
              <div className="adjustment-values">
                <span className="adj-current">{a.current_value}</span>
                <span className="adj-arrow">→</span>
                <span className="adj-recommended">{a.recommended_value}</span>
                <span className={`adj-delta ${a.delta > 0 ? 'is-up' : 'is-down'}`}>
                  {a.delta > 0 ? '+' : ''}{a.delta.toFixed(2)}
                </span>
              </div>
              <button type="button" className="small-btn dismiss-btn" onClick={() => handleDismiss(a.parameter)} aria-label={`${a.parameter} dismiss`}>✗</button>
            </div>
          ))}
        </div>
      )}

      {/* Apply / Refresh */}
      <div className="setup-actions">
        <button type="button" className="action-btn" onClick={handleApply} disabled={applied || adjustments.length === 0}>
          {applied ? 'APPLIED ✓' : 'APPLY RECOMMENDED SETUP'}
        </button>
        <button type="button" className="action-btn secondary" onClick={refresh} disabled={loading}>
          {loading ? 'REFRESHING...' : 'REFRESH ANALYSIS'}
        </button>
      </div>
    </section>
  )
}
