/**
 * Track Projection — snap UDP world-coordinates onto a track definition.
 *
 * This module bridges the gap between "raw world data from UDP" and
 * "accurate positions on the circuit".  It samples the SVG definition
 * path into an evenly-spaced spline, then provides O(1)~O(log n)
 * nearest-point queries via a spatial grid index.
 *
 * Core workflow:
 *   1. `buildTrackLookup(definition)` — one-time setup per circuit
 *   2. `pointOnTrackByRatio(lookup, ratio)` — place a car on the track
 *   3. `snapToTrack(screenPt, lookup)` — find closest spline point
 *   4. `sliceTrackBetween(lookup, r0, r1)` — extract a section
 */

import type { TrackDefinition, TrackLookup, TrackSplinePoint } from './trackDefinition'
import type { ScreenPoint } from './minimapProjection'

// ---------------------------------------------------------------------------
// SVG path sampling via browser API
// ---------------------------------------------------------------------------

/** Invisible SVG element used for path length queries. Created lazily. */
let _svgNS: SVGSVGElement | null = null
let _pathEl: SVGPathElement | null = null

function ensureSVGElements(): { svg: SVGSVGElement; path: SVGPathElement } {
  if (!_svgNS) {
    _svgNS = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    _svgNS.setAttribute('width', '0')
    _svgNS.setAttribute('height', '0')
    _svgNS.style.position = 'absolute'
    _svgNS.style.visibility = 'hidden'
    _svgNS.style.pointerEvents = 'none'
    document.body.appendChild(_svgNS)
  }
  if (!_pathEl) {
    _pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    _svgNS.appendChild(_pathEl)
  }
  return { svg: _svgNS, path: _pathEl }
}

/**
 * Sample an SVG path `d` string at *numSamples* evenly-spaced arc-length
 * intervals.  Returns a spline with ratio + cumulative distance metadata.
 */
export function sampleSvgPath(d: string, numSamples = 1000): TrackSplinePoint[] {
  const { path } = ensureSVGElements()
  path.setAttribute('d', d)
  const totalLen = path.getTotalLength()
  if (totalLen <= 0 || numSamples < 2) return []

  const points: TrackSplinePoint[] = []
  for (let i = 0; i <= numSamples; i++) {
    const dist = (i / numSamples) * totalLen
    const pt = path.getPointAtLength(dist)
    points.push({ x: pt.x, y: pt.y, ratio: i / numSamples, dist })
  }
  return points
}

// ---------------------------------------------------------------------------
// Spatial grid index for O(1) nearest-point queries
// ---------------------------------------------------------------------------

type SpatialGrid = {
  cells: Map<number, number[]>
  cellSize: number
  offsetX: number
  offsetY: number
  cols: number
}

function buildGrid(spline: TrackSplinePoint[], bounds: TrackLookup['bounds']): SpatialGrid {
  const rangeX = bounds.maxX - bounds.minX || 1
  const rangeY = bounds.maxY - bounds.minY || 1
  const maxRange = Math.max(rangeX, rangeY)
  // ~20×20 grid → around 400 cells.  Good balance for 500-1000 points.
  const gridDivisions = 20
  const cellSize = maxRange / gridDivisions + 0.001

  const cells = new Map<number, number[]>()
  const cols = Math.ceil(rangeX / cellSize) + 1

  for (let i = 0; i < spline.length; i++) {
    const cx = Math.floor((spline[i].x - bounds.minX) / cellSize)
    const cy = Math.floor((spline[i].y - bounds.minY) / cellSize)
    const key = cy * cols + cx
    const bucket = cells.get(key)
    if (bucket) bucket.push(i)
    else cells.set(key, [i])
  }

  return { cells, cellSize, offsetX: bounds.minX, offsetY: bounds.minY, cols }
}

function queryGrid(grid: SpatialGrid, x: number, y: number, spline: TrackSplinePoint[], radius = 1): number {
  const cx = Math.floor((x - grid.offsetX) / grid.cellSize)
  const cy = Math.floor((y - grid.offsetY) / grid.cellSize)

  let bestIdx = 0
  let bestDist = Infinity

  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const key = (cy + dy) * grid.cols + (cx + dx)
      const bucket = grid.cells.get(key)
      if (!bucket) continue
      for (const idx of bucket) {
        const d = (spline[idx].x - x) ** 2 + (spline[idx].y - y) ** 2
        if (d < bestDist) {
          bestDist = d
          bestIdx = idx
        }
      }
    }
  }

  return bestIdx
}

// ---------------------------------------------------------------------------
// TrackLookup builder
// ---------------------------------------------------------------------------

const _lookupCache = new Map<string, TrackLookup>()

/**
 * Build (or retrieve from cache) the full lookup structure for a definition.
 * The heavy work is SVG path sampling and spatial index construction.
 */
export function buildTrackLookup(def: TrackDefinition, numSamples = 1000): TrackLookup {
  const cached = _lookupCache.get(def.id)
  if (cached) return cached

  const spline = sampleSvgPath(def.svgPath, numSamples)

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const pt of spline) {
    if (pt.x < minX) minX = pt.x
    if (pt.x > maxX) maxX = pt.x
    if (pt.y < minY) minY = pt.y
    if (pt.y > maxY) maxY = pt.y
  }

  const bounds = { minX, maxX, minY, maxY }
  const totalLength = spline.length > 0 ? spline[spline.length - 1].dist : 0

  const lookup: TrackLookup = { definition: def, spline, totalLength, bounds }

  // Attach the spatial grid as a non-enumerable property for internal use
  Object.defineProperty(lookup, '_grid', {
    value: buildGrid(spline, bounds),
    enumerable: false,
  })

  _lookupCache.set(def.id, lookup)
  return lookup
}

/** Clear the lookup cache (useful for tests or hot-reload). */
export function clearTrackLookupCache(): void {
  _lookupCache.clear()
}

// ---------------------------------------------------------------------------
// Query functions
// ---------------------------------------------------------------------------

/**
 * Get the screen-space point on the track at a given ratio (0-1).
 * Uses linear interpolation between the two nearest spline samples.
 */
export function pointOnTrackByRatio(lookup: TrackLookup, ratio: number): ScreenPoint {
  const { spline } = lookup
  if (spline.length === 0) return { x: 0, y: 0 }

  const r = Math.max(0, Math.min(1, ratio))
  const idx = r * (spline.length - 1)
  const lo = Math.floor(idx)
  const hi = Math.min(lo + 1, spline.length - 1)
  const t = idx - lo
  return {
    x: spline[lo].x + (spline[hi].x - spline[lo].x) * t,
    y: spline[lo].y + (spline[hi].y - spline[lo].y) * t,
  }
}

/**
 * Get the tangent direction (unit vector) on the track at a given ratio.
 */
export function tangentOnTrack(lookup: TrackLookup, ratio: number): ScreenPoint {
  const { spline } = lookup
  if (spline.length < 2) return { x: 1, y: 0 }

  const r = Math.max(0, Math.min(1, ratio))
  const idx = Math.round(r * (spline.length - 1))
  const prev = spline[Math.max(0, idx - 1)]
  const next = spline[Math.min(spline.length - 1, idx + 1)]
  const dx = next.x - prev.x
  const dy = next.y - prev.y
  const len = Math.hypot(dx, dy)
  if (len < 1e-9) return { x: 1, y: 0 }
  return { x: dx / len, y: dy / len }
}

/**
 * Snap a screen-space point to the nearest point on the track spline.
 * Returns the ratio (0-1) and the snapped position.
 */
export function snapToTrack(
  point: ScreenPoint,
  lookup: TrackLookup,
): { ratio: number; snapped: ScreenPoint; distance: number } {
  const { spline } = lookup
  if (spline.length === 0) return { ratio: 0, snapped: { x: 0, y: 0 }, distance: Infinity }

  const grid = (lookup as unknown as { _grid: SpatialGrid })._grid
  let bestIdx: number

  if (grid) {
    // Grid lookup with fallback to wider search
    bestIdx = queryGrid(grid, point.x, point.y, spline, 1)
    const d0 = (spline[bestIdx].x - point.x) ** 2 + (spline[bestIdx].y - point.y) ** 2
    // If the closest grid point is suspiciously far, try wider radius
    if (d0 > (grid.cellSize * 2) ** 2) {
      bestIdx = queryGrid(grid, point.x, point.y, spline, 3)
    }
  } else {
    // Brute-force fallback
    bestIdx = 0
    let bestDist = Infinity
    for (let i = 0; i < spline.length; i++) {
      const d = (spline[i].x - point.x) ** 2 + (spline[i].y - point.y) ** 2
      if (d < bestDist) {
        bestDist = d
        bestIdx = i
      }
    }
  }

  const best = spline[bestIdx]
  return {
    ratio: best.ratio,
    snapped: { x: best.x, y: best.y },
    distance: Math.hypot(best.x - point.x, best.y - point.y),
  }
}

/**
 * Slice the track spline between two ratios.
 * Handles wrap-around (end < start → crosses start/finish).
 */
export function sliceTrackBetween(
  lookup: TrackLookup,
  startRatio: number,
  endRatio: number,
): ScreenPoint[] {
  const { spline } = lookup
  if (spline.length === 0) return []

  const s = Math.max(0, Math.min(1, startRatio))
  const e = Math.max(0, Math.min(1, endRatio))

  const sIdx = Math.round(s * (spline.length - 1))
  const eIdx = Math.round(e * (spline.length - 1))

  const points: ScreenPoint[] = []
  if (s <= e) {
    for (let i = sIdx; i <= eIdx; i++) {
      points.push({ x: spline[i].x, y: spline[i].y })
    }
  } else {
    // Wrap around start/finish
    for (let i = sIdx; i < spline.length; i++) {
      points.push({ x: spline[i].x, y: spline[i].y })
    }
    for (let i = 0; i <= eIdx; i++) {
      points.push({ x: spline[i].x, y: spline[i].y })
    }
  }

  return points
}

/**
 * Build a full SVG `d` string for the track path from the spline.
 * This replaces the old `buildRibbonPath(trace)` which depended on UDP trace.
 */
export function buildTrackPathD(lookup: TrackLookup): string {
  const { spline } = lookup
  if (spline.length < 2) return ''
  return spline.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x.toFixed(2)} ${pt.y.toFixed(2)}`).join(' ') + ' Z'
}

/**
 * Build a ribbon (filled outline) path around the track centre-line.
 */
export function buildTrackRibbonD(lookup: TrackLookup, halfWidth: number): string {
  const { spline } = lookup
  if (spline.length < 3 || halfWidth <= 0) return ''

  const left: ScreenPoint[] = []
  const right: ScreenPoint[] = []

  for (let i = 0; i < spline.length; i++) {
    const prev = spline[Math.max(0, i - 1)]
    const next = spline[Math.min(spline.length - 1, i + 1)]
    const dx = next.x - prev.x
    const dy = next.y - prev.y
    const len = Math.hypot(dx, dy) || 1
    // Normal = perpendicular to tangent
    const nx = -dy / len
    const ny = dx / len

    left.push({ x: spline[i].x + nx * halfWidth, y: spline[i].y + ny * halfWidth })
    right.push({ x: spline[i].x - nx * halfWidth, y: spline[i].y - ny * halfWidth })
  }

  const ring = [...left, ...right.reverse()]
  return ring.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x.toFixed(2)} ${pt.y.toFixed(2)}`).join(' ') + ' Z'
}

/**
 * Build the SVG path `d` string for a slice (DRS zone, pit lane, sector, etc.).
 */
export function buildSlicePathD(lookup: TrackLookup, startRatio: number, endRatio: number): string {
  const pts = sliceTrackBetween(lookup, startRatio, endRatio)
  if (pts.length < 2) return ''
  return pts.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x.toFixed(2)} ${pt.y.toFixed(2)}`).join(' ')
}

/**
 * Create a projector-like transform that maps the track's SVG viewBox
 * coordinates to the minimap's SVG viewport (e.g., 0-520 × 0-320).
 *
 * Returns a function that converts a TrackSplinePoint to a ScreenPoint
 * in the minimap coordinate system.
 */
export function createTrackToMinimapTransform(
  lookup: TrackLookup,
  viewW: number,
  viewH: number,
  padding: number,
): (pt: { x: number; y: number }) => ScreenPoint {
  const { bounds } = lookup
  const spanX = bounds.maxX - bounds.minX || 1
  const spanY = bounds.maxY - bounds.minY || 1
  const usableW = viewW - padding * 2
  const usableH = viewH - padding * 2
  // Single scale to keep aspect ratio (no distortion)
  const scale = Math.min(usableW / spanX, usableH / spanY)
  const ox = padding + (usableW - spanX * scale) / 2
  const oy = padding + (usableH - spanY * scale) / 2

  return (pt) => ({
    x: ox + (pt.x - bounds.minX) * scale,
    y: oy + (pt.y - bounds.minY) * scale,
  })
}

/**
 * Build a TrackLookup that's been projected into the minimap viewport.
 * All spline points and bounds are in minimap screen-space.
 */
export function buildProjectedLookup(
  def: TrackDefinition,
  viewW: number,
  viewH: number,
  padding: number,
  numSamples = 1000,
): TrackLookup {
  const cacheKey = `${def.id}_${viewW}_${viewH}_${padding}`
  const cached = _lookupCache.get(cacheKey)
  if (cached) return cached

  const raw = buildTrackLookup(def, numSamples)
  const txfn = createTrackToMinimapTransform(raw, viewW, viewH, padding)

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  const projSpline: TrackSplinePoint[] = raw.spline.map((pt) => {
    const s = txfn(pt)
    if (s.x < minX) minX = s.x
    if (s.x > maxX) maxX = s.x
    if (s.y < minY) minY = s.y
    if (s.y > maxY) maxY = s.y
    return { x: s.x, y: s.y, ratio: pt.ratio, dist: pt.dist }
  })

  const lookup: TrackLookup = {
    definition: def,
    spline: projSpline,
    totalLength: raw.totalLength,
    bounds: { minX, maxX, minY, maxY },
  }

  Object.defineProperty(lookup, '_grid', {
    value: buildGrid(projSpline, lookup.bounds),
    enumerable: false,
  })

  _lookupCache.set(cacheKey, lookup)
  return lookup
}
