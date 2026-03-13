import { AppState } from '../lib/types'

type Props = { state: AppState | null }

function cornerBar(label: string, value: number) {
  return <div><div className="label">{label}</div><div className="bar"><span style={{ width: `${value}%`, background: value > 70 ? '#ff5d5d' : '#5cff95' }} /></div></div>
}

export function TyreEngineeringPanel({ state }: Props) {
  const compound = state?.player.tyre_compound ?? 'UNKNOWN'
  return (
    <section className="panel">
      <div className="panel-header"><h3>Tyre Engineering</h3><div className="small">Current: {compound}</div></div>
      <div className="kpi-grid" style={{ marginBottom: 8 }}>
        <div className="kpi"><div className="label">Inventory EST</div><div className="value">S/M/H: 1/1/1</div></div>
        <div className="kpi"><div className="label">Stint Laps EST</div><div className="value">{state?.player.lap ?? 0}</div></div>
        <div className="kpi"><div className="label">Tyre Temp EST</div><div className="value">92°C</div></div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        {cornerBar('FL Wear', 38)}
        {cornerBar('FR Wear', 42)}
        {cornerBar('RL Wear', 36)}
        {cornerBar('RR Wear', 40)}
      </div>
    </section>
  )
}
