export type TelemetryTrendSample = {
  t: number
  throttle: number
  brake: number
  speed: number
  gear: number
  rpm: number
  ersPct: number
  lapDeltaMs: number
}

const SPEED_MAX_DELTA_PER_SAMPLE = 24
const RPM_MAX_DELTA_PER_SAMPLE = 1800

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, value))
}

function smoothJump(next: number, prev: number | undefined, maxDelta: number): number {
  if (!Number.isFinite(next)) return prev ?? 0
  if (!Number.isFinite(prev ?? NaN)) return next
  const delta = next - (prev ?? 0)
  if (Math.abs(delta) <= maxDelta) return next
  return (prev ?? 0) + Math.sign(delta) * maxDelta
}

export function sanitizeTelemetrySample(
  raw: Omit<TelemetryTrendSample, 't'>,
  prev?: TelemetryTrendSample,
  now = Date.now(),
): TelemetryTrendSample {
  const throttle = clamp(raw.throttle, 0, 1)
  const brake = clamp(raw.brake, 0, 1)
  const speed = clamp(smoothJump(raw.speed, prev?.speed, SPEED_MAX_DELTA_PER_SAMPLE), 0, 390)
  const rpm = clamp(smoothJump(raw.rpm, prev?.rpm, RPM_MAX_DELTA_PER_SAMPLE), 0, 16000)
  const gear = clamp(raw.gear, -1, 8)
  const ersPct = clamp(raw.ersPct, 0, 100)
  const lapDeltaMs = clamp(raw.lapDeltaMs, -15_000, 15_000)

  return {
    t: now,
    throttle,
    brake,
    speed,
    rpm,
    gear,
    ersPct,
    lapDeltaMs,
  }
}

export function trimTrendWindow(samples: TelemetryTrendSample[], windowMs: number, maxPoints: number): TelemetryTrendSample[] {
  const cutoff = Date.now() - windowMs
  const inWindow = samples.filter((sample) => sample.t >= cutoff)
  if (inWindow.length <= maxPoints) return inWindow
  return inWindow.slice(inWindow.length - maxPoints)
}

export function movingAverage(values: number[], windowSize: number): number[] {
  if (values.length === 0) return []
  const out: number[] = []
  for (let i = 0; i < values.length; i += 1) {
    const start = Math.max(0, i - windowSize + 1)
    const slice = values.slice(start, i + 1)
    const avg = slice.reduce((acc, cur) => acc + cur, 0) / slice.length
    out.push(avg)
  }
  return out
}

export function decimate(values: number[], maxPoints: number): number[] {
  if (values.length <= maxPoints) return values
  const step = (values.length - 1) / (maxPoints - 1)
  const out: number[] = []
  for (let i = 0; i < maxPoints; i += 1) {
    out.push(values[Math.round(i * step)])
  }
  return out
}
