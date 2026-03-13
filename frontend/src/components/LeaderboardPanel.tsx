import { AppState } from '../lib/types'

type Props = { state: AppState | null }

export function LeaderboardPanel({ state }: Props) {
  const cars = state?.minimap.cars ?? []
  const playerPos = state?.player.position ?? 0

  return (
    <section className="panel">
      <div className="panel-header"><h3>Leaderboard</h3><div className="small">EST fields marked *</div></div>
      <table className="table">
        <thead>
          <tr><th>Pos</th><th>Drv</th><th>Gap*</th><th>Tyre</th><th>Pit</th><th>Last*</th></tr>
        </thead>
        <tbody>
          {cars.slice(0, 12).map((c, i) => {
            const pos = i + 1
            const isPlayer = c.car_index === state?.player_car_index
            return (
              <tr key={c.car_index} style={{ color: isPlayer ? '#ffce52' : '#dbe5f2' }}>
                <td>{pos.toString().padStart(2, '0')}</td>
                <td>{`C${c.car_index.toString().padStart(2, '0')}`}</td>
                <td>{isPlayer ? '+0.000' : `+${Math.abs(pos - (playerPos || 1)) * 0.85}s`}</td>
                <td>{isPlayer ? state?.player.tyre_compound : 'C3'}</td>
                <td>{pos % 7 === 0 ? 'P' : '-'}</td>
                <td>{`1:${(29 + pos / 10).toFixed(3)}`}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </section>
  )
}
