import { memo, useMemo } from 'react'
import { AppState } from '../lib/types'
import {
  createProjector,
  isValidTransform,
  sanitizeWorldPoint,
  ScreenPoint,
} from '../lib/minimapProjection'
import { useSmoothedMinimapCars } from '../hooks/useSmoothedMinimapCars'
import { TrackLayers } from './minimap/TrackLayers'
import { CarMarker } from './minimap/CarMarker'
import { formatWeatherState } from '../lib/f1Terms'
import { buildGapMetrics, gapForMode } from '../lib/leaderboardGap'

type Props = { state: AppState | null }

const W = 520
const H = 320
const PAD = 18

export const TrackMapPanel = memo(function TrackMapPanel({ state }: Props) {
  const isReferenceMode = state?.minimap.mode === 'reference_track'
  const trackName = state?.minimap.track_name ?? state?.track ?? 'UNKNOWN'

  const traceWorld = useMemo(
    () =>
      (state?.minimap.track_trace ?? [])
        .map((raw) => sanitizeWorldPoint(raw))
        .filter((p): p is { x: number; z: number } => p !== null),
    [state?.minimap.track_trace],
  ) as Array<{ x: number; z: number }>

  const transform = state?.minimap.transform
  const transformValid = !!transform && isValidTransform(transform)
  const projector = useMemo(() => {
    if (!transform || !transformValid) return null
    return createProjector(W, H, PAD, transform)
  }, [transform, transformValid])

  const trace: ScreenPoint[] = useMemo(() => {
    if (!projector) return []
    return traceWorld.map((p: { x: number; z: number }) => projector.toScreen(p))
  }, [traceWorld, projector])

  const rawCars = state?.minimap.cars ?? []
  const smoothCars = useSmoothedMinimapCars(rawCars, projector)

  const driverCodes = useMemo(
    () => Object.fromEntries((state?.leaderboard ?? []).map((e) => [e.car_index, e.driver_code])) as Record<number, string>,
    [state?.leaderboard],
  )

  const weather = formatWeatherState(state?.weather_state)

  // DRS zones and sectors from reference track data
  const drsZones = useMemo(() => state?.minimap.drs_zones ?? [], [state?.minimap.drs_zones])
  const sectors = useMemo(() => state?.minimap.sectors ?? [], [state?.minimap.sectors])
  const pitLane = state?.minimap.pit_lane

  // Compute gap ahead / behind for the player car
  const playerRow = state?.leaderboard?.find(r => r.car_index === state?.player_car_index)
  const gapMetrics = useMemo(() => buildGapMetrics(state?.leaderboard ?? []), [state?.leaderboard])
  const playerPos = playerRow?.position ?? 0
  const aheadRow = state?.leaderboard?.find(r => r.position === playerPos - 1)
  const behindRow = state?.leaderboard?.find(r => r.position === playerPos + 1)
  const aheadMetrics = aheadRow ? gapMetrics.get(aheadRow.car_index) : undefined
  const behindMetrics = behindRow ? gapMetrics.get(behindRow.car_index) : undefined
  const gapAhead = aheadMetrics ? Math.abs(gapForMode('player', aheadMetrics, false)) : 0
  const gapBehind = behindMetrics ? Math.abs(gapForMode('player', behindMetrics, false)) : 0
  const lap = state?.player.lap ?? 0
  const totalLaps = state?.total_laps ?? 0

  // Feed health indicator
  const feedHealth = state?.feed_health
  const healthLabel = feedHealth?.quality_label ?? 'N/A'
  const healthScore = feedHealth?.composite_score ?? 0
  const healthColor = healthScore >= 80 ? 'var(--ok)' : healthScore >= 50 ? 'var(--warn)' : 'var(--critical)'

  return (
    <section className="track-panel pw-panel">
      <div className="track-header-bar">
        <span className="track-label">
          {isReferenceMode ? `REF_TRACK · ${trackName}` : 'TRACK_GPS_ACTIVE'}
        </span>
        <span className="track-conditions">
            LAP {lap}/{totalLaps}{state?.air_temp_c ? ` · AIR: ${state.air_temp_c}°C / TRACK: ${state.track_temp_c ?? '?'}°C` : ''}
        </span>
        {feedHealth && (
          <span className="track-feed-health" style={{ color: healthColor, marginLeft: 8, fontSize: '0.7rem' }}>
            FEED: {healthLabel} ({healthScore.toFixed(0)})
          </span>
        )}
      </div>

      {/* Center race data overlay */}
      <div className="track-data-overlay">
        <div className="track-data-cell">
          <span className="track-data-label">GAP AHEAD</span>
          <span className="track-data-driver">{aheadRow?.driver_code ?? '---'}</span>
          <span className={`track-data-value ${gapAhead < 1.5 ? 'is-critical' : gapAhead < 3 ? 'is-warn' : 'is-ok'}`}>
            {gapAhead > 0 ? `+${gapAhead.toFixed(3)}` : '---'}
          </span>
        </div>
        <div className="track-data-cell track-data-position">
          <span className="track-data-label">POSITION</span>
          <span className="track-data-pos">{playerPos > 0 ? `P${playerPos}` : '--'}</span>
        </div>
        <div className="track-data-cell">
          <span className="track-data-label">GAP BEHIND</span>
          <span className="track-data-driver">{behindRow?.driver_code ?? '---'}</span>
          <span className={`track-data-value ${gapBehind < 1.5 ? 'is-warn' : 'is-ok'}`}>
            {gapBehind > 0 ? `+${gapBehind.toFixed(3)}` : '---'}
          </span>
        </div>
      </div>

      <div className="track-map-area">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
          {trace.length > 1 && (
            <TrackLayers
              trace={trace}
              drsZones={drsZones}
              incidentZone={null}
              sectorStates={['default', 'default', 'default']}
            />
          )}
          {smoothCars.map((car) => (
            <CarMarker
              key={car.car_index}
              car={car}
              isPlayer={car.car_index === state?.minimap.player_car_index}
              inBattle={false}
              relation={null}
              driverCode={driverCodes[car.car_index] ?? null}
            />
          ))}
        </svg>

        {trace.length === 0 && (
          <div className="panel-empty-state" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            트랙 데이터 수신 대기
          </div>
        )}
      </div>

      <div className="sector-legend">
        {sectors.length > 0 ? (
          sectors.map((s, i) => (
            <div key={i} className="sector-legend-item">
              <span className={`sector-dot is-s${i + 1}`} />{s.label ?? `SECTOR ${i + 1}`}
            </div>
          ))
        ) : (
          <>
            <div className="sector-legend-item"><span className="sector-dot is-s1" />SECTOR 1</div>
            <div className="sector-legend-item"><span className="sector-dot is-s2" />SECTOR 2</div>
            <div className="sector-legend-item"><span className="sector-dot is-s3" />SECTOR 3</div>
          </>
        )}
        {pitLane && (
          <div className="sector-legend-item"><span className="sector-dot is-pit" />PIT LANE</div>
        )}
      </div>
    </section>
  )
})
