import { AppState } from './types'

export type TyreCompound = 'SOFT' | 'MEDIUM' | 'HARD' | 'UNKNOWN'

export type TyreWearPoint = {
  lap: number
  wear: number
  timestamp: number
  lapTimeMs?: number
  compound: TyreCompound
  gapToPlayerS?: number
  position?: number
}

export type TyreHistory = Record<number, TyreWearPoint[]>

export type TyreHistoryOptions = {
  maxLapWindow: number
  maxAgeMs: number
  maxPointsPerDriver: number
}

const DEFAULT_OPTIONS: TyreHistoryOptions = {
  maxLapWindow: 18,
  maxAgeMs: 8 * 60 * 1000,
  maxPointsPerDriver: 360,
}

function normalizeCompound(raw: string | undefined): TyreCompound {
  const value = (raw || '').toUpperCase()
  if (value.includes('SOFT') || value === 'C5' || value === 'C4') return 'SOFT'
  if (value.includes('MEDIUM') || value === 'C3') return 'MEDIUM'
  if (value.includes('HARD') || value === 'C2' || value === 'C1') return 'HARD'
  return 'UNKNOWN'
}

function normalizeWear(raw: number | undefined): number | null {
  if (!Number.isFinite(raw)) return null
  const value = Number(raw)
  if (value > 1.0) return Math.max(0, Math.min(1, value / 100))
  return Math.max(0, Math.min(1, value))
}

function inferWear(points: TyreWearPoint[], lap: number): number | null {
  if (points.length === 0) return null
  const latest = points[points.length - 1]
  const prev = points.length > 1 ? points[points.length - 2] : undefined
  if (!prev) return latest.wear
  const deltaLap = Math.max(0.01, latest.lap - prev.lap)
  const slope = Math.max(0, (latest.wear - prev.wear) / deltaLap)
  const projected = latest.wear + slope * Math.max(0, lap - latest.lap)
  return Math.max(0, Math.min(1, projected))
}

function pruneHistory(points: TyreWearPoint[], now: number, options: TyreHistoryOptions): TyreWearPoint[] {
  if (points.length === 0) return points
  const latestLap = points[points.length - 1].lap
  const minLap = latestLap - options.maxLapWindow
  const minTs = now - options.maxAgeMs

  const pruned = points.filter((p) => p.lap >= minLap && p.timestamp >= minTs)
  if (pruned.length <= options.maxPointsPerDriver) return pruned

  const stride = Math.ceil(pruned.length / options.maxPointsPerDriver)
  const sampled: TyreWearPoint[] = []
  for (let i = 0; i < pruned.length; i += stride) sampled.push(pruned[i])
  const last = pruned[pruned.length - 1]
  if (sampled[sampled.length - 1] !== last) sampled.push(last)
  return sampled
}

export class TyreHistoryManager {
  private history: TyreHistory = {}
  private readonly options: TyreHistoryOptions

  constructor(options?: Partial<TyreHistoryOptions>) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
  }

  ingest(state: AppState, timestamp = Date.now()): void {
    const fallbackLap = Number.isFinite(state.player?.lap) ? Number(state.player.lap) : 0
    const rows = state.leaderboard ?? []

    for (const row of rows) {
      const carIndex = row.car_index
      if (!Number.isFinite(carIndex)) continue

      const lapCandidate = Number.isFinite(row.stint_lap) ? Number(row.stint_lap) : fallbackLap
      const lap = Math.max(0, lapCandidate)
      const current = this.history[carIndex] ?? []
      let wear = normalizeWear(row.tyre_wear_pct)
      if (wear === null) wear = inferWear(current, lap)
      if (wear === null) continue

      const point: TyreWearPoint = {
        lap,
        wear,
        timestamp,
        lapTimeMs: Number.isFinite(row.last_lap_ms) ? Number(row.last_lap_ms) : undefined,
        compound: normalizeCompound(row.tyre_compound),
        gapToPlayerS: Number.isFinite(row.gap_to_player_s) ? Number(row.gap_to_player_s) : undefined,
        position: Number.isFinite(row.position) ? Number(row.position) : undefined,
      }

      const prev = current[current.length - 1]
      if (prev) {
        const sameLap = Math.abs(prev.lap - point.lap) < 0.001
        const tinyChange = Math.abs(prev.wear - point.wear) < 0.0005
        if (sameLap && tinyChange) {
          current[current.length - 1] = { ...prev, ...point }
          this.history[carIndex] = pruneHistory(current, timestamp, this.options)
          continue
        }
      }

      current.push(point)
      this.history[carIndex] = pruneHistory(current, timestamp, this.options)
    }
  }

  snapshot(): TyreHistory {
    const out: TyreHistory = {}
    for (const [key, points] of Object.entries(this.history)) out[Number(key)] = points
    return out
  }
}
