/**
 * HUD data types for Driver Mode overlay.
 * Matches the backend HudEngine output schema.
 */

export type PenaltyRisk = {
  corner_cuts: number
  total_warnings: number
  time_penalties_s: number
  level: 'ok' | 'caution' | 'warning' | 'critical'
  message: string
}

export type DamageComponent = {
  name: string
  damage_pct: number
  time_loss_ms: number
}

export type DamageAnalysis = {
  total_time_loss_ms: number
  components: DamageComponent[]
  critical: boolean
  summary: string
}

export type PitDecision = {
  should_pit: boolean
  urgency: 'none' | 'consider' | 'recommended' | 'critical'
  laps_can_survive: number
  pit_cost_s: number
  stay_out_loss_s: number
  pit_gain_s: number
  reason: string
}

export type RivalTyreEstimate = {
  car_index: number
  driver_code: string
  gap_ms: number
  compound: string
  stint_laps: number
  estimated_wear_pct: number
  pace_trend: 'improving' | 'stable' | 'degrading'
  is_vulnerable: boolean
  is_threatening: boolean
}

export type HudState = {
  penalty: PenaltyRisk
  damage: DamageAnalysis
  pit_decision: PitDecision
  car_ahead: RivalTyreEstimate | null
  car_behind: RivalTyreEstimate | null
  lap: number
  position: number
  total_laps: number
  speed: number
  gear: number
  drs_enabled: boolean
  tyre_compound: string
  tyre_wear_pct: number
  fuel: number
  ers_pct: number
}

export type HudWidgetConfig = {
  id: string
  visible: boolean
  x: number
  y: number
  opacity: number
  scale: number
}

export type HudLayoutConfig = {
  widgets: HudWidgetConfig[]
  globalOpacity: number
  showOnlyWhenCritical: boolean
}

export const DEFAULT_HUD_LAYOUT: HudLayoutConfig = {
  widgets: [
    { id: 'penalty', visible: true, x: 20, y: 20, opacity: 0.9, scale: 1 },
    { id: 'damage', visible: true, x: 20, y: 120, opacity: 0.85, scale: 1 },
    { id: 'pit-decision', visible: true, x: 20, y: 280, opacity: 0.9, scale: 1 },
    { id: 'rivals', visible: true, x: 20, y: 460, opacity: 0.85, scale: 1 },
    { id: 'status-bar', visible: true, x: 0, y: 0, opacity: 0.9, scale: 1 },
  ],
  globalOpacity: 0.9,
  showOnlyWhenCritical: false,
}
