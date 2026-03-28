import { memo, useMemo, useState } from 'react'
import { AppState } from '../lib/types'
import {
  buildStrategicLayers,
  createProjector,
  isValidTransform,
  resolveDrsZones,
  sanitizeWorldPoint,
  ScreenPoint,
} from '../lib/minimapProjection'
import { useSmoothedMinimapCars } from '../hooks/useSmoothedMinimapCars'
import { TrackLayers } from './minimap/TrackLayers'
import { CarMarker } from './minimap/CarMarker'
import { MinimapInset } from './minimap/MinimapInset'
import { RadarMode } from './minimap/RadarMode'
import { getTrackDefinition } from '../lib/trackData'
import { buildProjectedLookup } from '../lib/trackProjection'

type Props = { state: AppState | null }

type SectorState = 'default' | 'yellow' | 'purple' | 'green'

const W = 520
const H = 320
const PAD = 18
const BATTLE_DISTANCE_PX = 14

function findBattleCars(cars: Array<{ car_index: number; x: number; y: number }>, thresholdPx: number): Set<number> {
  const set = new Set<number>()
  for (let i = 0; i < cars.length; i += 1) {
    for (let j = i + 1; j < cars.length; j += 1) {
      if (Math.hypot(cars[i].x - cars[j].x, cars[i].y - cars[j].y) <= thresholdPx) {
        set.add(cars[i].car_index)
        set.add(cars[j].car_index)
      }
    }
  }
  return set
}

function wrapDelta(from: number, to: number): number {
  return (to - from + 1) % 1
}

function wrapSignedDelta(from: number, to: number): number {
  const forward = wrapDelta(from, to)
  return forward > 0.5 ? forward - 1 : forward
}

function resolveNearbyRivals(
  cars: ReturnType<typeof useSmoothedMinimapCars>,
  playerIdx: number,
): { ahead: number | null; behind: number | null } {
  const player = cars.find((car) => car.car_index === playerIdx)
  if (!player || player.lapRatio === null) return { ahead: null, behind: null }

  let ahead: number | null = null
  let behind: number | null = null
  let aheadGap = Number.POSITIVE_INFINITY
  let behindGap = Number.POSITIVE_INFINITY

  cars.forEach((car) => {
    if (car.car_index === playerIdx || car.lapRatio === null) return
    const forwardGap = wrapDelta(player.lapRatio as number, car.lapRatio)
    const backwardGap = wrapDelta(car.lapRatio, player.lapRatio as number)

    if (forwardGap > 0 && forwardGap < aheadGap) {
      aheadGap = forwardGap
      ahead = car.car_index
    }

    if (backwardGap > 0 && backwardGap < behindGap) {
      behindGap = backwardGap
      behind = car.car_index
    }
  })

  return { ahead, behind }
}

function resolveIncidentZone(raceControlState: string | undefined, eventSummary: string | undefined) {
  const race = (raceControlState ?? '').toLowerCase()
  const summary = (eventSummary ?? '').toLowerCase()
  const hasYellow = race.includes('yellow') || summary.includes('yellow') || summary.includes('incident')
  const hasNeutralized = race.includes('safety') || race.includes('vsc') || summary.includes('safety car')

  if (!hasYellow && !hasNeutralized) return null

  const sectorMatch = summary.match(/sector\s*([123])/i)
  const sectorAnchor = sectorMatch ? [0.17, 0.5, 0.83][Number(sectorMatch[1]) - 1] : 0.5

  return {
    start_ratio: Math.max(0, sectorAnchor - (hasNeutralized ? 0.1 : 0.06)),
    end_ratio: Math.min(1, sectorAnchor + (hasNeutralized ? 0.1 : 0.06)),
    label: hasNeutralized ? 'VSC / SC' : 'YELLOW',
    severity: hasNeutralized ? 'neutralized' : 'yellow',
    affectedSector: sectorMatch ? (Number(sectorMatch[1]) as 1 | 2 | 3) : null,
  } as const
}

function resolveSectorStates(
  incidentZone: ReturnType<typeof resolveIncidentZone>,
  playerSectorMarks: Array<'purple' | 'green' | 'none'> | undefined,
): [SectorState, SectorState, SectorState] {
  const states: [SectorState, SectorState, SectorState] = ['default', 'default', 'default']

  if (playerSectorMarks) {
    for (let i = 0; i < 3; i += 1) {
      if (playerSectorMarks[i] === 'purple') states[i] = 'purple'
      if (playerSectorMarks[i] === 'green') states[i] = 'green'
    }
  }

  if (!incidentZone) return states

  if (incidentZone.affectedSector !== null) {
    states[incidentZone.affectedSector - 1] = 'yellow'
  } else if (incidentZone.severity === 'neutralized') {
    states[0] = 'yellow'
    states[1] = 'yellow'
    states[2] = 'yellow'
  }

  return states
}

function resolvePitZone(track: string | undefined) {
  const key = (track ?? '').toUpperCase()
  if (key.includes('MONACO')) return { start_ratio: 0.84, end_ratio: 0.97, label: 'PIT' }
  if (key.includes('MONZA')) return { start_ratio: 0.9, end_ratio: 0.98, label: 'PIT' }
  if (key.includes('SPA')) return { start_ratio: 0.86, end_ratio: 0.96, label: 'PIT' }
  return { start_ratio: 0.87, end_ratio: 0.97, label: 'PIT' }
}

export const MinimapPanel = memo(function MinimapPanel({ state }: Props) {
  const [mode, setMode] = useState<'standard' | 'radar'>('standard')

  const transform = state?.minimap.transform
  const transformValid = !!transform && isValidTransform(transform)
  const projector = useMemo(() => {
    if (!transform || !transformValid) return null
    return createProjector(W, H, PAD, transform)
  }, [transform, transformValid])

  const traceWorld = useMemo(
    () =>
      (state?.minimap.track_trace ?? [])
        .map((raw) => sanitizeWorldPoint(raw))
        .filter((point): point is { x: number; z: number } => point !== null),
    [state?.minimap.track_trace],
  )

  const trace: ScreenPoint[] = useMemo(() => {
    if (!projector) return []
    return traceWorld.map((point) => projector.toScreen(point))
  }, [projector, traceWorld])

  const trackDef = useMemo(() => getTrackDefinition(state?.track), [state?.track])
  const trackLookup = useMemo(() => (trackDef ? buildProjectedLookup(trackDef, W, H, PAD) : null), [trackDef])

  const smoothCars = useSmoothedMinimapCars(state?.minimap.cars ?? [], projector)
  const playerIdx = state?.minimap.player_car_index ?? -1
  const playerCar = smoothCars.find((car) => car.car_index === playerIdx) ?? null

  const battleCars = useMemo(() => findBattleCars(smoothCars, BATTLE_DISTANCE_PX), [smoothCars])
  const nearbyRivals = useMemo(() => resolveNearbyRivals(smoothCars, playerIdx), [smoothCars, playerIdx])

  const driverCodes = useMemo(
    () => Object.fromEntries((state?.leaderboard ?? []).map((entry) => [entry.car_index, entry.driver_code])) as Record<number, string>,
    [state?.leaderboard],
  )

  const drsZones = useMemo(() => {
    if (trackDef?.drsZones?.length) {
      const race = (state?.race_control_state ?? '').toLowerCase()
      const drsAllowed = !race.includes('safety') && !race.includes('vsc')
      return trackDef.drsZones.map((zone) => ({
        start_ratio: zone.start_ratio,
        end_ratio: zone.end_ratio,
        detection_ratio: zone.detection_ratio,
        label: zone.label,
        is_active: drsAllowed && !!state?.player?.drs_enabled,
      }))
    }

    return resolveDrsZones(state?.minimap.drs_zones, 2, {
      track: state?.track,
      raceControlState: state?.race_control_state,
      playerDrsEnabled: !!state?.player?.drs_enabled,
    })
  }, [trackDef, state?.minimap.drs_zones, state?.track, state?.race_control_state, state?.player?.drs_enabled])

  const focusRatio = playerCar?.lapRatio ?? null
  const rivalGapRatios = useMemo(() => {
    if (focusRatio === null) return []

    return smoothCars
      .filter((car) => car.car_index !== playerIdx && car.lapRatio !== null)
      .map((car) => wrapSignedDelta(focusRatio, car.lapRatio as number))
      .sort((a, b) => Math.abs(a) - Math.abs(b))
      .slice(0, 3)
  }, [smoothCars, focusRatio, playerIdx])

  const tyreWear = Number(state?.leaderboard.find((row) => row.car_index === playerIdx)?.tyre_wear_pct)
  const tyreRiskWindows = useMemo(() => {
    if (!Number.isFinite(tyreWear) || tyreWear < 65) return []
    if (tyreWear < 80) return [{ start_ratio: 0.2, end_ratio: 0.28 }, { start_ratio: 0.74, end_ratio: 0.81 }]
    return [{ start_ratio: 0.15, end_ratio: 0.31 }, { start_ratio: 0.48, end_ratio: 0.63 }, { start_ratio: 0.73, end_ratio: 0.89 }]
  }, [tyreWear])

  const safetyCarState = useMemo(() => {
    const race = (state?.race_control_state ?? '').toLowerCase()
    if (race.includes('virtual') || race.includes('vsc')) return 'vsc' as const
    if (race.includes('safety')) return 'sc' as const
    return 'green' as const
  }, [state?.race_control_state])

  const strategicLayers = useMemo(
    () =>
      buildStrategicLayers({
        playerRatio: focusRatio,
        rivalGapRatios,
        undercutWindow: null,
        tyreRiskWindows,
        safetyCarState,
      }),
    [focusRatio, rivalGapRatios, tyreRiskWindows, safetyCarState],
  )

  const incidentZone = useMemo(
    () => resolveIncidentZone(state?.race_control_state, state?.last_event_summary),
    [state?.race_control_state, state?.last_event_summary],
  )
  const playerSectorMarks = useMemo(
    () => state?.leaderboard.find((row) => row.car_index === playerIdx)?.sector_marks,
    [state?.leaderboard, playerIdx],
  )
  const sectorStates = useMemo(() => resolveSectorStates(incidentZone, playerSectorMarks), [incidentZone, playerSectorMarks])

  const pitZone = useMemo(() => {
    if (trackDef) return { ...trackDef.pitLane, label: 'PIT' }
    return resolvePitZone(state?.track)
  }, [trackDef, state?.track])

  const carCount = smoothCars.length
  const battleCount = battleCars.size
  const drsActiveCount = smoothCars.filter((car) => car.drsActive).length
  const sourceLabel = trackLookup ? 'circuit_def' : state?.minimap.mode ?? 'live_trace'

  const canRenderMap = mode === 'radar' ? !!playerCar : ((projector && trace.length > 1) || !!trackLookup)
  const fallbackText =
    transform && !transformValid
      ? '트랙 변환값이 유효하지 않습니다. UDP transform 범위를 확인해 주세요.'
      : '트랙 좌표를 수신 중입니다. 잠시 후 다시 확인해 주세요.'

  return (
    <section className="panel minimap-panel">
      <div className="panel-header">
        <h3>트랙 맵</h3>
        <div className="minimap-header-actions">
          <div className="minimap-mode-selector" style={{ display: 'flex', gap: 6 }}>
            <button className={`minimap-mode-btn ${mode === 'standard' ? 'is-active' : ''}`} onClick={() => setMode('standard')}>표준</button>
            <button className={`minimap-mode-btn ${mode === 'radar' ? 'is-active' : ''}`} onClick={() => setMode('radar')}>레이더</button>
          </div>
          <div className="small">소스: {sourceLabel}</div>
        </div>
      </div>

      <div className="minimap-meta-grid">
        <div className="minimap-meta-card"><div className="minimap-meta-label">Player</div><div className="minimap-meta-value">{playerIdx >= 0 ? `#${playerIdx}` : '-'}</div></div>
        <div className="minimap-meta-card"><div className="minimap-meta-label">Cars</div><div className="minimap-meta-value">{carCount}</div></div>
        <div className="minimap-meta-card"><div className="minimap-meta-label">Battles</div><div className="minimap-meta-value">{battleCount}</div></div>
        <div className="minimap-meta-card"><div className="minimap-meta-label">DRS Live</div><div className="minimap-meta-value">{drsActiveCount}</div></div>
      </div>

      <div className="minimap-legend" aria-label="Minimap legend">
        <span className="legend-item"><span className="legend-dot is-player" />You</span>
        <span className="legend-item"><span className="legend-dot is-battle" />Battle</span>
        <span className="legend-item"><span className="legend-dot is-sector-purple" />Fastest S</span>
        <span className="legend-item"><span className="legend-dot is-sector-green" />PB Sector</span>
        <span className="legend-item"><span className="legend-dot is-sector-yellow" />Yellow</span>
      </div>

      {!canRenderMap ? (
        <div className="minimap-drop-zone minimap-fallback">{fallbackText}</div>
      ) : mode === 'radar' && playerCar ? (
        <div className="minimap-radar-container" style={{ padding: 16, display: 'flex', justifyContent: 'center' }}>
          <RadarMode
            cars={smoothCars}
            playerCar={playerCar}
            playerIdx={playerIdx}
            battleCars={battleCars}
            driverCodes={driverCodes}
            trackLookup={trackLookup}
          />
        </div>
      ) : (
        <div className="minimap-drop-zone">
          <svg className="minimap-svg" width="100%" height="auto" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="실시간 트랙 미니맵">
            <TrackLayers
              trace={trace}
              drsZones={drsZones}
              strategicLayers={strategicLayers}
              focusRatio={focusRatio}
              pitZone={pitZone}
              incidentZone={incidentZone}
              sectorStates={sectorStates}
              trackLookup={trackLookup}
            />

            <g className="minimap-car-layer">
              {smoothCars.map((car) => {
                const relation = car.car_index === nearbyRivals.ahead ? 'ahead' : car.car_index === nearbyRivals.behind ? 'behind' : null
                const driverCode = driverCodes[car.car_index] ?? `#${car.car_index}`
                const label = car.car_index === playerIdx ? 'YOU' : relation === 'ahead' ? `AHEAD ${driverCode}` : relation === 'behind' ? `BEHIND ${driverCode}` : null

                return (
                  <CarMarker
                    key={car.car_index}
                    car={car}
                    isPlayer={car.car_index === playerIdx}
                    inBattle={battleCars.has(car.car_index)}
                    relation={relation}
                    label={label}
                    driverCode={driverCode}
                  />
                )
              })}
            </g>

            <MinimapInset
              trace={trace}
              cars={smoothCars}
              playerCar={playerCar}
              playerIdx={playerIdx}
              aheadCarIndex={nearbyRivals.ahead}
              behindCarIndex={nearbyRivals.behind}
              battleCars={battleCars}
              driverCodes={driverCodes}
              trackLookup={trackLookup}
            />
          </svg>
        </div>
      )}

      <div className="footer-note">
        {trackLookup
          ? `서킷 정의: ${trackLookup.definition.displayName} (${trackLookup.definition.lengthMeters}m)`
          : `트레이스 포인트 ${trace.length}`}
        {` · 차량 ${carCount}`}
        {` · 앞 ${nearbyRivals.ahead !== null ? (driverCodes[nearbyRivals.ahead] ?? `#${nearbyRivals.ahead}`) : '-'}`}
        {` · 뒤 ${nearbyRivals.behind !== null ? (driverCodes[nearbyRivals.behind] ?? `#${nearbyRivals.behind}`) : '-'}`}
      </div>
    </section>
  )
})
