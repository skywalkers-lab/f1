import { memo, useMemo } from 'react'
import {
  buildPath,
  buildPathDistanceCache,
  buildRibbonPath,
  DRSZone,
  normalizeRatio,
  perpendicularLineAtRatio,
  pointAtRatio,
  ScreenPoint,
  sectorByDistance,
  slicePathAroundRatio,
  slicePathBetweenRatios,
  TrackVisualLayer,
} from '../../lib/minimapProjection'
import type { TrackLookup } from '../../lib/trackDefinition'
import {
  buildSlicePathD,
  buildTrackPathD,
  buildTrackRibbonD,
  pointOnTrackByRatio,
  tangentOnTrack,
} from '../../lib/trackProjection'

type OverlayZone = {
  start_ratio: number
  end_ratio: number
  label: string
  severity?: 'pit' | 'yellow' | 'neutralized'
}

type SectorState = 'default' | 'yellow' | 'purple' | 'green'

type Props = {
  trace: ScreenPoint[]
  drsZones: DRSZone[]
  strategicLayers?: TrackVisualLayer[]
  focusRatio?: number | null
  pitZone?: OverlayZone | null
  incidentZone?: OverlayZone | null
  sectorStates?: [SectorState, SectorState, SectorState]
  /** When provided, renders from the fixed track definition instead of UDP trace. */
  trackLookup?: TrackLookup | null
}

// ---------------------------------------------------------------------------
// Helper: perpendicular tick mark at a ratio on the spline
// ---------------------------------------------------------------------------
function perpTickAtRatio(lookup: TrackLookup, ratio: number, halfLen: number): [ScreenPoint, ScreenPoint] | null {
  const pt = pointOnTrackByRatio(lookup, ratio)
  const tan = tangentOnTrack(lookup, ratio)
  const nx = -tan.y
  const ny = tan.x
  return [
    { x: pt.x + nx * halfLen, y: pt.y + ny * halfLen },
    { x: pt.x - nx * halfLen, y: pt.y - ny * halfLen },
  ]
}

// ---------------------------------------------------------------------------
// Definition-based rendering (NEW: accurate circuit geometry)
// ---------------------------------------------------------------------------
function DefinitionLayers({
  trackLookup,
  drsZones,
  strategicLayers = [],
  focusRatio = null,
  pitZone = null,
  incidentZone = null,
  sectorStates,
}: Omit<Props, 'trace'> & { trackLookup: TrackLookup }) {
  const def = trackLookup.definition

  const trackBodyPath = useMemo(() => buildTrackRibbonD(trackLookup, 8.2), [trackLookup])
  const trackInnerPath = useMemo(() => buildTrackRibbonD(trackLookup, 5.3), [trackLookup])
  const baselinePath = useMemo(() => buildTrackPathD(trackLookup), [trackLookup])

  // Sector paths from definition (real FIA sectors)
  const [s1r, s2r] = def.sectors
  const s1Path = useMemo(() => buildSlicePathD(trackLookup, 0, s1r), [trackLookup, s1r])
  const s2Path = useMemo(() => buildSlicePathD(trackLookup, s1r, s2r), [trackLookup, s1r, s2r])
  const s3Path = useMemo(() => buildSlicePathD(trackLookup, s2r, 1), [trackLookup, s2r])

  // Sector label anchors
  const sectorAnchors = useMemo(
    () => [
      pointOnTrackByRatio(trackLookup, 0.01),
      pointOnTrackByRatio(trackLookup, s1r + 0.01),
      pointOnTrackByRatio(trackLookup, s2r + 0.01),
    ],
    [trackLookup, s1r, s2r],
  )

  // Focus window around player
  const focusPath = useMemo(() => {
    if (focusRatio === null || !Number.isFinite(focusRatio)) return ''
    const r = ((focusRatio % 1) + 1) % 1
    return buildSlicePathD(trackLookup, Math.max(0, r - 0.05), Math.min(1, r + 0.11))
  }, [trackLookup, focusRatio])

  // Pit zone
  const pitPath = useMemo(() => {
    if (!pitZone) return ''
    return buildSlicePathD(trackLookup, pitZone.start_ratio, pitZone.end_ratio)
  }, [trackLookup, pitZone])
  const pitLabelAnchor = useMemo(
    () => (pitZone ? pointOnTrackByRatio(trackLookup, pitZone.start_ratio) : null),
    [trackLookup, pitZone],
  )

  // Incident zone
  const incidentPath = useMemo(() => {
    if (!incidentZone) return ''
    return buildSlicePathD(trackLookup, incidentZone.start_ratio, incidentZone.end_ratio)
  }, [trackLookup, incidentZone])
  const incidentLabelAnchor = useMemo(
    () => (incidentZone ? pointOnTrackByRatio(trackLookup, incidentZone.start_ratio) : null),
    [trackLookup, incidentZone],
  )

  // Start/finish line
  const startLine = useMemo(() => perpTickAtRatio(trackLookup, 0, 9), [trackLookup])
  const startLabel = useMemo(() => pointOnTrackByRatio(trackLookup, 0.012), [trackLookup])

  // Reference tick marks
  const referenceLines = useMemo(
    () => [0.17, 0.5, 0.83].map((r) => ({ ratio: r, points: perpTickAtRatio(trackLookup, r, 5.5) })).filter((v): v is { ratio: number; points: [ScreenPoint, ScreenPoint] } => v.points !== null),
    [trackLookup],
  )

  // Strategic overlay paths
  const strategicLayerPaths = useMemo(
    () =>
      strategicLayers
        .map((layer) => ({ layer, path: buildSlicePathD(trackLookup, layer.start_ratio, layer.end_ratio) }))
        .filter((e) => !!e.path),
    [strategicLayers, trackLookup],
  )

  // Corner labels from definition features
  const cornerLabels = useMemo(() => {
    const corners = def.features?.corners ?? []
    return corners
      .filter((c) => c.highlight)
      .map((c) => ({ ...c, pos: pointOnTrackByRatio(trackLookup, c.ratio) }))
  }, [trackLookup, def.features?.corners])

  // Special sections (e.g. tunnel)
  const sectionPaths = useMemo(() => {
    const sections = def.features?.sections ?? []
    return sections.map((s) => ({
      ...s,
      path: buildSlicePathD(trackLookup, s.start_ratio, s.end_ratio),
    }))
  }, [trackLookup, def.features?.sections])

  return (
    <g className="minimap-track-layers">
      {trackBodyPath ? <path d={trackBodyPath} className="minimap-track-body" /> : null}
      {trackInnerPath ? <path d={trackInnerPath} className="minimap-track-inner" /> : null}
      {baselinePath ? <path d={baselinePath} className="minimap-baseline" /> : null}

      {/* Real FIA sector paths */}
      {s1Path ? <path d={s1Path} className={`minimap-sector is-${sectorStates?.[0] ?? 'default'}`} /> : null}
      {s2Path ? <path d={s2Path} className={`minimap-sector is-${sectorStates?.[1] ?? 'default'}`} /> : null}
      {s3Path ? <path d={s3Path} className={`minimap-sector is-${sectorStates?.[2] ?? 'default'}`} /> : null}

      {/* Special sections (tunnel etc.) */}
      {sectionPaths.map((s) =>
        s.path ? <path key={s.name} d={s.path} className={`minimap-section is-${s.style}`} /> : null,
      )}

      {pitPath ? <path d={pitPath} className="minimap-pit-window" /> : null}
      {incidentPath ? <path d={incidentPath} className={`minimap-incident-line is-${incidentZone?.severity ?? 'yellow'}`} /> : null}
      {focusPath ? <path d={focusPath} className="minimap-focus-window" /> : null}

      {strategicLayerPaths.map(({ layer, path }) => (
        <path key={layer.id} d={path} className={layer.className} />
      ))}

      {referenceLines.map(({ ratio, points }) => (
        <line
          key={`ref-${ratio.toFixed(2)}`}
          x1={points[0].x}
          y1={points[0].y}
          x2={points[1].x}
          y2={points[1].y}
          className="minimap-reference-line"
        />
      ))}

      {startLine ? (
        <line x1={startLine[0].x} y1={startLine[0].y} x2={startLine[1].x} y2={startLine[1].y} className="minimap-start-line" />
      ) : null}

      {startLabel ? (
        <text x={startLabel.x + 10} y={startLabel.y + 14} className="minimap-start-label">
          START
        </text>
      ) : null}

      {pitLabelAnchor && pitZone ? (
        <text x={pitLabelAnchor.x + 8} y={pitLabelAnchor.y + 12} className="minimap-pit-label">
          {pitZone.label}
        </text>
      ) : null}

      {incidentLabelAnchor && incidentZone ? (
        <text x={incidentLabelAnchor.x + 8} y={incidentLabelAnchor.y - 10} className={`minimap-incident-label is-${incidentZone.severity ?? 'yellow'}`}>
          {incidentZone.label}
        </text>
      ) : null}

      {sectorAnchors.map((anchor, index) =>
        anchor ? (
          <text key={`sector-${index + 1}`} x={anchor.x + 6} y={anchor.y - 6} className="minimap-sector-label">
            S{index + 1}
          </text>
        ) : null,
      )}

      {/* Corner name labels for highlighted corners */}
      {cornerLabels.map((c) => (
        <text key={c.name} x={c.pos.x + 8} y={c.pos.y - 6} className="minimap-corner-label">
          {c.name}
        </text>
      ))}

      {/* DRS zones — use definition data when available, or fallback to props */}
      {drsZones.map((zone, index) => {
        const start = pointOnTrackByRatio(trackLookup, zone.start_ratio)
        const end = pointOnTrackByRatio(trackLookup, zone.end_ratio)
        const detect = pointOnTrackByRatio(trackLookup, zone.detection_ratio ?? ((zone.start_ratio - 0.05 + 1) % 1))
        const drsPath = buildSlicePathD(trackLookup, zone.start_ratio, zone.end_ratio)
        return (
          <g key={`${zone.label ?? 'drs'}-${index}`}>
            {drsPath ? <path d={drsPath} className={`minimap-drs-line ${zone.is_active ? 'is-active' : ''}`} /> : null}
            {detect ? <circle cx={detect.x} cy={detect.y} r={2.5} className="minimap-drs-dot is-detect" /> : null}
            <circle cx={start.x} cy={start.y} r={3.6} className="minimap-drs-dot" />
            <circle cx={end.x} cy={end.y} r={2.5} className="minimap-drs-dot is-end" />
            <text x={start.x + 6} y={start.y - 8} className="minimap-drs-label">
              {zone.label ?? `DRS${index + 1}`}
            </text>
          </g>
        )
      })}
    </g>
  )
}

// ---------------------------------------------------------------------------
// Legacy trace-based rendering (fallback when no definition available)
// ---------------------------------------------------------------------------
function TraceLayers({ trace, drsZones, strategicLayers = [], focusRatio = null, pitZone = null, incidentZone = null, sectorStates }: Omit<Props, 'trackLookup'>) {
  const distanceCache = useMemo(() => buildPathDistanceCache(trace), [trace])
  const baseline = useMemo(() => trace.filter((_, i) => i % 2 === 0), [trace])
  const [s1, s2, s3] = useMemo(() => sectorByDistance(trace), [trace])

  const trackBodyPath = useMemo(() => buildRibbonPath(trace, { halfWidth: 8.2, smoothing: 'catmull-rom', samplesPerSegment: 4 }), [trace])
  const trackInnerPath = useMemo(() => buildRibbonPath(trace, { halfWidth: 5.3, smoothing: 'catmull-rom', samplesPerSegment: 4 }), [trace])
  const baselinePath = useMemo(() => buildPath(baseline, { smoothing: 'catmull-rom', samplesPerSegment: 3 }), [baseline])
  const s1Path = useMemo(() => buildPath(s1, { smoothing: 'catmull-rom', samplesPerSegment: 3 }), [s1])
  const s2Path = useMemo(() => buildPath(s2, { smoothing: 'catmull-rom', samplesPerSegment: 3 }), [s2])
  const s3Path = useMemo(() => buildPath(s3, { smoothing: 'catmull-rom', samplesPerSegment: 3 }), [s3])
  const focusPathPoints = useMemo(() => {
    if (focusRatio === null || !Number.isFinite(focusRatio)) return []
    return slicePathAroundRatio(trace, normalizeRatio(focusRatio), 0.05, 0.11, { cache: distanceCache })
  }, [trace, focusRatio, distanceCache])
  const focusPath = useMemo(() => buildPath(focusPathPoints, { smoothing: 'catmull-rom', samplesPerSegment: 4 }), [focusPathPoints])
  const pitPathPoints = useMemo(() => {
    if (!pitZone) return []
    return slicePathBetweenRatios(trace, pitZone.start_ratio, pitZone.end_ratio, { cache: distanceCache })
  }, [trace, pitZone, distanceCache])
  const pitPath = useMemo(() => buildPath(pitPathPoints, { smoothing: 'catmull-rom', samplesPerSegment: 4 }), [pitPathPoints])
  const pitLabelAnchor = useMemo(() => (pitZone ? pointAtRatio(trace, pitZone.start_ratio, distanceCache) : null), [trace, pitZone, distanceCache])
  const incidentPathPoints = useMemo(() => {
    if (!incidentZone) return []
    return slicePathBetweenRatios(trace, incidentZone.start_ratio, incidentZone.end_ratio, { cache: distanceCache })
  }, [trace, incidentZone, distanceCache])
  const incidentPath = useMemo(() => buildPath(incidentPathPoints, { smoothing: 'catmull-rom', samplesPerSegment: 4 }), [incidentPathPoints])
  const incidentLabelAnchor = useMemo(() => (incidentZone ? pointAtRatio(trace, incidentZone.start_ratio, distanceCache) : null), [trace, incidentZone, distanceCache])
  const startLine = useMemo(() => perpendicularLineAtRatio(trace, 0, 9, distanceCache), [trace, distanceCache])
  const referenceLines = useMemo(
    () =>
      [0.17, 0.5, 0.83]
        .map((ratio) => ({ ratio, points: perpendicularLineAtRatio(trace, ratio, 5.5, distanceCache) }))
        .filter((item): item is { ratio: number; points: [ScreenPoint, ScreenPoint] } => item.points !== null),
    [trace, distanceCache],
  )
  const startLabel = useMemo(() => pointAtRatio(trace, 0.012, distanceCache), [trace, distanceCache])
  const strategicLayerPaths = useMemo(
    () =>
      strategicLayers
        .map((layer) => ({
          layer,
          points: slicePathBetweenRatios(trace, layer.start_ratio, layer.end_ratio, { cache: distanceCache }),
        }))
        .map(({ layer, points }) => ({ layer, path: buildPath(points, { smoothing: 'catmull-rom', samplesPerSegment: 4 }), points }))
        .filter((entry) => !!entry.path),
    [strategicLayers, trace, distanceCache],
  )

  const sectorAnchors = [s1[0], s2[0], s3[0]]

  return (
    <g className="minimap-track-layers">
      {trackBodyPath ? <path d={trackBodyPath} className="minimap-track-body" /> : null}
      {trackInnerPath ? <path d={trackInnerPath} className="minimap-track-inner" /> : null}
      {baselinePath ? <path d={baselinePath} className="minimap-baseline" /> : null}
      {s1Path ? <path d={s1Path} className={`minimap-sector is-${sectorStates?.[0] ?? 'default'}`} /> : null}
      {s2Path ? <path d={s2Path} className={`minimap-sector is-${sectorStates?.[1] ?? 'default'}`} /> : null}
      {s3Path ? <path d={s3Path} className={`minimap-sector is-${sectorStates?.[2] ?? 'default'}`} /> : null}
      {pitPath ? <path d={pitPath} className="minimap-pit-window" /> : null}
      {incidentPath ? <path d={incidentPath} className={`minimap-incident-line is-${incidentZone?.severity ?? 'yellow'}`} /> : null}
      {focusPath ? <path d={focusPath} className="minimap-focus-window" /> : null}
      {strategicLayerPaths.map(({ layer, path }) => (
        <path key={layer.id} d={path} className={layer.className} />
      ))}

      {referenceLines.map(({ ratio, points }) => (
        <line
          key={`ref-${ratio.toFixed(2)}`}
          x1={points[0].x}
          y1={points[0].y}
          x2={points[1].x}
          y2={points[1].y}
          className="minimap-reference-line"
        />
      ))}

      {startLine ? (
        <line x1={startLine[0].x} y1={startLine[0].y} x2={startLine[1].x} y2={startLine[1].y} className="minimap-start-line" />
      ) : null}

      {startLabel ? (
        <text x={startLabel.x + 10} y={startLabel.y + 14} className="minimap-start-label">
          START
        </text>
      ) : null}

      {pitLabelAnchor && pitZone ? (
        <text x={pitLabelAnchor.x + 8} y={pitLabelAnchor.y + 12} className="minimap-pit-label">
          {pitZone.label}
        </text>
      ) : null}

      {incidentLabelAnchor && incidentZone ? (
        <text x={incidentLabelAnchor.x + 8} y={incidentLabelAnchor.y - 10} className={`minimap-incident-label is-${incidentZone.severity ?? 'yellow'}`}>
          {incidentZone.label}
        </text>
      ) : null}

      {sectorAnchors.map((anchor, index) =>
        anchor ? (
          <text key={`sector-${index + 1}`} x={anchor.x + 6} y={anchor.y - 6} className="minimap-sector-label">
            S{index + 1}
          </text>
        ) : null,
      )}

      {drsZones.map((zone, index) => {
        const start = pointAtRatio(trace, zone.start_ratio, distanceCache)
        const end = pointAtRatio(trace, zone.end_ratio, distanceCache)
        const detect = pointAtRatio(trace, zone.detection_ratio ?? normalizeRatio(zone.start_ratio - 0.05), distanceCache)
        if (!start || !end) return null
        const drsPathPoints = slicePathBetweenRatios(trace, zone.start_ratio, zone.end_ratio, { cache: distanceCache })
        const drsPath = buildPath(drsPathPoints, { smoothing: 'catmull-rom', samplesPerSegment: 4 })
        return (
          <g key={`${zone.label ?? 'drs'}-${index}`}>
            {drsPath ? <path d={drsPath} className={`minimap-drs-line ${zone.is_active ? 'is-active' : ''}`} /> : null}
            {detect ? <circle cx={detect.x} cy={detect.y} r={2.5} className="minimap-drs-dot is-detect" /> : null}
            <circle cx={start.x} cy={start.y} r={3.6} className="minimap-drs-dot" />
            <circle cx={end.x} cy={end.y} r={2.5} className="minimap-drs-dot is-end" />
            <text x={start.x + 6} y={start.y - 8} className="minimap-drs-label">
              {zone.label ?? `DRS${index + 1}`}
            </text>
          </g>
        )
      })}
    </g>
  )
}

// ---------------------------------------------------------------------------
// Exported component — switches between definition and trace rendering
// ---------------------------------------------------------------------------
function LayerComponent({ trace, drsZones, strategicLayers, focusRatio, pitZone, incidentZone, sectorStates, trackLookup }: Props) {
  if (trackLookup && trackLookup.spline.length > 0) {
    return (
      <DefinitionLayers
        trackLookup={trackLookup}
        drsZones={drsZones}
        strategicLayers={strategicLayers}
        focusRatio={focusRatio}
        pitZone={pitZone}
        incidentZone={incidentZone}
        sectorStates={sectorStates}
      />
    )
  }

  return (
    <TraceLayers
      trace={trace}
      drsZones={drsZones}
      strategicLayers={strategicLayers}
      focusRatio={focusRatio}
      pitZone={pitZone}
      incidentZone={incidentZone}
      sectorStates={sectorStates}
    />
  )
}

export const TrackLayers = memo(LayerComponent)
