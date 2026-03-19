import { AppState } from '../lib/types'

type Props = { state: AppState | null }

export function StrategyHealthPanel({ state }: Props) {
  const strategy = state?.strategy
  const scorePct = ((strategy?.score ?? 0) * 100).toFixed(0)
  const candidates = (strategy?.candidates ?? []).slice(0, 4)
  const best = candidates[0]
  const runnerUp = candidates[1]
  const confidenceClass =
    strategy?.confidence === 'high'
      ? 'is-high'
      : strategy?.confidence === 'medium'
        ? 'is-medium'
        : 'is-low'

  const keyInputOrder = [
    'laps_remaining',
    'tyre_age',
    'fuel_remaining_kg',
    'traffic_density',
    'pit_loss_est_s',
    'sc_vsc_status',
    'weather_state',
  ]

  const keyInputEntries = keyInputOrder
    .filter((k) => strategy?.key_inputs?.[k] !== undefined)
    .map((k) => [k, strategy?.key_inputs?.[k]])

  const reasonParts = (strategy?.reason ?? 'No recommendation yet')
    .split('. ')
    .map((s) => s.trim())
    .filter(Boolean)

  return (
    <section className="panel">
      <div className="panel-header">
        <h3>
          Strategy & Health <span className="badge-est">EST</span>
        </h3>
        <div className={`confidence-pill ${confidenceClass}`}>confidence: {strategy?.confidence ?? 'low'}</div>
      </div>
      <div className="kpi-grid" style={{ marginBottom: 8 }}>
        <div className="kpi">
          <div className="label">Action EST</div>
          <div className="value">{strategy?.action ?? 'STAY_OUT'}</div>
        </div>
        <div className="kpi">
          <div className="label">Score EST</div>
          <div className="value">{scorePct}%</div>
        </div>
        <div className="kpi">
          <div className="label">Pit Loss EST</div>
          <div className="value">{String(strategy?.key_inputs?.pit_loss_est_s ?? '-')}s</div>
        </div>
      </div>

      <div className="kpi" style={{ marginBottom: 8 }}>
        <div className="label">Decision Gap</div>
        <div className="value" style={{ fontSize: 13 }}>
          {best && runnerUp ? `${best.action} vs ${runnerUp.action}: ${(best.score - runnerUp.score).toFixed(3)}` : '-'}
        </div>
      </div>

      <div className="strategy-inputs" style={{ marginBottom: 8 }}>
        {keyInputEntries.map(([key, value]) => (
          <span className="chip" key={String(key)}>
            {String(key)}: {String(value)}
          </span>
        ))}
      </div>

      <div className="small" style={{ marginBottom: 8 }}>
        <span className="health-dot" style={{ background: '#5cff95' }} />DRS
        <span className="health-dot" style={{ background: '#5cff95', marginLeft: 10 }} />ERS
        <span className="health-dot" style={{ background: '#ffce52', marginLeft: 10 }} />Aero
        <span className="health-dot" style={{ background: '#5cff95', marginLeft: 10 }} />Powertrain
      </div>

      <div className="kpi" style={{ marginBottom: 8 }}>
        <div className="label">Reason EST</div>
        <div className="reason-list">
          {reasonParts.map((line, idx) => (
            <div className="reason-line" key={`${line}-${idx}`}>
              {line}
            </div>
          ))}
        </div>
      </div>

      <table className="table">
        <thead>
          <tr>
            <th>Rank</th>
            <th>Candidate</th>
            <th>Score</th>
            <th>Reason</th>
          </tr>
        </thead>
        <tbody>
          {candidates.map((c, idx) => (
            <tr key={c.action} className={idx === 0 ? 'candidate-best' : ''}>
              <td>#{idx + 1}</td>
              <td>{c.action}</td>
              <td>{c.score.toFixed(3)}</td>
              <td>{c.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
