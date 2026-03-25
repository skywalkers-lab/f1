import { useMemo } from 'react'
import { predictCliffLap } from '../lib/wearPrediction'
import { AppState } from '../lib/types'
import { TyreCompound, TyreHistory, TyreWearPoint } from '../lib/tyreHistoryManager'
import { tyreCompoundTone } from '../lib/f1Terms'

type Tone = 'ok' | 'watch' | 'critical'
type ThermalState = 'cold' | 'optimal' | 'overheating'
type StintPhase = 'warmup' | 'prime' | 'cliff'

type CornerId = 'FL' | 'FR' | 'RL' | 'RR'

export type TyreCornerAnalysis = {
  id: CornerId
  label: string
  wearPct: number
  gripLossPct: number
  lapTimeLossS: number
  temperatureC: number
  thermalState: ThermalState
  degradationRatePctPerLap: number
  tone: Tone
}

export type TyreForecastPoint = {
  lapOffset: number
  projectedWearPct: number
  projectedLapLossS: number
  riskTone: Tone
}

export type TyreInventoryPlan = {
  compound: 'SOFT' | 'MEDIUM' | 'HARD'
  label: string
  remainingSets: number
  scenario: string
  tone: Tone
}

export type TyreEngineeringAnalysis = {
  ready: boolean
  compoundLabel: string
  compoundTone: string
  stintLap: number
  pitWindowOpen: boolean
  pitTiming: {
    shouldBox: boolean
    label: string
    detail: string
    tone: Tone
  }
  thermal: {
    temperatureC: number
    state: ThermalState
    stateLabel: string
    gripLevelPct: number
    degradationRatePctPerLap: number
    warning: string
    tone: Tone
  }
  stint: {
    phase: StintPhase
    phaseLabel: string
    detail: string
    tone: Tone
  }
  corners: TyreCornerAnalysis[]
  totalLapLossS: number
  imbalance: {
    spreadPct: number
    handlingLabel: string
    detail: string
    dominantCorner: CornerId
    tone: Tone
  }
  forecast: {
    cliffLap: number | null
    confidencePct: number
    points: TyreForecastPoint[]
    summary: string
  }
  inventory: TyreInventoryPlan[]
}

const EMPTY_ANALYSIS: TyreEngineeringAnalysis = {
  ready: false,
  compoundLabel: '-',
  compoundTone: 'unknown',
  stintLap: 0,
  pitWindowOpen: false,
  pitTiming: {
    shouldBox: false,
    label: '-',
    detail: '-',
    tone: 'watch',
  },
  thermal: {
    temperatureC: 0,
    state: 'cold',
    stateLabel: '-',
    gripLevelPct: 0,
    degradationRatePctPerLap: 0,
    warning: '-',
    tone: 'watch',
  },
  stint: {
    phase: 'warmup',
    phaseLabel: '-',
    detail: '-',
    tone: 'watch',
  },
  corners: [],
  totalLapLossS: 0,
  imbalance: {
    spreadPct: 0,
    handlingLabel: '-',
    detail: '-',
    dominantCorner: 'FL',
    tone: 'watch',
  },
  forecast: {
    cliffLap: null,
    confidencePct: 0,
    points: [],
    summary: '-',
  },
  inventory: [],
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function normalizeCompound(raw?: string): TyreCompound {
  const value = (raw ?? '').toUpperCase()
  if (value.includes('SOFT') || value === 'C5' || value === 'C4') return 'SOFT'
  if (value.includes('MEDIUM') || value === 'C3') return 'MEDIUM'
  if (value.includes('HARD') || value === 'C2' || value === 'C1') return 'HARD'
  return 'UNKNOWN'
}

function formatCompoundLabel(compound: TyreCompound): string {
  if (compound === 'SOFT') return '소프트'
  if (compound === 'MEDIUM') return '미디엄'
  if (compound === 'HARD') return '하드'
  return '-'
}

function regressionSlope(points: TyreWearPoint[]): number {
  const recent = points.slice(-8)
  if (recent.length < 2) return 0
  let sumX = 0
  let sumY = 0
  let sumXY = 0
  let sumXX = 0
  recent.forEach((point) => {
    sumX += point.lap
    sumY += point.wear
    sumXY += point.lap * point.wear
    sumXX += point.lap * point.lap
  })
  const n = recent.length
  const denom = n * sumXX - sumX * sumX
  if (Math.abs(denom) < 1e-6) return 0
  return Math.max(0, (n * sumXY - sumX * sumY) / denom)
}

function resolveThermalWindow(compound: TyreCompound): { low: number; high: number; target: number } {
  if (compound === 'SOFT') return { low: 92, high: 101, target: 97 }
  if (compound === 'MEDIUM') return { low: 90, high: 100, target: 95 }
  return { low: 88, high: 98, target: 93 }
}

function inferTemperature(state: AppState, wearPct: number, compound: TyreCompound): number {
  const base = compound === 'SOFT' ? 95 : compound === 'MEDIUM' ? 93 : 91
  const throttleFactor = clamp(state.player.throttle, 0, 1) * 7.5
  const brakeFactor = clamp(state.player.brake, 0, 1) * 6.2
  const speedFactor = clamp((state.player.speed - 180) / 140, -0.3, 1) * 3.5
  const wearFactor = clamp((wearPct - 45) / 16, -2.5, 6.5)
  const weather = String(state.weather_state ?? '').toUpperCase()
  const weatherFactor = weather.includes('WEATHER_3') || weather.includes('WEATHER_4') || weather.includes('WEATHER_5') ? -6 : 0
  return Math.round(base + throttleFactor + brakeFactor + speedFactor + wearFactor + weatherFactor)
}

function resolveThermalState(tempC: number, compound: TyreCompound, baseDegRate: number): TyreEngineeringAnalysis['thermal'] {
  const window = resolveThermalWindow(compound)
  const deviation = tempC < window.low ? window.low - tempC : tempC > window.high ? tempC - window.high : 0
  const state: ThermalState = tempC < window.low ? 'cold' : tempC > window.high ? 'overheating' : 'optimal'
  const gripLevelPct = Math.round(clamp(100 - deviation * 3.8 - (state === 'optimal' ? 0 : 4), 72, 100))
  const degradationRatePctPerLap = Number((baseDegRate * (state === 'overheating' ? 1.45 : state === 'cold' ? 1.15 : 1)).toFixed(2))
  const tone: Tone = state === 'optimal' ? 'ok' : deviation <= 3 ? 'watch' : 'critical'
  const stateLabel = state === 'cold' ? 'Cold' : state === 'optimal' ? 'Optimal' : 'Overheating'
  const warning =
    state === 'optimal'
      ? '최적 작동 범위 유지'
      : state === 'cold'
        ? '그립 형성 지연, 워밍업 부족'
        : '과열, 향후 열화 가속 가능'

  return {
    temperatureC: tempC,
    state,
    stateLabel,
    gripLevelPct,
    degradationRatePctPerLap,
    warning,
    tone,
  }
}

function resolveStintPhase(stintLap: number, wearPct: number): TyreEngineeringAnalysis['stint'] {
  if (stintLap <= 3 || wearPct < 12) {
    return { phase: 'warmup', phaseLabel: '워밍업 구간', detail: '초기 열 형성 및 압력 안정화 단계', tone: 'watch' }
  }
  if (wearPct >= 66 || stintLap >= 18) {
    return { phase: 'cliff', phaseLabel: '열화 가속 구간', detail: '성능 저하와 피트 윈도우 진입 가능성 증가', tone: wearPct >= 78 ? 'critical' : 'watch' }
  }
  return { phase: 'prime', phaseLabel: '최적 성능 구간', detail: '그립과 수명 밸런스가 가장 안정적', tone: 'ok' }
}

function trackBias(track: string | undefined): { rightBias: number; frontBias: number } {
  const value = String(track ?? '').toLowerCase()
  const clockwise = ['monaco', 'jeddah', 'bahrain', 'hungary', 'singapore', 'imola']
  const rightBias = clockwise.some((name) => value.includes(name)) ? 2.8 : 1.2
  const frontBias = value.includes('monza') ? -1.4 : value.includes('monaco') ? 3.4 : 1.8
  return { rightBias, frontBias }
}

function buildCorners(params: {
  baseWearPct: number
  thermal: TyreEngineeringAnalysis['thermal']
  state: AppState
  compound: TyreCompound
}): TyreCornerAnalysis[] {
  const { rightBias, frontBias } = trackBias(params.state.track)
  const throttle = clamp(params.state.player.throttle, 0, 1)
  const brake = clamp(params.state.player.brake, 0, 1)
  const compoundFactor = params.compound === 'SOFT' ? 1.08 : params.compound === 'MEDIUM' ? 1 : 0.92
  const frontWear = frontBias + brake * 6.5 - throttle * 2.2
  const rearWear = -frontBias * 0.4 + throttle * 5.4 - brake * 1.4
  const leftBias = -rightBias * 0.7
  const rightWear = rightBias

  const template: Array<{ id: CornerId; label: string; offset: number }> = [
    { id: 'FL', label: '앞좌', offset: frontWear + leftBias },
    { id: 'FR', label: '앞우', offset: frontWear + rightWear },
    { id: 'RL', label: '뒤좌', offset: rearWear + leftBias * 0.8 },
    { id: 'RR', label: '뒤우', offset: rearWear + rightWear * 0.8 },
  ]

  return template.map((item, index) => {
    const wearPct = clamp(params.baseWearPct + item.offset, 0, 100)
    const thermalPenalty = params.thermal.state === 'overheating' ? 4.5 : params.thermal.state === 'cold' ? 2.2 : 0
    const gripLossPct = Number(clamp(wearPct * 0.36 * compoundFactor + thermalPenalty + index * 0.6, 0, 45).toFixed(1))
    const lapTimeLossS = Number((gripLossPct * 0.0085 + (wearPct > 72 ? 0.08 : 0)).toFixed(2))
    const temperatureC = Math.round(params.thermal.temperatureC + item.offset * 0.35 + (index >= 2 ? throttle * 2.5 : brake * 1.5))
    const degradationRatePctPerLap = Number((params.thermal.degradationRatePctPerLap * (1 + item.offset / 24)).toFixed(2))
    const tone: Tone = wearPct >= 78 || temperatureC > 104 ? 'critical' : wearPct >= 58 || temperatureC < 89 ? 'watch' : 'ok'
    const thermalState: ThermalState = temperatureC < 90 ? 'cold' : temperatureC > 101 ? 'overheating' : 'optimal'

    return {
      id: item.id,
      label: item.label,
      wearPct: Number(wearPct.toFixed(1)),
      gripLossPct,
      lapTimeLossS,
      temperatureC,
      thermalState,
      degradationRatePctPerLap,
      tone,
    }
  })
}

function resolveImbalance(corners: TyreCornerAnalysis[]): TyreEngineeringAnalysis['imbalance'] {
  const wears = corners.map((corner) => corner.wearPct)
  const spreadPct = Number((Math.max(...wears) - Math.min(...wears)).toFixed(1))
  const dominant = corners.reduce((top, corner) => (corner.wearPct > top.wearPct ? corner : top), corners[0])
  const frontAvg = (corners[0].wearPct + corners[1].wearPct) / 2
  const rearAvg = (corners[2].wearPct + corners[3].wearPct) / 2
  const rightAvg = (corners[1].wearPct + corners[3].wearPct) / 2
  const leftAvg = (corners[0].wearPct + corners[2].wearPct) / 2

  let handlingLabel = '밸런스 안정'
  let detail = '차량 밸런스와 드라이빙 입력이 안정적'
  let tone: Tone = spreadPct >= 13 ? 'critical' : spreadPct >= 7 ? 'watch' : 'ok'

  if (frontAvg - rearAvg >= 5) {
    handlingLabel = '언더스티어 경향'
    detail = '프런트 축 열화 우세, 턴인 성능 저하 가능'
  } else if (rearAvg - frontAvg >= 5) {
    handlingLabel = '오버스티어 경향'
    detail = '리어 축 열화 우세, 트랙션 저하 가능'
  } else if (rightAvg - leftAvg >= 4) {
    handlingLabel = '우측 편마모'
    detail = '우측 코너 하중 집중, 장기 스틴트 리스크 증가'
  }

  return {
    spreadPct,
    handlingLabel,
    detail,
    dominantCorner: dominant.id,
    tone,
  }
}

function buildForecast(params: {
  currentWearPct: number
  lapLossS: number
  slopePctPerLap: number
  thermal: TyreEngineeringAnalysis['thermal']
  cliffLap: number | null
  confidencePct: number
}): TyreEngineeringAnalysis['forecast'] {
  const points: TyreForecastPoint[] = []
  for (let lapOffset = 1; lapOffset <= 5; lapOffset += 1) {
    const wear = clamp(params.currentWearPct + params.slopePctPerLap * lapOffset, 0, 100)
    const projectedLapLossS = Number(
      (
        params.lapLossS +
        lapOffset * (params.slopePctPerLap * 0.012 + (params.thermal.state === 'overheating' ? 0.03 : 0.012)) +
        (wear >= 76 ? 0.07 : 0)
      ).toFixed(2),
    )
    const riskTone: Tone = wear >= 78 || projectedLapLossS >= params.lapLossS + 0.18 ? 'critical' : wear >= 60 ? 'watch' : 'ok'
    points.push({
      lapOffset,
      projectedWearPct: Number(wear.toFixed(1)),
      projectedLapLossS,
      riskTone,
    })
  }

  const summary =
    params.cliffLap !== null
      ? `클리프 예상 L${params.cliffLap.toFixed(1)} · 신뢰 ${params.confidencePct}%`
      : `향후 5랩 내 급격한 클리프 징후는 제한적 · 신뢰 ${params.confidencePct}%`

  return {
    cliffLap: params.cliffLap,
    confidencePct: params.confidencePct,
    points,
    summary,
  }
}

function buildInventory(totalLaps: number, currentLap: number, currentCompound: TyreCompound, shouldBox: boolean): TyreInventoryPlan[] {
  const lapsRemaining = Math.max(0, totalLaps - currentLap)
  const softSets = clamp((lapsRemaining <= 14 ? 2 : 1) - (currentCompound === 'SOFT' ? 1 : 0), 0, 2)
  const mediumSets = clamp((lapsRemaining > 10 ? 2 : 1) - (currentCompound === 'MEDIUM' ? 1 : 0), 0, 2)
  const hardSets = clamp((lapsRemaining > 24 ? 1 : 2) - (currentCompound === 'HARD' ? 1 : 0), 0, 2)

  return [
    {
      compound: 'SOFT',
      label: '소프트',
      remainingSets: softSets,
      scenario: lapsRemaining <= 12 ? '공격적 피니시 스틴트' : shouldBox ? '언더컷/세이프티카 대응 카드' : '후반 단기 푸시 용도',
      tone: lapsRemaining <= 12 ? 'ok' : 'watch',
    },
    {
      compound: 'MEDIUM',
      label: '미디엄',
      remainingSets: mediumSets,
      scenario: lapsRemaining >= 16 ? '기본 원스톱 마무리 축' : '균형형 대안 스틴트',
      tone: 'ok',
    },
    {
      compound: 'HARD',
      label: '하드',
      remainingSets: hardSets,
      scenario: lapsRemaining >= 24 ? '롱런 보호 전략' : '트랙 포지션 보존용',
      tone: lapsRemaining >= 24 ? 'watch' : 'ok',
    },
  ]
}

export function useTyreEngineeringAnalysis(state: AppState | null, history: TyreHistory): TyreEngineeringAnalysis {
  return useMemo(() => {
    if (!state) return EMPTY_ANALYSIS

    const playerRow = state.leaderboard.find((row) => row.car_index === state.player_car_index)
    const compound = normalizeCompound(state.player.tyre_compound || playerRow?.tyre_compound)
    const playerHistory = history[state.player_car_index] ?? []
    const latestWearPct = Number.isFinite(playerRow?.tyre_wear_pct)
      ? Number(playerRow?.tyre_wear_pct)
      : playerHistory[playerHistory.length - 1]
        ? playerHistory[playerHistory.length - 1].wear * 100
        : 0
    const stintLap = Number.isFinite(playerRow?.stint_lap) ? Number(playerRow?.stint_lap) : Number(state.player.lap ?? 0)
    const rawSlopePct = regressionSlope(playerHistory) * 100
    const slopePctPerLap = Number((rawSlopePct > 0 ? rawSlopePct : (compound === 'SOFT' ? 4.8 : compound === 'MEDIUM' ? 3.6 : 2.9)).toFixed(2))
    const tempC = inferTemperature(state, latestWearPct, compound)
    const thermal = resolveThermalState(tempC, compound, slopePctPerLap)
    const stint = resolveStintPhase(stintLap, latestWearPct)
    const corners = buildCorners({ baseWearPct: latestWearPct, thermal, state, compound })
    const totalLapLossS = Number(corners.reduce((sum, corner) => sum + corner.lapTimeLossS, 0).toFixed(2))
    const imbalance = resolveImbalance(corners)
    const prediction = predictCliffLap(state.player_car_index, playerHistory)
    const pitWindowOpen = !!playerRow?.pit_window_open || latestWearPct >= 58 || stint.phase === 'cliff'
    const shouldBox = pitWindowOpen && (thermal.state === 'overheating' || latestWearPct >= 72 || imbalance.tone === 'critical')
    const pitTiming: TyreEngineeringAnalysis['pitTiming'] = {
      shouldBox,
      label: shouldBox ? 'BOX WINDOW OPEN' : pitWindowOpen ? 'PIT WINDOW ARMED' : 'STAY OUT',
      detail: shouldBox
        ? '다음 1~2랩 내 성능 급락 가능성, 즉시 대응 권장'
        : pitWindowOpen
          ? '전략 윈도우 진입, 언더컷/오버컷 모두 검토 가능'
          : '현재 스틴트 유지 가능',
      tone: shouldBox ? 'critical' : pitWindowOpen ? 'watch' : 'ok',
    }
    const forecast = buildForecast({
      currentWearPct: latestWearPct,
      lapLossS: totalLapLossS,
      slopePctPerLap,
      thermal,
      cliffLap: prediction ? Number(prediction.cliffLap.toFixed(1)) : null,
      confidencePct: Math.round((prediction?.confidence ?? clamp(playerHistory.length / 10, 0.25, 0.82)) * 100),
    })
    const inventory = buildInventory(state.total_laps, state.player.lap, compound, shouldBox)

    return {
      ready: true,
      compoundLabel: formatCompoundLabel(compound),
      compoundTone: tyreCompoundTone(state.player.tyre_compound),
      stintLap,
      pitWindowOpen,
      pitTiming,
      thermal,
      stint,
      corners,
      totalLapLossS,
      imbalance,
      forecast,
      inventory,
    }
  }, [state, history])
}
