import { AppState } from '../lib/types'

type Props = { state: AppState | null }

export function BattleControlsPanel({ state }: Props) {
  const ersPct = Math.max(0, Math.min(100, (state?.player.ers ?? 0) / 4000000 * 100))
  const fuel = state?.player.fuel ?? 0
  return (
    <section className="panel">
      <div className="panel-header"><h3>Battle Controls</h3><div className="small">dense race control view</div></div>
      <div className="label">ERS</div>
      <div className="bar" style={{ marginBottom: 8 }}><span style={{ width: `${ersPct}%` }} /></div>
      <div className="kpi-grid">
        <div className="kpi"><div className="label">Fuel Proj EST</div><div className="value">{fuel.toFixed(1)} kg</div></div>
        <div className="kpi"><div className="label">Brake Bias EST</div><div className="value">56.0%</div></div>
        <div className="kpi"><div className="label">Diff EST</div><div className="value">70%</div></div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 8 }}>
        <div className="kpi"><div className="label">Ahead Gap EST</div><div className="value">+1.245</div></div>
        <div className="kpi"><div className="label">Behind Gap EST</div><div className="value">-0.832</div></div>
      </div>
    </section>
  )
}
