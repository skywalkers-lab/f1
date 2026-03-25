export type WorldPoint = { x: number; z: number }
export type ScreenPoint = { x: number; y: number }

export type MinimapTransform = {
  min_x: number
  max_x: number
  min_z: number
  max_z: number
}

export type ProjectorFocus = {
  world: WorldPoint
  strength?: number
  padding?: number
}

export type ProjectorViewState = {
  zoom?: number
  panX?: number
  panY?: number
  focus?: ProjectorFocus | null
}

export type Projector = {
  width: number
  height: number
  padding: number
  scale: number
  offsetX: number
  offsetY: number
  getViewState: () => Required<ProjectorViewState>
  updateViewState: (next: Partial<ProjectorViewState>) => void
  toScreen: (point: WorldPoint) => ScreenPoint
  toWorld: (point: ScreenPoint) => WorldPoint
  projectPath: (points: WorldPoint[]) => ScreenPoint[]
}

export type DRSZone = {
  start_ratio: number
  end_ratio: number
  label?: string
  detection_ratio?: number
  activation_ratio?: number
  is_active?: boolean
  enabled_when?: 'always' | 'race' | 'green'
}

export type TrackWindow = {
  start_ratio: number
  end_ratio: number
}

export type PathDistanceCache = {
  readonly points: ScreenPoint[]
  readonly cumulative: number[]
  readonly segmentLengths: number[]
  readonly totalLength: number
}

export type PathBuildOptions = {
  smoothing?: 'linear' | 'catmull-rom'
  samplesPerSegment?: number
}

export type RibbonBuildOptions = PathBuildOptions & {
  halfWidth: number
  minHalfWidth?: number
  maxHalfWidth?: number
  curvatureInfluence?: number
  speedInfluence?: number
  speedProfile?: (ratio: number) => number | null | undefined
}

export type SlicePathOptions = {
  cache?: PathDistanceCache
  includeCaps?: boolean
}

export type TrackVisualLayer = {
  id: string
  start_ratio: number
  end_ratio: number
  className: string
  label?: string
  severity?: 'info' | 'warning' | 'critical'
}

export type StrategicLayerInput = {
  playerRatio?: number | null
  rivalGapRatios?: number[]
  undercutWindow?: TrackWindow | null
  tyreRiskWindows?: TrackWindow[]
  safetyCarState?: 'green' | 'vsc' | 'sc'
}

function isFiniteNumber(value: number): boolean {
  return Number.isFinite(value)
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function clamp01(value: number): number {
  return clamp(value, 0, 1)
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function lerpPoint(a: ScreenPoint, b: ScreenPoint, t: number): ScreenPoint {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) }
}

export function vectorLength(v: ScreenPoint): number {
  return Math.hypot(v.x, v.y)
}

export function normalizeVector(v: ScreenPoint): ScreenPoint | null {
  const len = vectorLength(v)
  if (!len) return null
  return { x: v.x / len, y: v.y / len }
}

export function perpendicularVector(v: ScreenPoint): ScreenPoint {
  return { x: -v.y, y: v.x }
}

export function isValidTransform(transform: MinimapTransform): boolean {
  if (!isFiniteNumber(transform.min_x) || !isFiniteNumber(transform.max_x) || !isFiniteNumber(transform.min_z) || !isFiniteNumber(transform.max_z)) {
    return false
  }
  return transform.max_x > transform.min_x && transform.max_z > transform.min_z
}

export function sanitizeWorldPoint(raw: { x: number; y: number }): WorldPoint | null {
  if (!isFiniteNumber(raw.x) || !isFiniteNumber(raw.y)) return null
  return { x: raw.x, z: raw.y }
}

export function createProjector(
  width: number,
  height: number,
  padding: number,
  transform: MinimapTransform,
  initialView: Partial<ProjectorViewState> = {},
): Projector | null {
  if (!isFiniteNumber(width) || !isFiniteNumber(height) || !isFiniteNumber(padding)) return null
  if (width <= 0 || height <= 0) return null
  if (!isValidTransform(transform)) return null

  const spanX = transform.max_x - transform.min_x
  const spanZ = transform.max_z - transform.min_z
  const viewState: Required<ProjectorViewState> = {
    zoom: clamp(initialView.zoom ?? 1, 0.2, 20),
    panX: initialView.panX ?? 0,
    panY: initialView.panY ?? 0,
    focus: initialView.focus ?? null,
  }

  let cachedScale = 1
  let cachedOffsetX = 0
  let cachedOffsetY = 0
  let dirty = true

  function recomputeProjection() {
    const focusPadding = Math.max(0, viewState.focus?.padding ?? 0)
    const effectivePadding = padding + focusPadding
    const usableWidth = Math.max(1, width - effectivePadding * 2)
    const usableHeight = Math.max(1, height - effectivePadding * 2)

    // Keep a single scale value for both axes so track geometry is not distorted.
    const baseScale = Math.min(usableWidth / spanX, usableHeight / spanZ)
    const focusBoost = 1 + clamp(viewState.focus?.strength ?? 0, 0, 1.5) * 0.65
    cachedScale = baseScale * viewState.zoom * focusBoost

    const centerX = width / 2
    const centerY = height / 2
    const focusX = viewState.focus?.world.x ?? (transform.min_x + transform.max_x) / 2
    const focusZ = viewState.focus?.world.z ?? (transform.min_z + transform.max_z) / 2

    cachedOffsetX = centerX - (focusX - transform.min_x) * cachedScale + viewState.panX
    cachedOffsetY = centerY - (focusZ - transform.min_z) * cachedScale - viewState.panY
    dirty = false
  }

  function ensureProjection() {
    if (dirty) recomputeProjection()
  }

  function toScreen(point: WorldPoint): ScreenPoint {
    ensureProjection()
    const px = cachedOffsetX + (point.x - transform.min_x) * cachedScale
    const py = height - (cachedOffsetY + (point.z - transform.min_z) * cachedScale)
    return { x: px, y: py }
  }

  function toWorld(point: ScreenPoint): WorldPoint {
    ensureProjection()
    const worldX = (point.x - cachedOffsetX) / cachedScale + transform.min_x
    const screenFromTop = height - point.y
    const worldZ = (screenFromTop - cachedOffsetY) / cachedScale + transform.min_z
    return { x: worldX, z: worldZ }
  }

  function getViewState(): Required<ProjectorViewState> {
    return {
      zoom: viewState.zoom,
      panX: viewState.panX,
      panY: viewState.panY,
      focus: viewState.focus,
    }
  }

  function updateViewState(next: Partial<ProjectorViewState>) {
    if (isFiniteNumber(next.zoom as number)) viewState.zoom = clamp(next.zoom as number, 0.2, 20)
    if (isFiniteNumber(next.panX as number)) viewState.panX = Number(next.panX)
    if (isFiniteNumber(next.panY as number)) viewState.panY = Number(next.panY)
    if (next.focus !== undefined) viewState.focus = next.focus ?? null
    dirty = true
  }

  function projectPath(points: WorldPoint[]): ScreenPoint[] {
    return points.map((point) => toScreen(point))
  }

  recomputeProjection()

  return {
    width,
    height,
    padding,
    get scale() {
      ensureProjection()
      return cachedScale
    },
    get offsetX() {
      ensureProjection()
      return cachedOffsetX
    },
    get offsetY() {
      ensureProjection()
      return cachedOffsetY
    },
    getViewState,
    updateViewState,
    toScreen,
    toWorld,
    projectPath,
  }
}

function sampleSpline(points: ScreenPoint[], options: PathBuildOptions): ScreenPoint[] {
  if (points.length < 3 || options.smoothing !== 'catmull-rom') return points
  const samplesPerSegment = clamp(Math.round(options.samplesPerSegment ?? 5), 2, 24)
  const out: ScreenPoint[] = []

  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[Math.max(0, i - 1)]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[Math.min(points.length - 1, i + 2)]

    for (let step = 0; step < samplesPerSegment; step += 1) {
      const t = step / samplesPerSegment
      const t2 = t * t
      const t3 = t2 * t

      const x =
        0.5 *
        ((2 * p1.x) +
          (-p0.x + p2.x) * t +
          (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
          (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3)
      const y =
        0.5 *
        ((2 * p1.y) +
          (-p0.y + p2.y) * t +
          (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
          (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3)

      out.push({ x, y })
    }
  }

  out.push(points[points.length - 1])
  return out
}

function pathString(points: ScreenPoint[]): string {
  if (points.length < 2) return ''
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ')
}

export function buildPath(points: ScreenPoint[], options: PathBuildOptions = {}): string {
  if (points.length < 2) return ''
  const sampled = sampleSpline(points, options)
  return pathString(sampled)
}

const PATH_DISTANCE_CACHE = new WeakMap<ScreenPoint[], PathDistanceCache>()

export function buildPathDistanceCache(points: ScreenPoint[]): PathDistanceCache {
  const fromMemo = PATH_DISTANCE_CACHE.get(points)
  if (fromMemo) return fromMemo

  if (points.length === 0) {
    const empty = { points, cumulative: [], segmentLengths: [], totalLength: 0 }
    PATH_DISTANCE_CACHE.set(points, empty)
    return empty
  }

  const cumulative: number[] = [0]
  const segmentLengths: number[] = []

  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]
    const b = points[i]
    const d = Math.hypot(b.x - a.x, b.y - a.y)
    segmentLengths.push(d)
    cumulative.push(cumulative[i - 1] + d)
  }

  const cache = {
    points,
    cumulative,
    segmentLengths,
    totalLength: cumulative[cumulative.length - 1] ?? 0,
  }
  PATH_DISTANCE_CACHE.set(points, cache)
  return cache
}

function cacheOrBuild(points: ScreenPoint[], cache?: PathDistanceCache): PathDistanceCache {
  if (cache && cache.points === points) return cache
  return buildPathDistanceCache(points)
}

function findSegmentIndex(cumulative: number[], targetDistance: number): number {
  let lo = 1
  let hi = cumulative.length - 1
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2)
    if (cumulative[mid] < targetDistance) lo = mid + 1
    else hi = mid
  }
  return lo
}

export function pointAtDistance(points: ScreenPoint[], distance: number, cache?: PathDistanceCache): ScreenPoint | null {
  if (points.length === 0) return null
  if (points.length === 1) return points[0]

  const activeCache = cacheOrBuild(points, cache)
  if (activeCache.totalLength <= 0) return points[0]

  const target = clamp(distance, 0, activeCache.totalLength)
  const segmentIndex = findSegmentIndex(activeCache.cumulative, target)

  const a = points[segmentIndex - 1]
  const b = points[segmentIndex]
  const start = activeCache.cumulative[segmentIndex - 1]
  const span = activeCache.cumulative[segmentIndex] - start || 1
  const t = (target - start) / span
  return lerpPoint(a, b, t)
}

export function curvatureAtRatio(points: ScreenPoint[], ratio: number, cache?: PathDistanceCache): number {
  const tangent = tangentAtRatio(points, ratio, cache)
  if (!tangent) return 0

  const activeCache = cacheOrBuild(points, cache)
  if (activeCache.totalLength <= 0) return 0

  const deltaRatio = clamp(14 / Math.max(1, activeCache.totalLength), 0.001, 0.04)
  const before = tangentAtRatio(points, clamp01(ratio - deltaRatio), activeCache)
  const after = tangentAtRatio(points, clamp01(ratio + deltaRatio), activeCache)
  if (!before || !after) return 0

  const dot = clamp(before.x * after.x + before.y * after.y, -1, 1)
  const angle = Math.acos(dot)
  const arcLength = activeCache.totalLength * (deltaRatio * 2)
  return arcLength > 0 ? angle / arcLength : 0
}

export function buildRibbonPath(points: ScreenPoint[], halfWidthOrOptions: number | RibbonBuildOptions): string {
  const options: RibbonBuildOptions =
    typeof halfWidthOrOptions === 'number'
      ? { halfWidth: halfWidthOrOptions }
      : halfWidthOrOptions

  if (points.length < 2 || !isFiniteNumber(options.halfWidth) || options.halfWidth <= 0) return ''

  const sampled = sampleSpline(points, options)
  if (sampled.length < 2) return ''

  const cache = buildPathDistanceCache(sampled)

  const left: ScreenPoint[] = []
  const right: ScreenPoint[] = []
  const minHalfWidth = Math.max(0.5, options.minHalfWidth ?? options.halfWidth * 0.65)
  const maxHalfWidth = Math.max(minHalfWidth, options.maxHalfWidth ?? options.halfWidth * 1.6)
  const curvatureInfluence = options.curvatureInfluence ?? 16
  const speedInfluence = options.speedInfluence ?? 0.14

  function resolveHalfWidth(ratio: number): number {
    const kappa = curvatureAtRatio(sampled, ratio, cache)
    const speed = options.speedProfile?.(ratio)
    const speedFactor = speed && speed > 0 ? clamp(1 - (speed / 360) * speedInfluence, 0.72, 1.12) : 1
    const curvatureFactor = clamp(1 + kappa * curvatureInfluence, 0.75, 1.85)
    return clamp(options.halfWidth * speedFactor * curvatureFactor, minHalfWidth, maxHalfWidth)
  }

  for (let i = 0; i < sampled.length; i += 1) {
    const prev = sampled[Math.max(0, i - 1)]
    const next = sampled[Math.min(sampled.length - 1, i + 1)]
    const dx = next.x - prev.x
    const dy = next.y - prev.y
    const tangent = normalizeVector({ x: dx, y: dy }) ?? { x: 1, y: 0 }
    const normal = perpendicularVector(tangent)
    const ratio = sampled.length <= 1 ? 0 : i / (sampled.length - 1)
    const halfWidth = resolveHalfWidth(ratio)

    left.push({ x: sampled[i].x + normal.x * halfWidth, y: sampled[i].y + normal.y * halfWidth })
    right.push({ x: sampled[i].x - normal.x * halfWidth, y: sampled[i].y - normal.y * halfWidth })
  }

  const ring = [...left, ...right.reverse()]
  return `${pathString(ring)} Z`
}

export function cumulativeDistances(points: ScreenPoint[]): number[] {
  return buildPathDistanceCache(points).cumulative
}

export function sectorByDistance(points: ScreenPoint[]): [ScreenPoint[], ScreenPoint[], ScreenPoint[]] {
  if (points.length < 3) return [points, [], []]
  return [
    slicePathBetweenRatios(points, 0, 1 / 3),
    slicePathBetweenRatios(points, 1 / 3, 2 / 3),
    slicePathBetweenRatios(points, 2 / 3, 1),
  ]
}

export function pointAtRatio(points: ScreenPoint[], ratio: number, cache?: PathDistanceCache): ScreenPoint | null {
  if (points.length === 0) return null
  if (points.length === 1) return points[0]

  const activeCache = cacheOrBuild(points, cache)
  if (activeCache.totalLength <= 0) return points[0]
  const bounded = clamp01(ratio)
  return pointAtDistance(points, activeCache.totalLength * bounded, activeCache)
}

export function tangentAtRatio(points: ScreenPoint[], ratio: number, cache?: PathDistanceCache): ScreenPoint | null {
  if (points.length < 2) return null
  const activeCache = cacheOrBuild(points, cache)
  if (activeCache.totalLength <= 0) return null

  const target = clamp01(ratio) * activeCache.totalLength
  let segmentIndex = findSegmentIndex(activeCache.cumulative, target)
  segmentIndex = clamp(segmentIndex, 1, points.length - 1)

  // Prefer a non-degenerate segment around the target point for stable UI rotation.
  let leftIndex = segmentIndex - 1
  let rightIndex = segmentIndex
  while (rightIndex < points.length && leftIndex >= 0) {
    const dx = points[rightIndex].x - points[leftIndex].x
    const dy = points[rightIndex].y - points[leftIndex].y
    const norm = normalizeVector({ x: dx, y: dy })
    if (norm) return norm

    if (leftIndex > 0) leftIndex -= 1
    else if (rightIndex < points.length - 1) rightIndex += 1
    else break
  }

  return null
}

export function perpendicularLineAtRatio(
  points: ScreenPoint[],
  ratio: number,
  halfLength: number,
  cache?: PathDistanceCache,
): [ScreenPoint, ScreenPoint] | null {
  if (!isFiniteNumber(halfLength) || halfLength <= 0) return null

  const center = pointAtRatio(points, ratio, cache)
  const tangent = tangentAtRatio(points, ratio, cache)
  if (!center || !tangent) return null

  const normal = perpendicularVector(tangent)

  return [
    { x: center.x + normal.x * halfLength, y: center.y + normal.y * halfLength },
    { x: center.x - normal.x * halfLength, y: center.y - normal.y * halfLength },
  ]
}

export function normalizeRatio(ratio: number): number {
  if (!isFiniteNumber(ratio)) return 0
  const wrapped = ratio % 1
  return wrapped < 0 ? wrapped + 1 : wrapped
}

function sliceDistanceWindow(points: ScreenPoint[], fromDistance: number, toDistance: number, cache: PathDistanceCache, includeCaps: boolean): ScreenPoint[] {
  if (points.length < 2 || toDistance < fromDistance) return []

  const out: ScreenPoint[] = []
  if (includeCaps) {
    const startPoint = pointAtDistance(points, fromDistance, cache)
    if (startPoint) out.push(startPoint)
  }

  const first = findSegmentIndex(cache.cumulative, fromDistance)
  const last = findSegmentIndex(cache.cumulative, toDistance)
  for (let i = first; i <= last; i += 1) {
    if (i >= 0 && i < points.length) out.push(points[i])
  }

  if (includeCaps) {
    const endPoint = pointAtDistance(points, toDistance, cache)
    if (endPoint) out.push(endPoint)
  }

  if (out.length < 2) {
    const a = pointAtDistance(points, fromDistance, cache)
    const b = pointAtDistance(points, toDistance, cache)
    if (a && b) return [a, b]
  }

  return out
}

export function slicePathBetweenRatios(
  points: ScreenPoint[],
  startRatio: number,
  endRatio: number,
  options: SlicePathOptions = {},
): ScreenPoint[] {
  if (points.length < 2) return []
  const cache = cacheOrBuild(points, options.cache)
  if (cache.totalLength <= 0) return []

  const includeCaps = options.includeCaps ?? true
  const start = clamp01(startRatio)
  const end = clamp01(endRatio)

  if (start <= end) {
    return sliceDistanceWindow(points, start * cache.totalLength, end * cache.totalLength, cache, includeCaps)
  }

  // Wrapped zone (e.g. 0.95 -> 0.05) crosses start/finish line.
  const a = sliceDistanceWindow(points, start * cache.totalLength, cache.totalLength, cache, includeCaps)
  const b = sliceDistanceWindow(points, 0, end * cache.totalLength, cache, includeCaps)
  if (a.length > 0 && b.length > 0) {
    const tail = a[a.length - 1]
    const head = b[0]
    if (Math.hypot(tail.x - head.x, tail.y - head.y) < 1e-6) {
      b.shift()
    }
  }
  return [...a, ...b]
}

export function slicePathAroundRatio(
  points: ScreenPoint[],
  centerRatio: number,
  beforeSpan: number,
  afterSpan: number,
  options: SlicePathOptions = {},
): ScreenPoint[] {
  if (points.length < 2) return []

  const center = normalizeRatio(centerRatio)
  const start = normalizeRatio(center - Math.max(0, beforeSpan))
  const end = normalizeRatio(center + Math.max(0, afterSpan))

  if (center - beforeSpan >= 0 && center + afterSpan <= 1) {
    return slicePathBetweenRatios(points, start, end, options)
  }

  return slicePathBetweenRatios(points, start, end, options)
}

export function buildStrategicLayers(input: StrategicLayerInput): TrackVisualLayer[] {
  const layers: TrackVisualLayer[] = []
  const playerRatio = input.playerRatio

  if (playerRatio !== null && playerRatio !== undefined && isFiniteNumber(playerRatio)) {
    const start = normalizeRatio(playerRatio - 0.03)
    const end = normalizeRatio(playerRatio + 0.06)
    layers.push({
      id: 'player-focus',
      start_ratio: start,
      end_ratio: end,
      className: 'minimap-focus-window',
      label: 'PLAYER',
      severity: 'info',
    })
  }

  if (input.undercutWindow) {
    layers.push({
      id: 'undercut-window',
      start_ratio: clamp01(input.undercutWindow.start_ratio),
      end_ratio: clamp01(input.undercutWindow.end_ratio),
      className: 'minimap-strategy-undercut',
      label: 'UNDERCUT',
      severity: 'warning',
    })
  }

  input.tyreRiskWindows?.forEach((window, index) => {
    layers.push({
      id: `tyre-risk-${index}`,
      start_ratio: clamp01(window.start_ratio),
      end_ratio: clamp01(window.end_ratio),
      className: 'minimap-risk-tyre',
      label: 'TYRE RISK',
      severity: 'critical',
    })
  })

  if (input.safetyCarState === 'vsc' || input.safetyCarState === 'sc') {
    layers.push({
      id: `neutralized-${input.safetyCarState}`,
      start_ratio: 0,
      end_ratio: 1,
      className: 'minimap-risk-neutralized',
      label: input.safetyCarState.toUpperCase(),
      severity: 'warning',
    })
  }

  if (input.rivalGapRatios && input.rivalGapRatios.length > 0 && playerRatio !== null && playerRatio !== undefined) {
    const nearest = input.rivalGapRatios.reduce((best, value) => (Math.abs(value) < Math.abs(best) ? value : best), input.rivalGapRatios[0])
    if (isFiniteNumber(nearest)) {
      const anchor = normalizeRatio(playerRatio + nearest)
      layers.push({
        id: 'battle-window',
        start_ratio: normalizeRatio(anchor - 0.025),
        end_ratio: normalizeRatio(anchor + 0.025),
        className: 'minimap-battle-window',
        label: 'GAP',
        severity: 'info',
      })
    }
  }

  return layers
}

const TRACK_DRS_DEFAULTS: Record<string, DRSZone[]> = {
  MONACO: [{ start_ratio: 0.43, end_ratio: 0.49, detection_ratio: 0.37, activation_ratio: 0.43, label: 'DRS1' }],
  MONZA: [
    { start_ratio: 0.11, end_ratio: 0.17, detection_ratio: 0.05, activation_ratio: 0.11, label: 'DRS1' },
    { start_ratio: 0.62, end_ratio: 0.71, detection_ratio: 0.56, activation_ratio: 0.62, label: 'DRS2' },
  ],
  SPA: [
    { start_ratio: 0.05, end_ratio: 0.14, detection_ratio: 0.97, activation_ratio: 0.05, label: 'DRS1' },
    { start_ratio: 0.58, end_ratio: 0.67, detection_ratio: 0.53, activation_ratio: 0.58, label: 'DRS2' },
  ],
}

type ResolveDrsOptions = {
  track?: string
  raceControlState?: string
  activeByLabel?: Record<string, boolean>
  playerDrsEnabled?: boolean
}

export function resolveDrsZones(input: DRSZone[] | undefined, fallbackCount = 2, options: ResolveDrsOptions = {}): DRSZone[] {
  const raceState = (options.raceControlState ?? '').toLowerCase()
  const drsAllowed = !raceState.includes('safety') && !raceState.includes('vsc')

  function sanitize(zone: DRSZone, index: number): DRSZone | null {
    if (!isFiniteNumber(zone.start_ratio) || !isFiniteNumber(zone.end_ratio)) return null
    const start_ratio = clamp01(zone.start_ratio)
    const end_ratio = clamp01(zone.end_ratio)
    if (start_ratio === end_ratio) return null

    const label = zone.label ?? `DRS${index + 1}`
    const activeFlag =
      typeof zone.is_active === 'boolean'
        ? zone.is_active
        : options.activeByLabel?.[label] ?? (options.playerDrsEnabled ?? false)

    const detection_ratio = isFiniteNumber(zone.detection_ratio as number)
      ? clamp01(zone.detection_ratio as number)
      : normalizeRatio(start_ratio - 0.05)
    const activation_ratio = isFiniteNumber(zone.activation_ratio as number)
      ? clamp01(zone.activation_ratio as number)
      : start_ratio

    return {
      start_ratio,
      end_ratio,
      label,
      detection_ratio,
      activation_ratio,
      enabled_when: zone.enabled_when ?? 'race',
      is_active: drsAllowed && activeFlag,
    }
  }

  if (input && input.length > 0) {
    return input.map((zone, index) => sanitize(zone, index)).filter((zone): zone is DRSZone => zone !== null)
  }

  const trackKey = (options.track ?? '').toUpperCase()
  const trackDefault = Object.keys(TRACK_DRS_DEFAULTS).find((key) => trackKey.includes(key))
  if (trackDefault) {
    return TRACK_DRS_DEFAULTS[trackDefault]
      .map((zone, index) => sanitize(zone, index))
      .filter((zone): zone is DRSZone => zone !== null)
  }

  if (fallbackCount <= 1) {
    return [{ start_ratio: 0.15, end_ratio: 0.22, detection_ratio: 0.1, activation_ratio: 0.15, label: 'DRS1', is_active: false }]
  }

  return [
    { start_ratio: 0.12, end_ratio: 0.19, detection_ratio: 0.08, activation_ratio: 0.12, label: 'DRS1', is_active: false },
    { start_ratio: 0.6, end_ratio: 0.68, detection_ratio: 0.55, activation_ratio: 0.6, label: 'DRS2', is_active: false },
  ]
}
