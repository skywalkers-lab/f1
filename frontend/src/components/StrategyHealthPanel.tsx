import { AppState } from '../lib/types'

type Props = { state: AppState | null }

export function StrategyHealthPanel({ state }: Props) {
  const strategy = state?.strategy
  const scorePct = ((strategy?.score ?? 0) * 100).toFixed(0)

  return (
    <section className="panel">
      <div className="panel-header"><h3>Strategy & Health <span className="badge-est">EST</span></h3><div className="small">confidence: {strategy?.confidence ?? 'low'}</div></div>
      <div className="kpi-grid" style={{ marginBottom: 8 }}>
        <div className="kpi"><div className="label">Action EST</div><div className="value">{strategy?.action ?? 'STAY_OUT'}</div></div>
        <div className="kpi"><div className="label">Score EST</div><div className="value">{scorePct}%</div></div>
        <div className="kpi"><div className="label">Pit Loss EST</div><div className="value">{String(strategy?.key_inputs?.pit_loss_est_s ?? '-')}s</div></div>
      </div>
      <div className="small" style={{ marginBottom: 8 }}>
        <span className="health-dot" style={{ background: '#5cff95' }} />DRS
        <span className="health-dot" style={{ background: '#5cff95', marginLeft: 10 }} />ERS
        <span className="health-dot" style={{ background: '#ffce52', marginLeft: 10 }} />Aero
        <span className="health-dot" style={{ background: '#5cff95', marginLeft: 10 }} />Powertrain
      </div>
      <div className="kpi" style={{ marginBottom: 8 }}><div className="label">Reason EST</div><div className="value" style={{ fontSize: 12, lineHeight: 1.4 }}>{strategy?.reason ?? 'No recommendation yet'}</div></div>
      <table className="table">
        <thead><tr><th>Candidate</th><th>Score</th><th>Reason</th></tr></thead>
        <tbody>
          {(strategy?.candidates ?? []).slice(0, 4).map((c) => (
            <tr key={c.action}>
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
