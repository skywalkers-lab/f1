/**
 * Data Normalizer — transforms raw backend payloads into clean AppState.
 *
 * Inspired by pits-n-giggles' appStateBuilder.js which transforms raw
 * F1 UDP packets into a unified state structure.
 *
 * Pipeline:
 *   WebSocket raw JSON → normalizeSnapshot() → AppState
 *
 * Responsibilities:
 *   • Field validation and defaults
 *   • Unit conversions (ms → formatted strings)
 *   • Data quality checks (reject corrupt payloads)
 *   • Backward compatibility (handle missing fields gracefully)
 */

import type { AppState } from './types'

// ── Formatters ─────────────────────────────────────────────────────────

export function formatLapTime(ms: number): string {
  if (!ms || ms <= 0) return '-:--:---'
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.floor((ms % 60_000) / 1000)
  const millis = ms % 1000
  return `${minutes}:${seconds.toString().padStart(2, '0')}.${millis.toString().padStart(3, '0')}`
}

export function formatGap(seconds: number): string {
  if (seconds === 0) return 'INTERVAL'
  const sign = seconds > 0 ? '+' : ''
  return `${sign}${seconds.toFixed(3)}s`
}

export function formatFuel(kg: number, deltaPerLap: number, lapsRemaining: number): {
  remaining: string
  perLap: string
  lapsCanDo: number
  critical: boolean
} {
  const lapsCanDo = deltaPerLap > 0 ? Math.floor(kg / deltaPerLap) : 99
  return {
    remaining: `${kg.toFixed(1)} kg`,
    perLap: deltaPerLap > 0 ? `-${deltaPerLap.toFixed(2)} kg/lap` : '-',
    lapsCanDo,
    critical: lapsCanDo < lapsRemaining + 1,
  }
}

export function formatSpeed(kph: number): string {
  return `${Math.round(kph)} km/h`
}

export function tyreCompoundColor(compound: string): string {
  const map: Record<string, string> = {
    SOFT: '#ff3333',
    MEDIUM: '#ffd700',
    HARD: '#ffffff',
    INTER: '#33cc33',
    WET: '#3399ff',
  }
  return map[compound?.toUpperCase()] || '#888888'
}

export function raceControlLabel(state: string): { label: string; severity: 'green' | 'yellow' | 'red' | 'sc' } {
  if (!state || state === 'GREEN') return { label: 'GREEN', severity: 'green' }
  if (state.includes('SC') || state.includes('3')) return { label: 'SAFETY CAR', severity: 'sc' }
  if (state.includes('VSC') || state.includes('2')) return { label: 'VSC', severity: 'yellow' }
  if (state.includes('RED') || state.includes('4')) return { label: 'RED FLAG', severity: 'red' }
  if (state.includes('YELLOW') || state.includes('1')) return { label: 'YELLOW', severity: 'yellow' }
  return { label: state, severity: 'green' }
}


// ── Validation ─────────────────────────────────────────────────────────

export function isValidSnapshot(data: unknown): data is AppState {
  if (!data || typeof data !== 'object') return false
  const obj = data as Record<string, unknown>
  if (typeof obj.session_uid !== 'number') return false
  if (!obj.player || typeof obj.player !== 'object') return false
  return true
}


// ── Normalizer ─────────────────────────────────────────────────────────

const DEFAULTS = {
  session_uid: 0,
  packet_format: 0,
  packet_version: 0,
  last_frame_identifier: 0,
  session_type: 'UNKNOWN',
  track: 'UNKNOWN',
  weather_state: 'WEATHER_0',
  total_laps: 0,
  race_control_state: 'GREEN',
  player_car_index: 0,
  last_event_summary: '',
  last_update_iso: '',
}

const PLAYER_DEFAULTS = {
  lap: 0,
  position: 0,
  tyre_compound: 'UNKNOWN',
  fuel: 0,
  ers: 0,
  tyres_age_laps: 0,
  speed: 0,
  throttle: 0,
  brake: 0,
  gear: 0,
  rpm: 0,
  last_lap_ms: 0,
  current_lap_ms: 0,
  fuel_delta_per_lap: 0,
  drs_enabled: false,
}

/**
 * Normalize a raw WebSocket payload into a clean AppState.
 * Fills missing fields with sensible defaults.
 * Returns null if the payload is fundamentally invalid.
 */
export function normalizeSnapshot(raw: unknown): AppState | null {
  if (!isValidSnapshot(raw)) return null

  const data = raw as AppState

  // Ensure player has all required fields
  const player = {
    ...PLAYER_DEFAULTS,
    ...data.player,
  }

  // Ensure leaderboard entries are clean
  const leaderboard = (data.leaderboard || []).map((row) => ({
    position: row.position ?? 0,
    car_index: row.car_index ?? 0,
    driver_code: row.driver_code ?? `C${(row.car_index ?? 0).toString().padStart(2, '0')}`,
    driver_name: row.driver_name ?? '',
    gap_to_player_s: row.gap_to_player_s ?? 0,
    tyre_compound: row.tyre_compound ?? 'UNKNOWN',
    is_pitting: row.is_pitting ?? false,
    last_lap_ms: row.last_lap_ms ?? 0,
    stint_lap: row.stint_lap ?? 0,
    tyre_wear_pct: row.tyre_wear_pct ?? 0,
    pit_window_open: row.pit_window_open ?? false,
    sector_marks: row.sector_marks,
  }))

  // Ensure pace summary
  const pace = {
    best_lap_ms: data.pace?.best_lap_ms ?? 0,
    avg_lap_ms: data.pace?.avg_lap_ms ?? 0,
    consistency_pct: data.pace?.consistency_pct ?? 0,
    recent: data.pace?.recent ?? [],
  }

  // Ensure strategy
  const strategy = {
    action: data.strategy?.action ?? 'STAY_OUT',
    score: data.strategy?.score ?? 0,
    confidence: data.strategy?.confidence ?? 'low',
    reason: data.strategy?.reason ?? '',
    key_inputs: data.strategy?.key_inputs ?? {},
    candidates: data.strategy?.candidates ?? [],
    advanced_context: data.strategy?.advanced_context,
  }

  // Ensure minimap
  const minimap = {
    mode: data.minimap?.mode ?? 'live_trace',
    player_car_index: data.minimap?.player_car_index ?? data.player_car_index ?? 0,
    cars: data.minimap?.cars ?? [],
    track_trace: data.minimap?.track_trace ?? [],
    transform: data.minimap?.transform ?? { min_x: -1, max_x: 1, min_z: -1, max_z: 1 },
    drs_zones: data.minimap?.drs_zones,
    sectors: data.minimap?.sectors,
    pit_lane: data.minimap?.pit_lane,
    track_name: data.minimap?.track_name,
    track_length_m: data.minimap?.track_length_m,
  }

  // Ensure ingest stats
  const ingest_stats = {
    packets_received: data.ingest_stats?.packets_received ?? 0,
    packets_decoded: data.ingest_stats?.packets_decoded ?? 0,
    packets_dropped: data.ingest_stats?.packets_dropped ?? 0,
    duplicate_packets: data.ingest_stats?.duplicate_packets ?? 0,
    decode_errors: data.ingest_stats?.decode_errors ?? 0,
    last_packet_type: data.ingest_stats?.last_packet_type ?? '',
    out_of_order_packets: data.ingest_stats?.out_of_order_packets,
    gaps_detected: data.ingest_stats?.gaps_detected,
    max_gap_frames: data.ingest_stats?.max_gap_frames,
    interpolated_frames: data.ingest_stats?.interpolated_frames,
  }

  return {
    ...DEFAULTS,
    ...data,
    player,
    leaderboard,
    pace,
    strategy,
    minimap,
    ingest_stats,
  } as AppState
}


// ── Derived compute helpers ────────────────────────────────────────────

export type DerivedMetrics = {
  fuelInfo: ReturnType<typeof formatFuel>
  raceProgress: number // 0..1
  lapTimeFormatted: string
  bestLapFormatted: string
  lastLapFormatted: string
  raceControl: ReturnType<typeof raceControlLabel>
  positionDelta: number // positive = gained, negative = lost (vs start)
  isDataFresh: boolean
  ersInfo: ErsInfo
  damageInfo: DamageInfo
  tyreHealth: TyreHealth
  strategyUrgency: 'none' | 'advisory' | 'warning' | 'critical'
}

// ── ERS ────────────────────────────────────────────────────────────────

export type ErsInfo = {
  pct: number
  label: string
  critical: boolean
}

export function formatErs(ers: number): ErsInfo {
  // ERS is 0..4_000_000 J internally; backend normalizes to 0..100 or raw J
  const pct = ers > 1000 ? (ers / 4_000_000) * 100 : ers
  return {
    pct: Math.round(pct * 10) / 10,
    label: `${Math.round(pct)}%`,
    critical: pct < 10,
  }
}

// ── Damage Summary ─────────────────────────────────────────────────────

export type DamageInfo = {
  hasDamage: boolean
  worstComponent: string
  worstPct: number
  summary: string
}

export function computeDamage(player: AppState['player']): DamageInfo {
  const components: Array<[string, number | undefined]> = [
    ['Front Wing', (player as Record<string, unknown>).front_wing_damage as number | undefined],
    ['Rear Wing', (player as Record<string, unknown>).rear_wing_damage as number | undefined],
    ['Floor', (player as Record<string, unknown>).floor_damage as number | undefined],
    ['Diffuser', (player as Record<string, unknown>).diffuser_damage as number | undefined],
    ['Sidepod', (player as Record<string, unknown>).sidepod_damage as number | undefined],
    ['Engine', (player as Record<string, unknown>).engine_damage as number | undefined],
    ['Gearbox', (player as Record<string, unknown>).gearbox_damage as number | undefined],
  ]
  let worstComponent = ''
  let worstPct = 0
  let damagedParts = 0
  for (const [name, val] of components) {
    const pct = val ?? 0
    if (pct > 0) damagedParts++
    if (pct > worstPct) {
      worstPct = pct
      worstComponent = name
    }
  }
  const hasDamage = worstPct > 0
  let summary = 'No damage'
  if (worstPct > 50) summary = `Critical: ${worstComponent} ${worstPct}%`
  else if (worstPct > 20) summary = `Warning: ${worstComponent} ${worstPct}%`
  else if (hasDamage) summary = `Minor damage (${damagedParts} part${damagedParts > 1 ? 's' : ''})`
  return { hasDamage, worstComponent, worstPct, summary }
}

// ── Tyre Health ────────────────────────────────────────────────────────

export type TyreHealth = {
  avgWear: number
  maxCornerWear: number
  wearLabel: string
  tempStatus: 'cold' | 'optimal' | 'hot' | 'unknown'
}

export function computeTyreHealth(player: AppState['player']): TyreHealth {
  const p = player as Record<string, unknown>
  const surfTemps = (p.tyre_surface_temps_c as number[] | undefined) ?? []
  const wearPct = (p.tyre_wear_pct as number | undefined)

  const avgWear = wearPct ?? 0
  const maxCornerWear = avgWear // per-corner data would come from backend
  let wearLabel = 'Fresh'
  if (avgWear > 70) wearLabel = 'Critical'
  else if (avgWear > 50) wearLabel = 'Worn'
  else if (avgWear > 25) wearLabel = 'Used'

  let tempStatus: TyreHealth['tempStatus'] = 'unknown'
  if (surfTemps.length >= 4) {
    const avg = surfTemps.reduce((a, b) => a + b, 0) / surfTemps.length
    if (avg < 80) tempStatus = 'cold'
    else if (avg > 110) tempStatus = 'hot'
    else tempStatus = 'optimal'
  }

  return { avgWear, maxCornerWear, wearLabel, tempStatus }
}

// ── Strategy Urgency ───────────────────────────────────────────────────

function assessStrategyUrgency(state: AppState): DerivedMetrics['strategyUrgency'] {
  const adv = state.strategy?.advanced_context
  if (adv?.action_recommendation?.urgency === 'immediate') return 'critical'
  if (adv?.action_recommendation?.urgency === 'next_lap') return 'warning'
  if (state.strategy?.score >= 80) return 'warning'
  if (state.strategy?.score >= 50) return 'advisory'
  return 'none'
}

// ── Position Tracking ──────────────────────────────────────────────────

let _sessionUid = 0
let _startPosition = 0

function trackPosition(state: AppState): number {
  const pos = state.player?.position ?? 0
  if (state.session_uid !== _sessionUid) {
    _sessionUid = state.session_uid
    _startPosition = pos
  }
  if (_startPosition === 0 && pos > 0) {
    _startPosition = pos
  }
  return _startPosition > 0 ? _startPosition - pos : 0
}

// ── Main derived compute ───────────────────────────────────────────────

export function computeDerived(state: AppState): DerivedMetrics {
  const lapsRemaining = Math.max(0, state.total_laps - (state.player?.lap ?? 0))
  const fuelInfo = formatFuel(
    state.player?.fuel ?? 0,
    state.player?.fuel_delta_per_lap ?? 0,
    lapsRemaining,
  )
  const raceProgress = state.total_laps > 0
    ? Math.min(1, (state.player?.lap ?? 0) / state.total_laps)
    : 0

  const now = Date.now()
  const lastUpdate = state.last_update_iso ? new Date(state.last_update_iso).getTime() : 0
  const isDataFresh = now - lastUpdate < 5000

  return {
    fuelInfo,
    raceProgress,
    lapTimeFormatted: formatLapTime(state.player?.current_lap_ms ?? 0),
    bestLapFormatted: formatLapTime(state.pace?.best_lap_ms ?? 0),
    lastLapFormatted: formatLapTime(state.player?.last_lap_ms ?? 0),
    raceControl: raceControlLabel(state.race_control_state ?? ''),
    positionDelta: trackPosition(state),
    isDataFresh,
    ersInfo: formatErs(state.player?.ers ?? 0),
    damageInfo: computeDamage(state.player),
    tyreHealth: computeTyreHealth(state.player),
    strategyUrgency: assessStrategyUrgency(state),
  }
}
