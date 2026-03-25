/**
 * API client for Pit Wall backend endpoints.
 * Handles session management, analysis, and setup recommendations.
 */

// When running inside Electron from a file:// URL the Vite proxy is not
// available, so we need to talk directly to the backend on localhost.
const isElectron = typeof (window as any).pitwallDesktop !== 'undefined'
const API_BASE = isElectron ? 'http://127.0.0.1:8765' : ''

const DEFAULT_TIMEOUT_MS = 15_000

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

async function apiFetch<T>(url: string, opts?: RequestInit): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal })
    if (!res.ok) {
      throw new ApiError(res.status, `API ${res.status}: ${res.statusText}`)
    }
    return (await res.json()) as T
  } catch (err) {
    if (err instanceof ApiError) throw err
    if ((err as Error).name === 'AbortError') {
      throw new ApiError(0, 'Request timed out')
    }
    throw new ApiError(0, `Network error: ${(err as Error).message}`)
  } finally {
    clearTimeout(timer)
  }
}

// ── Session Recording ──────────────────────────────

export type SessionSummary = {
  filename: string
  track: string
  session_type: string
  total_laps: number
  start_time: number
  duration_s: number
  final_position: number
  best_lap_ms: number
  total_pit_stops: number
  file_size_bytes: number
}

export type SessionData = {
  metadata: {
    session_uid: number
    track: string
    session_type: string
    total_laps: number
    weather_state: string
    start_time: number
    end_time: number
    duration_s: number
    final_position: number
    total_pit_stops: number
    best_lap_ms: number
    player_car_index: number
  }
  laps: Array<{
    lap_number: number
    lap_time_ms: number
    position: number
    tyre_compound: string
    tyre_age: number
    tyre_wear_pct: number
    fuel_remaining: number
    ers_level_norm: number
    is_pit_in_lap: boolean
    is_pit_out_lap: boolean
    timestamp: number
  }>
  pit_events: Array<{
    lap: number
    timestamp: number
    event_type: string
    tyre_compound_before: string
    tyre_compound_after: string
    position_before: number
    position_after: number
    pit_duration_ms: number
  }>
  strategy_decisions: Array<{
    lap: number
    timestamp: number
    action: string
    score: number
    confidence: string
    reason: string
    key_inputs: Record<string, unknown>
    candidates: Array<{ action: string; score: number; reason: string }>
  }>
  position_changes: Array<{
    lap: number
    timestamp: number
    old_position: number
    new_position: number
    event: string
  }>
  snapshots: Array<Record<string, unknown>>
  leaderboard_history: Array<Record<string, unknown>>
  checksum: string
  integrity_valid: boolean
}

export async function startRecording(): Promise<{ ok: boolean; session_uid?: number }> {
  return apiFetch(`${API_BASE}/sessions/start`, { method: 'POST' })
}

export async function stopRecording(): Promise<{ ok: boolean; path?: string }> {
  return apiFetch(`${API_BASE}/sessions/stop`, { method: 'POST' })
}

export async function getRecordingStatus(): Promise<{ active: boolean; session_uid: number }> {
  return apiFetch(`${API_BASE}/sessions/status`)
}

export async function listSessions(): Promise<SessionSummary[]> {
  const data = await apiFetch<{ sessions?: SessionSummary[] }>(`${API_BASE}/sessions/list`)
  return data.sessions ?? []
}

export async function loadSession(filename: string): Promise<SessionData | null> {
  const data = await apiFetch<{ ok: boolean; data?: SessionData }>(`${API_BASE}/sessions/${encodeURIComponent(filename)}`)
  return data.ok ? (data.data ?? null) : null
}

export async function deleteSession(filename: string): Promise<boolean> {
  const data = await apiFetch<{ ok: boolean }>(`${API_BASE}/sessions/${encodeURIComponent(filename)}`, { method: 'DELETE' })
  return data.ok
}

export async function exportSession(filename: string): Promise<SessionData | null> {
  const data = await apiFetch<{ ok: boolean; data?: SessionData }>(`${API_BASE}/sessions/${encodeURIComponent(filename)}/export`)
  return data.ok ? (data.data ?? null) : null
}

// ── Post-Race Analysis ─────────────────────────────

export type LapAnalysisItem = {
  lap: number
  lap_time_ms: number
  lap_time_s: number
  delta_to_best_s: number
  delta_to_avg_s: number
  position: number
  tyre_compound: string
  tyre_age: number
  fuel_remaining: number
  ers_level: number
  is_pit_lap: boolean
  is_outlier: boolean
  stint_number: number
}

export type StintAnalysisItem = {
  stint_number: number
  start_lap: number
  end_lap: number
  compound: string
  total_laps: number
  avg_lap_time_s: number
  best_lap_time_s: number
  degradation_rate_s: number
  tyre_cliff_detected: boolean
  cliff_lap: number | null
}

export type PitStopItem = {
  lap: number
  compound_before: string
  compound_after: string
  position_before: number
  position_after: number
  position_delta: number
  pit_duration_ms: number
  was_undercut: boolean
  was_overcut: boolean
  undercut_success: boolean | null
  overcut_success: boolean | null
  net_time_impact_s: number
}

export type StrategyEvaluation = {
  total_decisions: number
  pit_now_count: number
  stay_out_count: number
  correct_decisions: number
  accuracy_pct: number
  key_moments: Array<{
    lap: number
    action: string
    confidence: string
    was_correct: boolean
    reason: string
  }>
  overall_verdict: string
  improvement_suggestions: string[]
}

export type BalanceTrendPoint = {
  lap: number
  understeer_score: number
  oversteer_score: number
  dominant: string
}

export type TimelineEvent = {
  type: string
  lap: number
  timestamp: number
  detail: string
}

export type AnalysisReport = {
  track: string
  session_type: string
  total_laps: number
  final_position: number
  best_lap_ms: number
  total_time_s: number
  lap_analysis: LapAnalysisItem[]
  stint_analysis: StintAnalysisItem[]
  pit_stop_analysis: PitStopItem[]
  strategy_evaluation: StrategyEvaluation
  traffic_impact: {
    total_laps_in_traffic: number
    estimated_time_lost_s: number
    worst_traffic_laps: Array<{ lap: number; time_lost_s: number; lap_time_ms: number }>
    drs_opportunities_missed: number
  }
  fuel_ers_pattern: {
    fuel_consumption_per_lap: number[]
    avg_fuel_per_lap: number
    fuel_critical_lap: number | null
    ers_usage_histogram: number[]
    ers_deployment_efficiency: number
  }
  balance_trend: BalanceTrendPoint[]
  timeline_events: TimelineEvent[]
  race_narrative: string
  key_findings: string[]
}

export async function getAnalysisReport(filename: string): Promise<AnalysisReport | null> {
  const data = await apiFetch<{ ok: boolean; report?: AnalysisReport }>(`${API_BASE}/analysis/${encodeURIComponent(filename)}`)
  return data.ok ? (data.report ?? null) : null
}

// ── Setup Recommendation ───────────────────────────

export type CornerPhaseAnalysis = {
  entry_balance: number
  mid_balance: number
  exit_balance: number
  severity: string
}

export type BalanceTrend = {
  understeer_score: number
  oversteer_score: number
  dominant_tendency: string
  corner_phases: CornerPhaseAnalysis
  confidence: number
  sample_count: number
}

export type SetupAdjustment = {
  parameter: string
  current_value: number
  recommended_value: number
  delta: number
  reason: string
  priority: string
}

export type SetupRecommendation = {
  balance: BalanceTrend
  recommendation: {
    base_preset_name: string
    adjustments: SetupAdjustment[]
    current_setup: Record<string, number>
    recommended_setup: Record<string, number>
    summary: string
    timestamp: number
  }
  preset: Record<string, unknown>
}

export async function getSetupRecommendation(): Promise<SetupRecommendation | null> {
  const data = await apiFetch<{ ok: boolean } & Partial<SetupRecommendation>>(`${API_BASE}/setup/recommendation`)
  return data.ok ? (data as SetupRecommendation) : null
}

export async function getSetupBalance(): Promise<BalanceTrend | null> {
  const data = await apiFetch<{ ok: boolean; balance?: BalanceTrend }>(`${API_BASE}/setup/balance`)
  return data.ok ? (data.balance ?? null) : null
}

export async function applySetup(setup: Record<string, number>): Promise<boolean> {
  const data = await apiFetch<{ ok: boolean }>(`${API_BASE}/setup/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(setup),
  })
  return data.ok
}
