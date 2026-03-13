import { AppState } from '../lib/types'

type Props = { state: AppState | null }

const W = 520
const H = 320
const PAD = 14

function mapX(x: number): number {
  return PAD + x * (W - PAD * 2)
}

function mapY(y: number): number {
  return PAD + y * (H - PAD * 2)
}

export function MinimapPanel({ state }: Props) {
  const trace = state?.minimap.track_trace ?? []
  const cars = state?.minimap.cars ?? []
  const playerIdx = state?.minimap.player_car_index ?? -1

  const path = trace
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${mapX(p.x).toFixed(1)} ${mapY(p.y).toFixed(1)}`)
    .join(' ')

  return (
    <section style={{ marginTop: 16, background: '#121821', border: '1px solid #263345', borderRadius: 8, padding: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <h3 style={{ margin: 0 }}>Circuit Minimap</h3>
        <div style={{ color: '#9fb2ca' }}>Source: {state?.minimap.mode ?? 'live_trace'}</div>
      </div>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ background: '#0a0f16', borderRadius: 6 }}>
        {path ? <path d={path} fill="none" stroke="#5f728c" strokeWidth={2} /> : null}
        {cars.map((car) => (
          <circle
            key={car.car_index}
            cx={mapX(car.x)}
            cy={mapY(car.y)}
            r={car.car_index === playerIdx ? 6 : 4}
            fill={car.car_index === playerIdx ? '#ff4d4d' : '#48c0ff'}
            stroke={car.car_index === playerIdx ? '#ffe5e5' : '#d9f2ff'}
            strokeWidth={1}
          />
        ))}
      </svg>
      <div style={{ marginTop: 8, color: '#9fb2ca', fontSize: 12 }}>
        {trace.length === 0
          ? 'Track outline is building from live motion samples. Car dots render immediately when motion packets arrive.'
          : `Track trace points: ${trace.length}`}
      </div>
    </section>
  )
}
