/**
 * 2025 F1 그리드 팀 컬러 매핑.
 * driver_code -> { body, cockpit, halo } CSS 색상 문자열
 */

export type TeamColors = {
  body: string
  cockpit: string
  halo: string
}

// driver_code 기준 팀 배정
const DRIVER_TEAM: Record<string, string> = {
  // Ferrari
  LEC: 'ferrari', SAI: 'ferrari', HAM: 'ferrari', BEA: 'ferrari',
  // Red Bull
  VER: 'redbull', PER: 'redbull', TSU: 'redbull', LAW: 'redbull',
  // McLaren
  NOR: 'mclaren', PIA: 'mclaren',
  // Mercedes
  RUS: 'mercedes', ANT: 'mercedes',
  // Aston Martin
  ALO: 'astonmartin', STR: 'astonmartin',
  // Alpine
  OCO: 'alpine', GAS: 'alpine', DOO: 'alpine',
  // Williams
  ALB: 'williams', SAR: 'williams', COL: 'williams',
  // Haas
  MAG: 'haas', HUL: 'haas', BOR: 'haas',
  // Kick Sauber
  BOT: 'sauber', ZHO: 'sauber',
  // RB (Visa RB)
  RIC: 'rb',
}

const TEAM_COLORS: Record<string, TeamColors> = {
  ferrari:      { body: '#e8002d', cockpit: '#fff5b3', halo: 'rgba(232,0,45,0.44)' },
  redbull:      { body: '#3671c6', cockpit: '#ffe000', halo: 'rgba(54,113,198,0.44)' },
  mclaren:      { body: '#ff8000', cockpit: '#fff0d0', halo: 'rgba(255,128,0,0.44)' },
  mercedes:     { body: '#27f4d2', cockpit: '#e8fffa', halo: 'rgba(39,244,210,0.44)' },
  astonmartin:  { body: '#229971', cockpit: '#d0fbe8', halo: 'rgba(34,153,113,0.44)' },
  alpine:       { body: '#0093cc', cockpit: '#d7f2ff', halo: 'rgba(0,147,204,0.44)' },
  williams:     { body: '#64c4ff', cockpit: '#e8f6ff', halo: 'rgba(100,196,255,0.44)' },
  haas:         { body: '#b6babd', cockpit: '#f0f0f0', halo: 'rgba(182,186,189,0.44)' },
  sauber:       { body: '#52e252', cockpit: '#e2ffe2', halo: 'rgba(82,226,82,0.44)' },
  rb:           { body: '#6692ff', cockpit: '#dce8ff', halo: 'rgba(102,146,255,0.44)' },
  // fallback
  default:      { body: '#5eb8eb', cockpit: '#dff6ff', halo: 'rgba(94,184,235,0.44)' },
}

export function getTeamColors(driverCode: string): TeamColors {
  const team = DRIVER_TEAM[driverCode?.toUpperCase() ?? ''] ?? 'default'
  return TEAM_COLORS[team] ?? TEAM_COLORS.default
}
