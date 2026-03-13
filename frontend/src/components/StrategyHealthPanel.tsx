import { AppState } from '../lib/types'

type Props = { state: AppState | null }

export function StrategyHealthPanel({ state }: Props) {
  const strategyText = state?.race_control_state?.includes('SC')
    ? 'RECOMMENDATION: PIT NOW — Reduced pit loss under SC state. Reason: discounted stop loss + tyre life gain.'
    : 'RECOMMENDATION: STAY OUT — Track position stable. Reason: current traffic penalty for pit is high.'

  return (
    <section className="panel">
      <div className="panel-header"><h3>Strategy & Health</h3><div className="small">estimation engine output</div></div>
      <div className="kpi-grid" style={{ marginBottom: 8 }}>
        <div className="kpi"><div className="label">Pit Sim EST</div><div className="value">+22.4s</div></div>
        <div className="kpi"><div className="label">Rejoin EST</div><div className="value">P11</div></div>
        <div className="kpi"><div className="label">Damage</div><div className="value">Minor</div></div>
      </div>
      <div className="small" style={{ marginBottom: 8 }}>
        <span className="health-dot" style={{ background: '#5cff95' }} />DRS
        <span className="health-dot" style={{ background: '#5cff95', marginLeft: 10 }} />ERS
        <span className="health-dot" style={{ background: '#ffce52', marginLeft: 10 }} />Aero
        <span className="health-dot" style={{ background: '#5cff95', marginLeft: 10 }} />Powertrain
      </div>
      <div className="kpi"><div className="label">Strategy Call</div><div className="value" style={{ fontSize: 12, lineHeight: 1.4 }}>{strategyText}</div></div>
    </section>
  )
}
