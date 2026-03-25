const ACTION_LABELS: Record<string, string> = {
  PIT_NOW: '즉시 피트 인',
  PIT_IN_1: '다음 랩 피트 인',
  PIT_IN_2: '2랩 후 피트 인',
  STAY_OUT: '스테이 아웃',
  PUSH_IN_CLEAR_AIR: '클린에어 푸시',
  COVER_UNDERCUT: '언더컷 커버',
  DEFEND_TRACK_POS: '트랙 포지션 방어',
}

const COMPOUND_LABELS: Record<string, string> = {
  C5: '소프트 (C5)',
  C4: '소프트 (C4)',
  C3: '미디엄 (C3)',
  C2: '하드 (C2)',
  C1: '하드 (C1)',
  SOFT: '소프트',
  MEDIUM: '미디엄',
  HARD: '하드',
}

const WEATHER_LABELS: Record<string, string> = {
  WEATHER_0: '맑음',
  WEATHER_1: '약간 흐림',
  WEATHER_2: '흐림',
  WEATHER_3: '약한 비',
  WEATHER_4: '비',
  WEATHER_5: '강한 비',
}

const RACE_CONTROL_LABELS: Record<string, string> = {
  SC_0: '그린 플래그',
  SC_1: '옐로우 플래그',
  SC_2: '버추얼 세이프티카',
  SC_3: '세이프티카',
  GREEN: '그린 플래그',
  YELLOW: '옐로우 플래그',
  VSC: '버추얼 세이프티카',
  SC: '세이프티카',
  RED: '레드 플래그',
}

const SESSION_LABELS: Record<string, string> = {
  SESSION_5: 'FP1',
  SESSION_6: 'FP2',
  SESSION_7: 'FP3',
  SESSION_8: 'Q1',
  SESSION_9: 'Q2',
  SESSION_10: 'Q3',
  SESSION_11: 'RACE',
}

const CONFIDENCE_LABELS: Record<string, string> = {
  high: '높음',
  medium: '중간',
  low: '낮음',
}

const KEY_INPUT_LABELS: Record<string, string> = {
  laps_remaining: '잔여 랩',
  stint_length: '현재 스틴트 길이',
  tyre_compound: '타이어 컴파운드',
  tyre_age: '타이어 사용 랩',
  fuel_remaining_kg: '잔여 연료(kg)',
  fuel_delta_per_lap: '랩당 연료 소모(kg)',
  ers_level_norm: 'ERS 잔량 비율',
  gap_ahead_s: '앞차 간격(s)',
  gap_behind_s: '뒷차 간격(s)',
  relative_pace_s: '기준 대비 페이스(s)',
  traffic_density: '트래픽 밀도',
  pit_window_status: '피트 윈도우',
  sc_vsc_status: '레이스 컨트롤',
  weather_state: '날씨',
  pit_loss_est_s: '피트 손실 추정(s)',
  decision_alpha: '시뮬레이션 가중치',
  ml_enabled: 'ML 보조',
}

export function formatStrategyAction(action?: string): string {
  if (!action) return '-'
  return ACTION_LABELS[action] ?? action
}

export function formatTyreCompound(compound?: string): string {
  if (!compound) return '-'
  return COMPOUND_LABELS[compound] ?? compound
}

export function formatTyreCompoundShort(compound?: string): string {
  if (!compound) return '-'
  const normalized = compound.toUpperCase()
  if (normalized === 'SOFT') return 'S'
  if (normalized === 'MEDIUM') return 'M'
  if (normalized === 'HARD') return 'H'
  if (normalized.includes('INTER')) return 'I'
  if (normalized.includes('WET')) return 'W'
  if (/^C[1-5]$/.test(normalized)) return normalized
  return normalized.slice(0, 3)
}

export function formatWeatherState(weather?: string): string {
  if (!weather) return '-'
  return WEATHER_LABELS[weather] ?? weather
}

export function formatRaceControl(state?: string): string {
  if (!state) return '-'
  return RACE_CONTROL_LABELS[state] ?? state
}

export function formatConfidence(confidence?: string): string {
  if (!confidence) return '-'
  return CONFIDENCE_LABELS[confidence] ?? confidence
}

export function formatStrategyKey(key: string): string {
  return KEY_INPUT_LABELS[key] ?? key
}

export function formatSessionCode(sessionType?: string): string {
  if (!sessionType) return '-'
  return SESSION_LABELS[sessionType] ?? sessionType
}

export function raceControlTone(state?: string): 'green' | 'yellow' | 'vsc' | 'sc' | 'red' {
  const normalized = (state ?? '').toUpperCase()
  if (normalized.includes('RED')) return 'red'
  if (normalized === 'SC_3' || normalized.includes('SAFETY') || normalized === 'SC') return 'sc'
  if (normalized === 'SC_2' || normalized.includes('VSC')) return 'vsc'
  if (normalized === 'SC_1' || normalized.includes('YELLOW')) return 'yellow'
  return 'green'
}

export function tyreCompoundTone(compound?: string): 'soft' | 'medium' | 'hard' | 'inter' | 'wet' | 'unknown' {
  const normalized = (compound ?? '').toUpperCase()
  if (normalized === 'SOFT' || normalized === 'C5' || normalized === 'C4') return 'soft'
  if (normalized === 'MEDIUM' || normalized === 'C3') return 'medium'
  if (normalized === 'HARD' || normalized === 'C2' || normalized === 'C1') return 'hard'
  if (normalized.includes('INTER')) return 'inter'
  if (normalized.includes('WET')) return 'wet'
  return 'unknown'
}
