import { AppState } from '../lib/types'

type Props = { state: AppState | null }

export function PaceAnalysisPanel({ state }: Props) {
  const base = 89.2
  const laps = Array.from({ length: 6 }).map((_, i) => ({
    lap: Math.max((state?.player.lap ?? 7) - (5 - i), 1),
    time: base + Math.sin(i) * 0.5,
    s1: 29.7 + i * 0.03,
    s2: 30.1 + i * 0.02,
    s3: 29.4 + i * 0.02,
  }))
  const best = Math.min(...laps.map((l) => l.time))
  const avg = laps.reduce((a, b) => a + b.time, 0) / laps.length

  return (
    <section className="panel">
      <div className="panel-header"><h3>Pace Analysis</h3><div className="small">Consistency: {(100 - (avg - best) * 100).toFixed(1)}%</div></div>
      <div className="kpi-grid" style={{ marginBottom: 8 }}>
        <div className="kpi"><div className="label">Best Lap</div><div className="value">{best.toFixed(3)}</div></div>
        <div className="kpi"><div className="label">Avg Pace</div><div className="value">{avg.toFixed(3)}</div></div>
        <div className="kpi"><div className="label">Delta EST</div><div className="value">{(state?.player.position ? (state.player.position - 1) * 0.22 : 0).toFixed(3)}</div></div>
      </div>
      <table className="table">
        <thead><tr><th>Lap</th><th>LapTime</th><th>S1</th><th>S2</th><th>S3</th></tr></thead>
        <tbody>{laps.map((l) => <tr key={l.lap}><td>{l.lap}</td><td>{l.time.toFixed(3)}</td><td>{l.s1.toFixed(3)}</td><td>{l.s2.toFixed(3)}</td><td>{l.s3.toFixed(3)}</td></tr>)}</tbody>
      </table>
    </section>
  )
}
