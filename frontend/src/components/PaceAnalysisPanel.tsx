import { AppState } from '../lib/types'

type Props = { state: AppState | null }

function msToLap(ms: number): string {
  if (!ms) return '-'
  return `${Math.floor(ms / 60000)}:${((ms % 60000) / 1000).toFixed(3).padStart(6, '0')}`
}

export function PaceAnalysisPanel({ state }: Props) {
  const pace = state?.pace
  const recent = pace?.recent ?? []

  return (
    <section className="panel">
      <div className="panel-header"><h3>Pace Analysis <span className="badge-raw">RAW</span><span className="badge-est">EST</span></h3><div className="small">Consistency EST: {pace?.consistency_pct.toFixed(1) ?? '0.0'}%</div></div>
      <div className="kpi-grid" style={{ marginBottom: 8 }}>
        <div className="kpi"><div className="label">Best Lap RAW</div><div className="value">{msToLap(pace?.best_lap_ms ?? 0)}</div></div>
        <div className="kpi"><div className="label">Avg Pace EST</div><div className="value">{msToLap(pace?.avg_lap_ms ?? 0)}</div></div>
        <div className="kpi"><div className="label">Current Lap RAW</div><div className="value">{msToLap(state?.player.current_lap_ms ?? 0)}</div></div>
      </div>
      <table className="table">
        <thead><tr><th>Lap(RAW)</th><th>LapTime(RAW)</th><th>Delta(EST)</th></tr></thead>
        <tbody>
          {recent.map((l) => {
            const delta = (l.lap_time_ms - (pace?.best_lap_ms ?? l.lap_time_ms)) / 1000
            return <tr key={l.lap}><td>{l.lap}</td><td>{msToLap(l.lap_time_ms)}</td><td>{delta >= 0 ? '+' : ''}{delta.toFixed(3)}s</td></tr>
          })}
        </tbody>
      </table>
    </section>
  )
}
