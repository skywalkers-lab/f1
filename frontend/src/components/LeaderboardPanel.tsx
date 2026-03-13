import { AppState } from '../lib/types'

type Props = { state: AppState | null }

function formatLap(ms: number): string {
  if (!ms) return '-'
  return `${Math.floor(ms / 60000)}:${((ms % 60000) / 1000).toFixed(3).padStart(6, '0')}`
}

export function LeaderboardPanel({ state }: Props) {
  const rows = state?.leaderboard ?? []

  return (
    <section className="panel">
      <div className="panel-header"><h3>Leaderboard</h3><div className="small">RAW position/lap + EST gaps</div></div>
      <table className="table">
        <thead>
          <tr><th>Pos</th><th>Drv</th><th>Gap EST</th><th>Tyre</th><th>Pit</th><th>Last</th></tr>
        </thead>
        <tbody>
          {rows.slice(0, 12).map((r) => {
            const isPlayer = r.car_index === state?.player_car_index
            return (
              <tr key={r.car_index} style={{ color: isPlayer ? '#ffce52' : '#dbe5f2' }}>
                <td>{r.position.toString().padStart(2, '0')}</td>
                <td>{r.driver_code}</td>
                <td>{r.gap_to_player_s >= 0 ? '+' : ''}{r.gap_to_player_s.toFixed(3)}s</td>
                <td>{r.tyre_compound}</td>
                <td>{r.is_pitting ? 'P' : '-'}</td>
                <td>{formatLap(r.last_lap_ms)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </section>
  )
}
