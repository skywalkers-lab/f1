
import { useMemo, useState, useCallback, useRef, memo } from 'react'
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
import { buildProjectedLookup, pointOnTrackByRatio } from '../lib/trackProjection'

type Props = { state: AppState | null }

const W = 520
const H = 320
const PAD = 18
const BATTLE_DISTANCE_PX = 15

function findBattleCars(cars: Array<{ car_index: number; x: number; y: number }>, thresholdPx: number): Set<number> {
  const set = new Set<number>()
  for (let i = 0; i < cars.length; i += 1) {
    for (let j = i + 1; j < cars.length; j += 1) {
      const a = cars[i]
      const b = cars[j]
      const d = Math.hypot(a.x - b.x, a.y - b.y)
      if (d <= thresholdPx) {
        set.add(a.car_index)
        set.add(b.car_index)
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
  if (forward > 0.5) return forward - 1
  return forward
}

function resolveNearbyRivals(cars: ReturnType<typeof useSmoothedMinimapCars>, playerIdx: number): { ahead: number | null; behind: number | null } {
  const player = cars.find((car) => car.car_index === playerIdx)
  if (!player || player.lapRatio === null) return { ahead: null, behind: null }

  const playerLapRatio = player.lapRatio

  let aheadIndex: number | null = null
  let aheadGap = Number.POSITIVE_INFINITY
  let behindIndex: number | null = null
  let behindGap = Number.POSITIVE_INFINITY

  cars.forEach((car) => {
    if (car.car_index === playerIdx || car.lapRatio === null) return

    const forwardGap = wrapDelta(playerLapRatio, car.lapRatio)
    const backwardGap = wrapDelta(car.lapRatio, playerLapRatio)

    if (forwardGap > 0 && forwardGap < aheadGap) {
      aheadIndex = car.car_index
      aheadGap = forwardGap
    }

    if (backwardGap > 0 && backwardGap < behindGap) {
      behindIndex = car.car_index
      behindGap = backwardGap
    }
  })

  return {
    ahead: aheadIndex,
    behind: behindIndex,
  }
}

function resolvePitZone(track: string | undefined) {
  const key = (track ?? '').toUpperCase()
  if (key.includes('MONACO')) return { start_ratio: 0.84, end_ratio: 0.97, label: 'PIT IN' }
  if (key.includes('MONZA')) return { start_ratio: 0.9, end_ratio: 0.98, label: 'PIT IN' }
  if (key.includes('SPA')) return { start_ratio: 0.86, end_ratio: 0.96, label: 'PIT IN' }
  return { start_ratio: 0.87, end_ratio: 0.97, label: 'PIT IN' }
}

function resolveProjectedRejoin(state: AppState | null): string {
  if (!state?.leaderboard?.length) return '-'
  const pitLossS = Number(state.strategy?.key_inputs?.pit_loss_est_s)
  const targetLoss = Number.isFinite(pitLossS) ? pitLossS : 21.5
  const sorted = [...state.leaderboard].sort((a, b) => a.position - b.position)
  const candidate = sorted.find((row) => row.gap_to_player_s >= targetLoss - 1.5)
  const behind = sorted.find((row) => row.gap_to_player_s >= targetLoss + 1.5)
  if (!candidate) return 'Back of queue'
  if (!behind) return `Around P${candidate.position}`
  return `P${candidate.position}-${behind.position}`
}

function resolveUndercutWindow(state: AppState | null): { start_ratio: number; end_ratio: number } | null {
  const player = state?.minimap?.player_car_index
  if (!Number.isFinite(player as number)) return null
  const playerCar = state?.minimap?.cars?.find((car) => car.car_index === player)
  if (!playerCar || !Number.isFinite(playerCar.lap_distance_ratio as number)) return null

  const pitLossS = Number(state?.strategy?.key_inputs?.pit_loss_est_s)
  const lapTimeS = Number(state?.strategy?.key_inputs?.projected_lap_time_s)
  const baseLoss = Number.isFinite(pitLossS) ? pitLossS : 21
  const baselineLap = Number.isFinite(lapTimeS) && lapTimeS > 40 ? lapTimeS : 88
  const ratioSpan = Math.min(0.18, Math.max(0.04, baseLoss / baselineLap))
  const center = Number(playerCar.lap_distance_ratio)
  return {
    start_ratio: Math.max(0, center - ratioSpan * 0.45),
    end_ratio: Math.min(1, center + ratioSpan * 0.55),
  }
}

function resolveTyreRiskWindows(state: AppState | null): Array<{ start_ratio: number; end_ratio: number }> {
  const rows = state?.leaderboard ?? []
  const player = rows.find((row) => row.car_index === state?.minimap.player_car_index)
  const wear = Number(player?.tyre_wear_pct)
  if (!Number.isFinite(wear)) return []

  if ((wear as number) < 65) return []
  if ((wear as number) < 80) {
    return [
      { start_ratio: 0.2, end_ratio: 0.28 },
      { start_ratio: 0.74, end_ratio: 0.81 },
    ]
  }

  return [
    { start_ratio: 0.15, end_ratio: 0.31 },
    { start_ratio: 0.48, end_ratio: 0.63 },
    { start_ratio: 0.73, end_ratio: 0.89 },
  ]
}

function resolveIncidentZone(
  raceControlState: string | undefined,
  lastEventSummary: string | undefined,
  cars: ReturnType<typeof useSmoothedMinimapCars>,
  battleCars: Set<number>,
  playerRatio: number | null,
) {
  const race = (raceControlState ?? '').toLowerCase()
  const summary = (lastEventSummary ?? '').toLowerCase()
  const hasYellow = race.includes('yellow') || summary.includes('yellow') || summary.includes('incident') || summary.includes('crash')
  const hasNeutralized = race.includes('safety') || race.includes('vsc') || summary.includes('safety car') || summary.includes('vsc')

  if (!hasYellow && !hasNeutralized) return null

  const sectorMatch = summary.match(/sector\s*([123])/i)
  const sectorAnchor = sectorMatch ? [0.17, 0.5, 0.83][Number(sectorMatch[1]) - 1] : null
  const battleRatios = cars.filter((car) => battleCars.has(car.car_index) && car.lapRatio !== null).map((car) => car.lapRatio as number)
  const anchor = sectorAnchor ?? battleRatios[0] ?? playerRatio ?? 0.32

  return {
    start_ratio: Math.max(0, anchor - (hasNeutralized ? 0.09 : 0.05)),
    end_ratio: Math.min(1, anchor + (hasNeutralized ? 0.09 : 0.05)),
    label: hasNeutralized ? 'VSC / SC' : 'YELLOW',
    severity: hasNeutralized ? 'neutralized' : 'yellow',
    affectedSector: sectorMatch ? (Number(sectorMatch[1]) as 1 | 2 | 3) : null,
  } as const
}

type SectorState = 'default' | 'yellow' | 'purple' | 'green'

function resolveSectorStates(
  incidentZone: ReturnType<typeof resolveIncidentZone>,
  playerSectorMarks: Array<'purple' | 'green' | 'none'> | undefined,
): [SectorState, SectorState, SectorState] {
  const states: [SectorState, SectorState, SectorState] = ['default', 'default', 'default']

  // Apply timing performance marks (purple = session best, green = personal best)
  if (playerSectorMarks) {
    for (let i = 0; i < 3; i += 1) {
      const mark = playerSectorMarks[i]
      if (mark === 'purple') states[i] = 'purple'
      else if (mark === 'green') states[i] = 'green'
    }
  }

  // Yellow flag overrides: sector-specific or full-track neutralization
  if (incidentZone) {
    if (incidentZone.affectedSector !== null) {
      // Only the specific sector goes yellow; others keep the performance mark
      states[incidentZone.affectedSector - 1] = 'yellow'
    } else if (incidentZone.severity === 'neutralized') {
      // Safety Car / VSC → all sectors yellow
      states[0] = 'yellow'
      states[1] = 'yellow'
      states[2] = 'yellow'
    } else {
      // Generic yellow without sector info → best-guess anchor sector
      const anchor = (incidentZone.start_ratio + incidentZone.end_ratio) / 2
      const sectorIdx = anchor < 0.333 ? 0 : anchor < 0.667 ? 1 : 2
      states[sectorIdx] = 'yellow'
    }
  }

  return states
}

export const MinimapPanel = memo(function MinimapPanel({ state }: Props) {
  // --- Track image overlay state ---
  const [trackImageUrl, setTrackImageUrl] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search)
    return params.get('track_image') || null
  })
  const [imgOpacity, setImgOpacity] = useState(0.45)
  const [imgInvert, setImgInvert] = useState(true) // default on: most circuit images are black-on-white
  const [imgScale, setImgScale] = useState(100) // percent
  const [imgOffsetX, setImgOffsetX] = useState(0) // px shift
  const [imgOffsetY, setImgOffsetY] = useState(0)
  const [imgShowControls, setImgShowControls] = useState(false)
  const [isDraggingOver, setIsDraggingOver] = useState(false)
  const [minimapMode, setMinimapMode] = useState<'standard' | 'radar'>('standard')
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const handleFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return
    const url = URL.createObjectURL(file)
    setTrackImageUrl(url)
    setImgShowControls(true)
  }, [])

  const handleTrackImageUpload = useCallback((e: { target: { files: FileList | null } }) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }, [handleFile])

  const handleDrop = useCallback((e: { preventDefault: () => void; stopPropagation: () => void; dataTransfer: { files: FileList } }) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDraggingOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [handleFile])

  const handleDragOver = useCallback((e: { preventDefault: () => void }) => {
    e.preventDefault()
    setIsDraggingOver(true)
  }, [])

  const handleDragLeave = useCallback(() => setIsDraggingOver(false), [])

  const clearTrackImage = useCallback(() => {
    setTrackImageUrl(null)
    setImgShowControls(false)
    setImgScale(100)
    setImgOffsetX(0)
    setImgOffsetY(0)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [])

  const resetImgTransform = useCallback(() => {
    setImgScale(100)
    setImgOffsetX(0)
    setImgOffsetY(0)
    setImgOpacity(0.45)
  }, [])

  const traceWorld = useMemo(
    () =>
      (state?.minimap.track_trace ?? [])
        .map((raw) => sanitizeWorldPoint(raw))
        .filter((point): point is { x: number; z: number } => point !== null),
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
    return traceWorld.map((point: { x: number; z: number }) => projector.toScreen(point))
  }, [traceWorld, projector])

  // --- Track definition system: real circuit geometry ---
  const trackDef = useMemo(() => getTrackDefinition(state?.track), [state?.track])
  const trackLookup = useMemo(() => {
    if (!trackDef) return null
    return buildProjectedLookup(trackDef, W, H, PAD)
  }, [trackDef])

  const rawCars = state?.minimap.cars ?? []
  const smoothCars = useSmoothedMinimapCars(rawCars, projector)
  const battleCars = useMemo(() => findBattleCars(smoothCars, BATTLE_DISTANCE_PX), [smoothCars])
  const drsZones = useMemo(
    () => {
      // Prefer DRS zones from the track definition (accurate FIA data)
      if (trackDef && trackDef.drsZones.length > 0) {
        const raceState = (state?.race_control_state ?? '').toLowerCase()
        const drsAllowed = !raceState.includes('safety') && !raceState.includes('vsc')
        return trackDef.drsZones.map((zone, i) => ({
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
    },
    [state?.minimap.drs_zones, state?.track, state?.race_control_state, state?.player?.drs_enabled, trackDef],
  )
  const playerCar = smoothCars.find((car) => car.car_index === state?.minimap.player_car_index) ?? null
  const nearbyRivals = useMemo(() => resolveNearbyRivals(smoothCars, state?.minimap.player_car_index ?? -1), [smoothCars, state?.minimap.player_car_index])
  const renderCars = useMemo(() => {
    const priority = (carIndex: number, isPitting: boolean) => {
      let score = 0
      if (battleCars.has(carIndex)) score += 2
      if (isPitting) score += 1
      if (carIndex === state?.minimap.player_car_index) score += 4
      return score
    }

    return [...smoothCars].sort((a, b) => priority(a.car_index, a.isPitting) - priority(b.car_index, b.isPitting))
  }, [smoothCars, battleCars, state?.minimap.player_car_index])
  const drsActiveCount = smoothCars.filter((car) => car.drsActive).length
  const pitLaneCount = smoothCars.filter((car) => car.isPitting).length
  const focusRatio = playerCar?.lapRatio ?? null
  const driverCodes = useMemo(
    () =>
      Object.fromEntries((state?.leaderboard ?? []).map((entry) => [entry.car_index, entry.driver_code])) as Record<number, string>,
    [state?.leaderboard],
  )
  const pitZone = useMemo(() => {
    // Use track definition pit lane data when available
    if (trackDef) {
      return { start_ratio: trackDef.pitLane.start_ratio, end_ratio: trackDef.pitLane.end_ratio, label: 'PIT IN' }
    }
    return resolvePitZone(state?.track)
  }, [state?.track, trackDef])
  const undercutWindow = useMemo(() => resolveUndercutWindow(state), [state])
  const tyreRiskWindows = useMemo(() => resolveTyreRiskWindows(state), [state])
  const projectedRejoin = useMemo(() => resolveProjectedRejoin(state), [state])
  const incidentZone = useMemo(
    () => resolveIncidentZone(state?.race_control_state, state?.last_event_summary, smoothCars, battleCars, focusRatio),
    [state?.race_control_state, state?.last_event_summary, smoothCars, battleCars, focusRatio],
  )

  const playerSectorMarks = useMemo(
    () => state?.leaderboard.find((r) => r.car_index === state.minimap.player_car_index)?.sector_marks,
    [state],
  )
  const sectorStates = useMemo(
    () => resolveSectorStates(incidentZone, playerSectorMarks),
    [incidentZone, playerSectorMarks],
  )
  const safetyCarState = useMemo(() => {
    const race = (state?.race_control_state ?? '').toLowerCase()
    if (race.includes('virtual') || race.includes('vsc')) return 'vsc' as const
    if (race.includes('safety')) return 'sc' as const
    return 'green' as const
  }, [state?.race_control_state])
  const rivalGapRatios = useMemo(() => {
    if (!playerCar || playerCar.lapRatio === null) return []
    return smoothCars
      .filter((car) => car.car_index !== playerCar.car_index && car.lapRatio !== null)
      .map((car) => wrapSignedDelta(playerCar.lapRatio as number, car.lapRatio as number))
      .sort((a, b) => Math.abs(a) - Math.abs(b))
      .slice(0, 3)
  }, [smoothCars, playerCar])
  const strategicLayers = useMemo(
    () =>
      buildStrategicLayers({
        playerRatio: focusRatio,
        rivalGapRatios,
        undercutWindow,
        tyreRiskWindows,
        safetyCarState,
      }),
    [focusRatio, rivalGapRatios, undercutWindow, tyreRiskWindows, safetyCarState],
  )

  const playerIdx = state?.minimap.player_car_index ?? -1
  const playerLabel = playerIdx >= 0 ? `#${playerIdx}` : '-'
  const invalidTransformText =
    transform && !transformValid
      ? '트랙 변환값이 유효하지 않아 미니맵을 렌더링할 수 없습니다.'
      : '트랙 좌표를 대기 중입니다.'

  return (
    <section className="panel minimap-panel">
      <div className="panel-header">
        <h3>트랙 맵</h3>
        <div className="minimap-header-actions">
          <div className="minimap-mode-selector" style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
            <button
              className={`minimap-mode-btn ${minimapMode === 'standard' ? 'is-active' : ''}`}
              onClick={() => setMinimapMode('standard')}
              title="표준 미니맵"
              style={{
                padding: '4px 12px',
                fontSize: '12px',
                border: minimapMode === 'standard' ? '2px solid #00d4ff' : '1px solid #555',
                background: minimapMode === 'standard' ? 'rgba(0, 212, 255, 0.1)' : 'transparent',
                color: minimapMode === 'standard' ? '#00d4ff' : '#999',
                borderRadius: '4px',
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
            >
              표준
            </button>
            <button
              className={`minimap-mode-btn ${minimapMode === 'radar' ? 'is-active' : ''}`}
              onClick={() => setMinimapMode('radar')}
              title="레이더 모드"
              style={{
                padding: '4px 12px',
                fontSize: '12px',
                border: minimapMode === 'radar' ? '2px solid #00d4ff' : '1px solid #555',
                background: minimapMode === 'radar' ? 'rgba(0, 212, 255, 0.1)' : 'transparent',
                color: minimapMode === 'radar' ? '#00d4ff' : '#999',
                borderRadius: '4px',
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
            >
              레이더
            </button>
          </div>
          <div className="small">소스: {trackLookup ? 'circuit_def' : state?.minimap.mode ?? 'live_trace'}</div>
          <label className="minimap-upload-btn" title="트랙 이미지 업로드 (드래그&드롭 가능)">
            🖼
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleTrackImageUpload} style={{ display: 'none' }} />
          </label>
          {trackImageUrl && (
            <>
              <button
                className={`minimap-tool-btn ${imgShowControls ? 'is-active' : ''}`}
                onClick={() => setImgShowControls((v) => !v)}
                title="이미지 조정"
              >⚙</button>
              <button className="minimap-clear-btn" onClick={clearTrackImage} title="이미지 제거">✕</button>
            </>
          )}
        </div>
      </div>

      {/* Track image adjustment controls */}
      {trackImageUrl && imgShowControls && (
        <div className="minimap-img-controls">
          <div className="minimap-img-row">
            <label>투명도</label>
            <input type="range" min={0} max={100} value={imgOpacity * 100} onChange={(e: { target: { value: string } }) => setImgOpacity(Number(e.target.value) / 100)} />
            <span>{Math.round(imgOpacity * 100)}%</span>
          </div>
          <div className="minimap-img-row">
            <label>크기</label>
            <input type="range" min={30} max={200} value={imgScale} onChange={(e: { target: { value: string } }) => setImgScale(Number(e.target.value))} />
            <span>{imgScale}%</span>
          </div>
          <div className="minimap-img-row">
            <label>X 이동</label>
            <input type="range" min={-200} max={200} value={imgOffsetX} onChange={(e: { target: { value: string } }) => setImgOffsetX(Number(e.target.value))} />
            <span>{imgOffsetX}px</span>
          </div>
          <div className="minimap-img-row">
            <label>Y 이동</label>
            <input type="range" min={-200} max={200} value={imgOffsetY} onChange={(e: { target: { value: string } }) => setImgOffsetY(Number(e.target.value))} />
            <span>{imgOffsetY}px</span>
          </div>
          <div className="minimap-img-row">
            <label className="minimap-img-toggle">
              <input type="checkbox" checked={imgInvert} onChange={() => setImgInvert((v) => !v)} />
              <span>색상 반전 (흰 배경 이미지용)</span>
            </label>
            <button className="minimap-reset-btn" onClick={resetImgTransform}>리셋</button>
          </div>
        </div>
      )}

      <div className="minimap-meta-grid">
        <div className="minimap-meta-card">
          <div className="minimap-meta-label">Player</div>
          <div className="minimap-meta-value">{playerLabel}</div>
        </div>
        <div className="minimap-meta-card">
          <div className="minimap-meta-label">Battles</div>
          <div className="minimap-meta-value">{battleCars.size}</div>
        </div>
        <div className="minimap-meta-card">
          <div className="minimap-meta-label">DRS Live</div>
          <div className="minimap-meta-value">{drsActiveCount}</div>
        </div>
        <div className="minimap-meta-card">
          <div className="minimap-meta-label">Pit Lane</div>
          <div className="minimap-meta-value">{pitLaneCount}</div>
        </div>
      </div>

      <div className="minimap-legend" aria-label="Minimap legend">
        <span className="legend-item"><span className="legend-dot is-player" />You</span>
        <span className="legend-item"><span className="legend-dot is-battle" />Battle</span>
        <span className="legend-item"><span className="legend-dot is-sector-purple" />Fastest S</span>
        <span className="legend-item"><span className="legend-dot is-sector-green" />PB Sector</span>
        <span className="legend-item"><span className="legend-dot is-sector-yellow" />Yellow</span>
      </div>

      {/* Radar Mode */}
      {minimapMode === 'radar' && playerCar ? (
        <div className="minimap-radar-container" style={{ padding: '16px', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <RadarMode
            cars={smoothCars}
            playerCar={playerCar}
            playerIdx={state?.minimap.player_car_index ?? -1}
            battleCars={battleCars}
            driverCodes={driverCodes}
            trackLookup={trackLookup}
          />
        </div>
      ) : null}

      {/* Standard Mode */}
      {minimapMode === 'standard' && ((projector && trace.length > 1) || trackLookup) ? (
        <div
          className={`minimap-drop-zone ${isDraggingOver ? 'is-dragging' : ''}`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
        >
          {isDraggingOver && <div className="minimap-drop-overlay">트랙 이미지를 여기에 놓으세요</div>}
          <svg className="minimap-svg" width="100%" height="auto" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="실시간 트랙 미니맵">
            {/* SVG filter for inverting dark-on-light images */}
            <defs>
              <filter id="trackImgInvert">
                <feColorMatrix type="matrix" values="-1 0 0 0 1  0 -1 0 0 1  0 0 -1 0 1  0 0 0 1 0" />
              </filter>
            </defs>

            {trackImageUrl && (() => {
              const s = imgScale / 100
              const baseW = W - PAD * 2
              const baseH = H - PAD * 2
              const scaledW = baseW * s
              const scaledH = baseH * s
              const cx = PAD + baseW / 2 + imgOffsetX
              const cy = PAD + baseH / 2 + imgOffsetY
              return (
                <image
                  href={trackImageUrl}
                  x={cx - scaledW / 2}
                  y={cy - scaledH / 2}
                  width={scaledW}
                  height={scaledH}
                  preserveAspectRatio="xMidYMid meet"
                  opacity={imgOpacity}
                  filter={imgInvert ? 'url(#trackImgInvert)' : undefined}
                  className="minimap-track-image"
                />
              )
            })()}
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
            {renderCars.map((car) => {
                const relation = car.car_index === nearbyRivals.ahead ? 'ahead' : car.car_index === nearbyRivals.behind ? 'behind' : null
                const code = driverCodes[car.car_index] ?? `#${car.car_index}`
                const label =
                  car.car_index === playerIdx
                    ? 'YOU'
                    : relation === 'ahead'
                      ? `AHEAD ${code}`
                      : relation === 'behind'
                        ? `BEHIND ${code}`
                        : car.isPitting
                          ? `PIT ${code}`
                          : battleCars.has(car.car_index)
                            ? code
                            : null

                return (
                  <CarMarker
                    key={car.car_index}
                    car={car}
                    isPlayer={car.car_index === playerIdx}
                    inBattle={battleCars.has(car.car_index)}
                    relation={relation}
                    label={label}
                    driverCode={code}
                  />
                )
              })}
          </g>

          <MinimapInset
            trace={trace}
            cars={renderCars}
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
      ) : (
        <div
          className={`minimap-drop-zone minimap-fallback ${isDraggingOver ? 'is-dragging' : ''}`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
        >
          {isDraggingOver && <div className="minimap-drop-overlay">트랙 이미지를 여기에 놓으세요</div>}
          {invalidTransformText}
        </div>
      )}

      <div className="footer-note">
        {trace.length === 0 && !trackLookup
          ? '실시간 위치 샘플을 수집 중입니다.'
          : trackLookup
            ? `서킷 정의: ${trackLookup.definition.displayName} (${trackLookup.definition.lengthMeters}m) | 차량 ${smoothCars.length}/22 | 플레이어 ${playerLabel}`
            : `트레이스 포인트 ${trace.length} | 차량 ${smoothCars.length}/22 | 플레이어 ${playerLabel} | 근접 배틀 차량 ${battleCars.size}`}
      </div>
      <div className="footer-note">예상 피트 리조인: {projectedRejoin} · DRS 활동 차량 {drsActiveCount} · 병목 클러스터 {battleCars.size}</div>
      <div className="footer-note">앞 차량 {nearbyRivals.ahead !== null ? driverCodes[nearbyRivals.ahead] ?? `#${nearbyRivals.ahead}` : '-'} · 뒤 차량 {nearbyRivals.behind !== null ? driverCodes[nearbyRivals.behind] ?? `#${nearbyRivals.behind}` : '-'}</div>
      <div className="footer-note">오버레이: 트랙 리본 · 앞뒤 차량 강조 · 피트 인 구간 · 사고/옐로우 구간 · 플레이어 로컬 인셋</div>
      <div className="footer-note">
        트랙 경계 X[{transform?.min_x.toFixed(1) ?? '-'}, {transform?.max_x.toFixed(1) ?? '-'}] Z[{transform?.min_z.toFixed(1) ?? '-'}, {transform?.max_z.toFixed(1) ?? '-'}]
      </div>
    </section>
  )
})
