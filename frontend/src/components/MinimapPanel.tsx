import { AppState } from '../lib/types'

type Props = { state: AppState | null }

const W = 460
const H = 300
const PAD = 12

function mapX(x: number): number { return PAD + x * (W - PAD * 2) }
function mapY(y: number): number { return PAD + y * (H - PAD * 2) }

export function MinimapPanel({ state }: Props) {
  const trace = state?.minimap.track_trace ?? []
  const cars = state?.minimap.cars ?? []
  const playerIdx = state?.minimap.player_car_index ?? -1

  const sector1 = trace.slice(0, Math.floor(trace.length / 3))
  const sector2 = trace.slice(Math.floor(trace.length / 3), Math.floor((trace.length * 2) / 3))
  const sector3 = trace.slice(Math.floor((trace.length * 2) / 3))

  const mkPath = (pts: Array<{ x: number; y: number }>) => pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${mapX(p.x)} ${mapY(p.y)}`).join(' ')

  return (
    <section className="panel">
      <div className="panel-header">
        <h3>Track Map</h3>
        <div className="small">Source: {state?.minimap.mode ?? 'live_trace'}</div>
      </div>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ background: '#090d13', display: 'block' }}>
        {sector1.length > 1 && <path d={mkPath(sector1)} fill="none" stroke="#2f7bb2" strokeWidth={2} />}
        {sector2.length > 1 && <path d={mkPath(sector2)} fill="none" stroke="#2f9b70" strokeWidth={2} />}
        {sector3.length > 1 && <path d={mkPath(sector3)} fill="none" stroke="#8267ff" strokeWidth={2} />}
        {cars.map((car) => (
          <rect
            key={car.car_index}
            x={mapX(car.x) - (car.car_index === playerIdx ? 4 : 3)}
            y={mapY(car.y) - (car.car_index === playerIdx ? 4 : 3)}
            width={car.car_index === playerIdx ? 8 : 6}
            height={car.car_index === playerIdx ? 8 : 6}
            fill={car.car_index === playerIdx ? '#ff5d5d' : '#48c0ff'}
          />
        ))}
      </svg>
      <div className="footer-note">
        {trace.length === 0 ? 'Trace building from live motion samples; rendering car dots immediately.' : `Trace points ${trace.length} | Cars ${cars.length}/22 | Player #${playerIdx}`}
      </div>
      <div className="footer-note">
        Track bounds X[{state?.minimap.transform.min_x.toFixed(1) ?? '-'}, {state?.minimap.transform.max_x.toFixed(1) ?? '-'}] Z[{state?.minimap.transform.min_z.toFixed(1) ?? '-'}, {state?.minimap.transform.max_z.toFixed(1) ?? '-'}]
      </div>
    </section>
  )
}
