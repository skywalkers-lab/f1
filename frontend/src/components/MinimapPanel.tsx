import { AppState } from '../lib/types'

type Props = { state: AppState | null }

const W = 460
const H = 300
const PAD = 12

function mapX(x: number): number { return PAD + x * (W - PAD * 2) }
function mapY(y: number): number { return PAD + y * (H - PAD * 2) }

export function MinimapPanel({ state }: Props) {
  const trace = (state?.minimap.track_trace ?? []).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
  const cars = (state?.minimap.cars ?? []).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
  const playerIdx = state?.minimap.player_car_index ?? -1

  const baselineLine = trace.filter((_, i) => i % 3 === 0)

  const sector1 = trace.slice(0, Math.floor(trace.length / 3))
  const sector2 = trace.slice(Math.floor(trace.length / 3), Math.floor((trace.length * 2) / 3))
  const sector3 = trace.slice(Math.floor((trace.length * 2) / 3))

  const mkPath = (pts: Array<{ x: number; y: number }>) => pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${mapX(p.x)} ${mapY(p.y)}`).join(' ')
  const drsA = trace[Math.floor(trace.length * 0.12)]
  const drsB = trace[Math.floor(trace.length * 0.62)]

  return (
    <section className="panel">
      <div className="panel-header">
        <h3>Track Map</h3>
        <div className="small">Source: {state?.minimap.mode ?? 'live_trace'}</div>
      </div>
      <svg width="100%" height="auto" viewBox={`0 0 ${W} ${H}`} style={{ background: '#090d13', display: 'block', border: '1px solid #1b2b35' }}>
        {baselineLine.length > 1 && <path d={mkPath(baselineLine)} fill="none" stroke="#f5f5f5" strokeWidth={1} strokeDasharray="4 4" opacity={0.7} />}
        {sector1.length > 1 && <path d={mkPath(sector1)} fill="none" stroke="#2f7bb2" strokeWidth={2} />}
        {sector2.length > 1 && <path d={mkPath(sector2)} fill="none" stroke="#2f9b70" strokeWidth={2} />}
        {sector3.length > 1 && <path d={mkPath(sector3)} fill="none" stroke="#8267ff" strokeWidth={2} />}

        {drsA && (
          <>
            <circle cx={mapX(drsA.x)} cy={mapY(drsA.y)} r={5} fill="#00e6ff" />
            <text x={mapX(drsA.x) + 8} y={mapY(drsA.y) - 8} fill="#00e6ff" fontSize="10">DRS1</text>
          </>
        )}
        {drsB && (
          <>
            <circle cx={mapX(drsB.x)} cy={mapY(drsB.y)} r={5} fill="#00e6ff" />
            <text x={mapX(drsB.x) + 8} y={mapY(drsB.y) - 8} fill="#00e6ff" fontSize="10">DRS2</text>
          </>
        )}

        {sector1[0] && <text x={mapX(sector1[0].x)} y={mapY(sector1[0].y) - 10} fill="#8ccfff" fontSize="10">S1</text>}
        {sector2[0] && <text x={mapX(sector2[0].x)} y={mapY(sector2[0].y) - 10} fill="#8df1be" fontSize="10">S2</text>}
        {sector3[0] && <text x={mapX(sector3[0].x)} y={mapY(sector3[0].y) - 10} fill="#bfaeff" fontSize="10">S3</text>}

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
      <div className="footer-note">Overlay: baseline racing line + DRS markers + sector labels.</div>
      <div className="footer-note">
        Track bounds X[{state?.minimap.transform.min_x.toFixed(1) ?? '-'}, {state?.minimap.transform.max_x.toFixed(1) ?? '-'}] Z[{state?.minimap.transform.min_z.toFixed(1) ?? '-'}, {state?.minimap.transform.max_z.toFixed(1) ?? '-'}]
      </div>
    </section>
  )
}
