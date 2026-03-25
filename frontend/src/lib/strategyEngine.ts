import { analyzeUndercutWindows } from './undercutAnalyzer'
import { buildGapMetrics } from './leaderboardGap'
import { predictCliffLap } from './wearPrediction'
import { AppState } from './types'
import { TyreHistory, TyreWearPoint } from './tyreHistoryManager'

export type StrategyCall = 'BOX_THIS_LAP' | 'STAY_OUT' | 'PIT_IN_2' | 'PIT_IN_4'

export type StrategySimulationLap = {
  lap: number
  tyreWear: number
  lapTimeMs: number
  gapAheadMs: number | null
  gapBehindMs: number | null
}

export type StrategyScenario = {
  id: StrategyCall
  label: string
  pitOffset: number | null
  targetCompound: string
  projectedPosition: number
  projectedRejoinPosition: number
  projectedNetMs: number
  expectedGainMs: number
  trafficRisk: 'low' | 'medium' | 'high'
  confidence: number
  notes: string[]
  laps: StrategySimulationLap[]
}

export type StrategyRecommendation = {
  call: StrategyCall
  headline: string
  subline: string
  tone: 'gain' | 'warn' | 'hold'
  confidence: number
}

export type DecisionLogEntry = {
  label: string
  value: string
  tone: 'positive' | 'warning' | 'neutral'
}

export type StrategyExecutionItem = {
  step: string
  detail: string
}

export type StrategyEngineOutput = {
  recommendation: StrategyRecommendation
  scenarios: StrategyScenario[]
  decisionLog: DecisionLogEntry[]
  executionChecklist: StrategyExecutionItem[]
  undercutWindows: ReturnType<typeof analyzeUndercutWindows>
  simulationHorizon: number
}

type RivalModel = {
  carIndex: number
  initialGapMs: number
  projectedTimeMs: number
}

const CLIFF_THRESHOLD = 0.78
const DEFAULT_PIT_LOSS_MS = 21_500

// ── Memoisation caches ──────────────────────────────────────────────
// Prevents redundant heavy computation when inputs haven't materially changed.
let _lastCacheKey = ''
let _lastOutput: StrategyEngineOutput | null = null

function stratCacheKey(state: AppState, history: TyreHistory): string {
  const p = state.player
  const lb = state.leaderboard
  // Use a fingerprint of the most volatile inputs
  return [
    p.lap, p.position, p.tyre_compound,
    state.total_laps, state.race_control_state,
    state.pace?.avg_lap_ms ?? 0,
    lb?.length ?? 0,
    lb?.[0]?.gap_to_player_s ?? 0,
    lb?.[0]?.tyre_wear_pct ?? 0,
    Object.keys(history).length,
  ].join('|')
}
// ─────────────────────────────────────────────────────────────────────

function latestWear(points: TyreWearPoint[] | undefined, fallbackPct?: number): number {
  const fromHistory = points?.[points.length - 1]?.wear
  if (Number.isFinite(fromHistory)) return Number(fromHistory)
  if (Number.isFinite(fallbackPct)) return Math.max(0, Math.min(1, Number(fallbackPct) / 100))
  return 0.42
}

function estimateWearSlope(points: TyreWearPoint[] | undefined, compound: string | undefined): number {
  if (points && points.length >= 3) {
    const slice = points.slice(-6)
    const first = slice[0]
    const last = slice[slice.length - 1]
    const deltaLap = Math.max(1, last.lap - first.lap)
    const slope = (last.wear - first.wear) / deltaLap
    if (Number.isFinite(slope) && slope > 0.003) return Math.min(0.08, slope)
  }

  const normalized = (compound ?? '').toUpperCase()
  if (normalized.includes('SOFT') || normalized === 'C5' || normalized === 'C4') return 0.028
  if (normalized.includes('MEDIUM') || normalized === 'C3') return 0.021
  if (normalized.includes('HARD') || normalized === 'C2' || normalized === 'C1') return 0.016
  return 0.02
}

function wearPenaltyMs(wear: number, compound: string): number {
  const normalized = Math.max(0, Math.min(1, wear))
  const compoundBias = compound.toUpperCase().includes('SOFT') || compound === 'C5' || compound === 'C4' ? 1.12 : compound.toUpperCase().includes('HARD') || compound === 'C1' || compound === 'C2' ? 0.88 : 1
  const basePenalty = normalized * 1900 + normalized * normalized * 2600
  const cliffPenalty = normalized > CLIFF_THRESHOLD ? (normalized - CLIFF_THRESHOLD) * 10_000 : 0
  return (basePenalty + cliffPenalty) * compoundBias
}

function nextCompound(current: string | undefined): string {
  const normalized = (current ?? '').toUpperCase()
  if (normalized.includes('SOFT') || normalized === 'C5' || normalized === 'C4') return 'MEDIUM'
  if (normalized.includes('MEDIUM') || normalized === 'C3') return 'HARD'
  return 'HARD'
}

function recommendationLabel(call: StrategyCall): string {
  if (call === 'BOX_THIS_LAP') return 'BOX THIS LAP'
  if (call === 'PIT_IN_2') return 'PIT IN 2 LAPS'
  if (call === 'PIT_IN_4') return 'PIT IN 4 LAPS'
  return 'STAY OUT'
}

function formatMs(ms: number): string {
  const sign = ms > 0 ? '+' : ''
  return `${sign}${(ms / 1000).toFixed(2)}s`
}

function getTrafficClusterCount(state: AppState): number {
  const metrics = buildGapMetrics(state.leaderboard ?? [])
  let count = 0
  metrics.forEach((metric) => {
    if (metric.intervalAhead > 0 && metric.intervalAhead <= 1.6) count += 1
  })
  return count
}

function getPitLossMs(state: AppState): number {
  const raw = Number(state.strategy?.key_inputs?.pit_loss_est_s)
  let base = Number.isFinite(raw) ? raw * 1000 : DEFAULT_PIT_LOSS_MS
  const race = (state.race_control_state ?? '').toUpperCase()
  if (race.includes('VSC')) base *= 0.65
  if (race.includes('SC')) base *= 0.45
  return base
}

function buildRivalModels(state: AppState, history: TyreHistory, horizon: number, baseLapMs: number): RivalModel[] {
  const rows = state.leaderboard ?? []
  return rows.map((row) => {
    const rivalHistory = history[row.car_index] ?? []
    const rivalWear = latestWear(rivalHistory, row.tyre_wear_pct)
    const rivalSlope = estimateWearSlope(rivalHistory, row.tyre_compound)
    let total = 0
    let wear = rivalWear
    for (let lapIndex = 0; lapIndex < horizon; lapIndex += 1) {
      const lapTime = (row.last_lap_ms || baseLapMs) + wearPenaltyMs(wear, row.tyre_compound)
      total += lapTime
      wear = Math.min(1, wear + rivalSlope)
    }
    return {
      carIndex: row.car_index,
      initialGapMs: Math.round((row.gap_to_player_s || 0) * 1000),
      projectedTimeMs: total,
    }
  })
}

function getProjectedPosition(playerTimeMs: number, rivals: RivalModel[]): { projectedPosition: number; projectedRejoinPosition: number } {
  const projectedGaps = rivals.map((rival) => ({
    carIndex: rival.carIndex,
    gapMs: rival.initialGapMs + (rival.projectedTimeMs - playerTimeMs),
  }))
  const aheadCount = projectedGaps.filter((entry) => entry.gapMs < 0).length
  const rejoinCount = projectedGaps.filter((entry) => entry.gapMs < -1500).length
  return {
    projectedPosition: aheadCount + 1,
    projectedRejoinPosition: rejoinCount + 1,
  }
}

function trafficRiskFromRejoin(rejoinPosition: number, currentPosition: number, clusterCount: number): StrategyScenario['trafficRisk'] {
  const positionLoss = Math.max(0, rejoinPosition - currentPosition)
  if (positionLoss >= 4 || clusterCount >= 5) return 'high'
  if (positionLoss >= 2 || clusterCount >= 3) return 'medium'
  return 'low'
}

function buildScenarioNotes(call: StrategyCall, pitOffset: number | null, targetCompound: string, cliffLap: number | null, currentLap: number, trafficRisk: StrategyScenario['trafficRisk']): string[] {
  const notes: string[] = []
  if (pitOffset === null) {
    notes.push('트랙 포지션 유지, 피트 손실 없음')
  } else {
    notes.push(`${pitOffset === 0 ? '즉시' : `${pitOffset}랩 후`} 피트, ${targetCompound} 전환 가정`)
  }
  if (cliffLap !== null) {
    notes.push(`현 타이어 클리프 예상 L${cliffLap.toFixed(1)} (현재 L${currentLap})`)
  }
  notes.push(trafficRisk === 'high' ? '리조인 후 고밀도 트래픽 예상' : trafficRisk === 'medium' ? '중간 수준 트래픽 예상' : '클린 에어 가능성 높음')
  if (call === 'BOX_THIS_LAP') notes.push('언더컷 창을 즉시 활용하는 보수적 콜')
  return notes
}

function clampHorizon(state: AppState): number {
  const lapsRemaining = Math.max(3, (state.total_laps || 0) - (state.player.lap || 0))
  return Math.max(3, Math.min(10, lapsRemaining))
}

export function buildStrategyEngineOutput(state: AppState | null, history: TyreHistory): StrategyEngineOutput | null {
  if (!state || !state.leaderboard?.length) return null

  // Fast-path: skip full recomputation when inputs haven't materially changed
  const cacheKey = stratCacheKey(state, history)
  if (cacheKey === _lastCacheKey && _lastOutput) return _lastOutput

  const currentLap = state.player.lap || 0
  const currentPosition = state.player.position ?? 20
  const baseLapMs = state.pace.avg_lap_ms || state.player.current_lap_ms || state.player.last_lap_ms || 95_000
  const horizon = clampHorizon(state)
  const playerHistory = history[state.player_car_index] ?? []
  const currentWear = latestWear(playerHistory, state.leaderboard.find((row) => row.car_index === state.player_car_index)?.tyre_wear_pct)
  const currentCompound = state.player.tyre_compound || state.leaderboard.find((row) => row.car_index === state.player_car_index)?.tyre_compound || 'MEDIUM'
  const currentSlope = estimateWearSlope(playerHistory, currentCompound)
  const predictedCliff = predictCliffLap(state.player_car_index, playerHistory, CLIFF_THRESHOLD)
  const pitLossMs = getPitLossMs(state)
  const trafficClusters = getTrafficClusterCount(state)
  const rivalModels = buildRivalModels(state, history, horizon, baseLapMs)
  const undercutWindows = analyzeUndercutWindows(state, history, CLIFF_THRESHOLD)

  const scenarioSpecs: Array<{ id: StrategyCall; pitOffset: number | null }> = [
    { id: 'BOX_THIS_LAP', pitOffset: 0 },
    { id: 'STAY_OUT', pitOffset: null },
    { id: 'PIT_IN_2', pitOffset: horizon >= 4 ? 2 : null },
    { id: 'PIT_IN_4', pitOffset: horizon >= 6 ? 4 : null },
  ].filter((scenario): scenario is { id: StrategyCall; pitOffset: number | null } => scenario.id === 'STAY_OUT' || scenario.pitOffset !== null)

  const scenarios = scenarioSpecs.map((spec) => {
    const targetCompound = spec.pitOffset === null ? currentCompound : nextCompound(currentCompound)
    let totalMs = 0
    let wear = currentWear
    let compound = currentCompound
    let currentGapAheadMs = Math.round((state.leaderboard.find((row) => row.position === Math.max(1, currentPosition - 1))?.gap_to_player_s ?? -1.8) * 1000)
    let currentGapBehindMs = Math.round((state.leaderboard.find((row) => row.position === currentPosition + 1)?.gap_to_player_s ?? 1.8) * 1000)
    const laps: StrategySimulationLap[] = []

    for (let lapIndex = 0; lapIndex < horizon; lapIndex += 1) {
      if (spec.pitOffset !== null && lapIndex === spec.pitOffset) {
        totalMs += pitLossMs
        compound = targetCompound
        wear = 0.08
        currentGapAheadMs += pitLossMs
        currentGapBehindMs -= pitLossMs
      }

      const slope = spec.pitOffset !== null && lapIndex >= spec.pitOffset ? estimateWearSlope(undefined, compound) : currentSlope
      const warmupPenalty = spec.pitOffset !== null && lapIndex === spec.pitOffset ? 900 : 0
      const trafficPenalty = currentGapAheadMs < 1300 && currentGapAheadMs > 0 ? 750 : currentGapBehindMs > -1100 && currentGapBehindMs < 0 ? 420 : 0
      const lapTimeMs = Math.round(baseLapMs + wearPenaltyMs(wear, compound) + warmupPenalty + trafficPenalty)
      totalMs += lapTimeMs
      currentGapAheadMs += Math.round(lapTimeMs - baseLapMs)
      currentGapBehindMs -= Math.round((lapTimeMs - baseLapMs) * 0.6)

      laps.push({
        lap: currentLap + lapIndex + 1,
        tyreWear: wear,
        lapTimeMs,
        gapAheadMs: Number.isFinite(currentGapAheadMs) ? currentGapAheadMs : null,
        gapBehindMs: Number.isFinite(currentGapBehindMs) ? currentGapBehindMs : null,
      })

      wear = Math.min(1, wear + slope)
    }

    const { projectedPosition, projectedRejoinPosition } = getProjectedPosition(totalMs, rivalModels)
    const trafficRisk = trafficRiskFromRejoin(projectedRejoinPosition, currentPosition, trafficClusters)
    const notes = buildScenarioNotes(spec.id, spec.pitOffset, targetCompound, predictedCliff?.cliffLap ?? null, currentLap, trafficRisk)

    return {
      id: spec.id,
      label: recommendationLabel(spec.id),
      pitOffset: spec.pitOffset,
      targetCompound,
      projectedPosition,
      projectedRejoinPosition,
      projectedNetMs: totalMs,
      expectedGainMs: 0,
      trafficRisk,
      confidence: Math.max(0.42, Math.min(0.94, (predictedCliff?.confidence ?? 0.55) - (trafficRisk === 'high' ? 0.12 : 0))),
      notes,
      laps,
    } satisfies StrategyScenario
  })

  const baseline = scenarios.find((scenario) => scenario.id === 'STAY_OUT') ?? scenarios[0]
  const scoredScenarios = scenarios.map((scenario) => {
    const positionDelta = baseline.projectedPosition - scenario.projectedPosition
    const trafficPenalty = scenario.trafficRisk === 'high' ? 2200 : scenario.trafficRisk === 'medium' ? 900 : 0
    const undercutBonus = scenario.id === 'BOX_THIS_LAP' && undercutWindows.length > 0 ? 1500 : 0
    const cliffBonus = scenario.pitOffset !== null && predictedCliff && predictedCliff.cliffLap <= currentLap + scenario.pitOffset + 1 ? 2800 : 0
    const expectedGainMs = Math.round((baseline.projectedNetMs - scenario.projectedNetMs) + positionDelta * 2600 + undercutBonus + cliffBonus - trafficPenalty)
    return {
      ...scenario,
      expectedGainMs,
    }
  }).sort((a, b) => b.expectedGainMs - a.expectedGainMs)

  const best = scoredScenarios[0]
  const second = scoredScenarios[1]
  const recommendation: StrategyRecommendation = {
    call: best.id,
    headline: best.label,
    subline: `Projected P${best.projectedPosition} · rejoin P${best.projectedRejoinPosition} · ${best.targetCompound}`,
    tone: best.expectedGainMs > 1800 ? 'gain' : best.id === 'STAY_OUT' ? 'hold' : 'warn',
    confidence: Math.max(0.35, Math.min(0.96, best.confidence + Math.min(0.14, Math.max(0, best.expectedGainMs / 12_000)))),
  }

  const decisionLog: DecisionLogEntry[] = [
    {
      label: 'Tyre Cliff',
      value: predictedCliff ? `L${predictedCliff.cliffLap.toFixed(1)} / slope ${(predictedCliff.slopePerLap * 100).toFixed(2)}% per lap` : '데이터 부족',
      tone: predictedCliff && predictedCliff.cliffLap <= currentLap + 2 ? 'warning' : 'neutral',
    },
    {
      label: 'Undercut Window',
      value: undercutWindows[0] ? `#${undercutWindows[0].rivalCarIndex} vs ${undercutWindows[0].reason}` : '즉시 활용 가능한 창 없음',
      tone: undercutWindows[0] ? 'positive' : 'neutral',
    },
    {
      label: 'Traffic Field',
      value: `${trafficClusters} cluster(s) within 1.6s intervals`,
      tone: trafficClusters >= 4 ? 'warning' : 'neutral',
    },
    {
      label: 'Pit Delta',
      value: `${(pitLossMs / 1000).toFixed(1)}s estimated ${state.race_control_state?.includes('SC') || state.race_control_state?.includes('VSC') ? '(discounted)' : ''}`,
      tone: pitLossMs < DEFAULT_PIT_LOSS_MS ? 'positive' : 'neutral',
    },
    {
      label: 'Decision Edge',
      value: second ? `${best.label} vs ${second.label}: ${formatMs(best.expectedGainMs - second.expectedGainMs)}` : formatMs(best.expectedGainMs),
      tone: best.expectedGainMs > 0 ? 'positive' : 'warning',
    },
  ]

  const executionChecklist: StrategyExecutionItem[] = best.id === 'STAY_OUT'
    ? [
        { step: 'Push to Delta', detail: '클리프 전까지 현재 타이어로 목표 델타 유지' },
        { step: 'Monitor Rival Pit', detail: '앞차 박스 여부와 언더컷 대응창 감시' },
        { step: 'Prepare Next Call', detail: '2랩 내 재평가를 위해 트래픽/세이프티카 상태 유지' },
      ]
    : [
        { step: 'Confirm Box Call', detail: `${best.pitOffset === 0 ? '이번 랩' : `${best.pitOffset}랩 후`} 피트 준비 및 타깃 컴파운드 ${best.targetCompound}` },
        { step: 'Protect In-Lap / Out-Lap', detail: '인랩 손실 최소화 및 아웃랩 워밍업 관리' },
        { step: 'Rejoin Traffic Gate', detail: `예상 리조인 P${best.projectedRejoinPosition}, 클러스터 회피 여부 재확인` },
      ]

  const result: StrategyEngineOutput = {
    recommendation,
    scenarios: scoredScenarios,
    decisionLog,
    executionChecklist,
    undercutWindows,
    simulationHorizon: horizon,
  }

  _lastCacheKey = cacheKey
  _lastOutput = result
  return result
}