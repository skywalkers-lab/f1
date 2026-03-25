import { useMemo } from 'react'
import { AppState } from '../lib/types'
import { TyreHistory, TyreWearPoint } from '../lib/tyreHistoryManager'
import { predictCliffLap, WearPrediction } from '../lib/wearPrediction'
import { analyzeUndercutWindows } from '../lib/undercutAnalyzer'

type Tone = 'ok' | 'watch' | 'critical'
type ActionCall = 'BOX NOW' | 'BOX IN 1 LAP' | 'HOLD' | 'UNDERCUT THREAT'
type ScenarioId = 'pre-cliff' | 'cliff-edge' | 'post-cliff'
type RivalRole = 'ahead-cover' | 'behind-threat' | 'undercut-target' | 'player'

type CliffEnsemble = {
  carIndex: number
  meanCliffLap: number
  lowLap: number
  highLap: number
  confidencePct: number
  slopePerLap: number
  sampleCount: number
}

type StrategyScenario = {
  id: ScenarioId
  label: string
  pitLap: number
  expectedLossS: number
  projectedTrackDelta: number
  summary: string
  tone: Tone
}

type SelectionReason = {
  carIndex: number
  reason: string
  role: RivalRole
  score: number
}

type EnrichedWindow = {
  rivalCarIndex: number
  startLap: number
  endLap: number
  opportunityScore: number
  successProbabilityPct: number
  expectedGainS: number
  failureLossS: number
  triggerConditions: string[]
  reason: string
}

type GraphPitMarker = {
  carIndex: number
  lap: number
  label: string
  tone: Tone
}

type GraphCrossoverMarker = {
  rivalCarIndex: number
  lap: number
  gainS: number
  kind: 'undercut' | 'overcut'
}

export type TyreStrategyAnalysis = {
  ready: boolean
  actionSignal: {
    call: ActionCall
    headline: string
    rationale: string
    tone: Tone
  }
  playerPrediction: CliffEnsemble | null
  predictions: Record<number, CliffEnsemble>
  selection: {
    highlightedIds: number[]
    fadedIds: number[]
    reasons: SelectionReason[]
  }
  scenarios: {
    player: StrategyScenario[]
    rivals: Array<{
      carIndex: number
      role: RivalRole
      scenarios: StrategyScenario[]
    }>
  }
  undercutWindows: EnrichedWindow[]
  graph: {
    highlightedIds: number[]
    fadedIds: number[]
    pitMarkers: GraphPitMarker[]
    crossovers: GraphCrossoverMarker[]
  }
  decisionLog: Array<{
    label: string
    value: string
    tone: Tone
  }>
}

const EMPTY_ANALYSIS: TyreStrategyAnalysis = {
  ready: false,
  actionSignal: {
    call: 'HOLD',
    headline: '-',
    rationale: '-',
    tone: 'watch',
  },
  playerPrediction: null,
  predictions: {},
  selection: {
    highlightedIds: [],
    fadedIds: [],
    reasons: [],
  },
  scenarios: {
    player: [],
    rivals: [],
  },
  undercutWindows: [],
  graph: {
    highlightedIds: [],
    fadedIds: [],
    pitMarkers: [],
    crossovers: [],
  },
  decisionLog: [],
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function latestPoint(points: TyreWearPoint[]): TyreWearPoint | null {
  return points.length > 0 ? points[points.length - 1] : null
}

function regressionSlope(points: TyreWearPoint[]): number {
  const sample = points.slice(-8)
  if (sample.length < 2) return 0
  const n = sample.length
  let sumX = 0
  let sumY = 0
  let sumXY = 0
  let sumXX = 0
  for (const point of sample) {
    sumX += point.lap
    sumY += point.wear
    sumXY += point.lap * point.wear
    sumXX += point.lap * point.lap
  }
  const denom = n * sumXX - sumX * sumX
  if (Math.abs(denom) < 1e-6) return 0
  return Math.max(0, (n * sumXY - sumX * sumY) / denom)
}

function estimateConfidenceInterval(carIndex: number, points: TyreWearPoint[], cliffThreshold: number): CliffEnsemble | null {
  if (points.length < 3) return null
  const windows = [6, 8, 10]
  const predictions = windows
    .map((lookback) => predictCliffLap(carIndex, points.slice(-lookback), cliffThreshold, lookback))
    .filter((prediction): prediction is WearPrediction => Boolean(prediction))

  if (predictions.length === 0) return null

  const laps = predictions.map((prediction) => prediction.cliffLap)
  const meanCliffLap = laps.reduce((sum, lap) => sum + lap, 0) / laps.length
  const lowLap = Math.min(...laps)
  const highLap = Math.max(...laps)
  const slopePerLap = predictions.reduce((sum, prediction) => sum + prediction.slopePerLap, 0) / predictions.length
  const baseConfidence = predictions.reduce((sum, prediction) => sum + prediction.confidence, 0) / predictions.length
  const spreadPenalty = Math.min(0.24, Math.abs(highLap - lowLap) * 0.05)
  const confidencePct = Math.round(clamp((baseConfidence - spreadPenalty) * 100, 18, 97))

  return {
    carIndex,
    meanCliffLap: Number(meanCliffLap.toFixed(1)),
    lowLap: Number(lowLap.toFixed(1)),
    highLap: Number(highLap.toFixed(1)),
    confidencePct,
    slopePerLap,
    sampleCount: points.slice(-10).length,
  }
}

function compoundWarmupPenalty(compound: string | undefined): number {
  const value = String(compound ?? '').toUpperCase()
  if (value.includes('SOFT') || value === 'C5' || value === 'C4') return 0.65
  if (value.includes('MEDIUM') || value === 'C3') return 0.9
  return 1.2
}

function wearPenaltySeconds(wear: number, slopePerLap: number): number {
  return wear * 7.6 + slopePerLap * 130
}

function buildScenarioTree(params: {
  currentLap: number
  currentWear: number
  slopePerLap: number
  predictedCliff: CliffEnsemble | null
  gapToPlayerS: number
  position: number
  compound: string | undefined
}): StrategyScenario[] {
  const cliffLap = params.predictedCliff ? Math.round(params.predictedCliff.meanCliffLap) : params.currentLap + 3
  const baselineWearPenalty = wearPenaltySeconds(params.currentWear, params.slopePerLap)
  const pitLoss = 21.5
  const scenarios: Array<{ id: ScenarioId; label: string; pitLap: number; waitLaps: number }> = [
    { id: 'pre-cliff', label: '클리프 이전 피트', pitLap: Math.max(params.currentLap, cliffLap - 1), waitLaps: Math.max(0, cliffLap - params.currentLap - 1) },
    { id: 'cliff-edge', label: '클리프 직후 피트', pitLap: Math.max(params.currentLap, cliffLap), waitLaps: Math.max(0, cliffLap - params.currentLap) },
    { id: 'post-cliff', label: '클리프 이후 버티기', pitLap: Math.max(params.currentLap + 1, cliffLap + 2), waitLaps: Math.max(1, cliffLap - params.currentLap + 2) },
  ]

  return scenarios.map((scenario) => {
    const waitWear = params.currentWear + params.slopePerLap * scenario.waitLaps
    const cliffPenalty = scenario.id === 'post-cliff' ? 2.2 : scenario.id === 'cliff-edge' ? 0.9 : 0.1
    const expectedLossS = Number((pitLoss + baselineWearPenalty + waitWear * 5.4 + cliffPenalty + compoundWarmupPenalty(params.compound)).toFixed(1))
    const projectedTrackDelta = Math.round((params.gapToPlayerS - expectedLossS) / 2.4)
    const tone: Tone = scenario.id === 'pre-cliff' ? 'ok' : scenario.id === 'cliff-edge' ? 'watch' : 'critical'

    return {
      id: scenario.id,
      label: scenario.label,
      pitLap: scenario.pitLap,
      expectedLossS,
      projectedTrackDelta,
      summary: `Loss ${expectedLossS.toFixed(1)}s · ΔPos ${projectedTrackDelta >= 0 ? '+' : ''}${projectedTrackDelta}`,
      tone,
    }
  })
}

function computeSelection(state: AppState, history: TyreHistory, predictions: Record<number, CliffEnsemble>, enrichedWindows: EnrichedWindow[]) {
  const rows = [...state.leaderboard].sort((a, b) => a.position - b.position)
  const playerIndex = state.player_car_index
  const playerRow = rows.find((row) => row.car_index === playerIndex)
  if (!playerRow) {
    return { highlightedIds: [], fadedIds: [], reasons: [] as SelectionReason[] }
  }

  const reasons: SelectionReason[] = [
    { carIndex: playerIndex, reason: '플레이어 기준 전략 기준선', role: 'player', score: 999 },
  ]

  rows.forEach((row) => {
    if (row.car_index === playerIndex) return
    const gapAbs = Math.abs(row.gap_to_player_s)
    const prediction = predictions[row.car_index]
    const playerPrediction = predictions[playerIndex]
    let score = 0
    let role: RivalRole = row.position < playerRow.position ? 'ahead-cover' : 'behind-threat'
    let reason = row.position < playerRow.position ? '앞차 전략 커버 대상' : '후방 언더컷 위협'

    if (gapAbs <= 3.2) score += 55 - gapAbs * 9
    if (row.position < playerRow.position) score += 16
    else score += 12
    if (prediction && playerPrediction) {
      const cliffDelta = prediction.meanCliffLap - playerPrediction.meanCliffLap
      score += Math.max(0, 18 - Math.abs(cliffDelta) * 5)
      if (row.position < playerRow.position && cliffDelta <= 1.2) {
        role = 'ahead-cover'
        reason = '앞차와 클리프 시점 근접, 커버 필요'
      }
      if (row.position > playerRow.position && cliffDelta < -0.6) {
        role = 'behind-threat'
        reason = '뒤차 클리프 여유 우세, 언더컷 위협'
      }
    }

    const windowHit = enrichedWindows.find((window) => window.rivalCarIndex === row.car_index)
    if (windowHit) {
      score += windowHit.opportunityScore * 0.7
      role = 'undercut-target'
      reason = `언더컷 윈도우 활성 (${windowHit.successProbabilityPct}% 성공 확률)`
    }

    if (score >= 18) reasons.push({ carIndex: row.car_index, reason, role, score: Number(score.toFixed(1)) })
  })

  const sorted = reasons.sort((a, b) => b.score - a.score)
  const highlightedIds = sorted.slice(0, 6).map((item) => item.carIndex)
  const allIds = rows.map((row) => row.car_index)
  const fadedIds = allIds.filter((id) => !highlightedIds.includes(id))

  return {
    highlightedIds,
    fadedIds,
    reasons: sorted.slice(0, 6),
  }
}

function enrichWindows(state: AppState, history: TyreHistory, cliffThreshold: number, predictions: Record<number, CliffEnsemble>): EnrichedWindow[] {
  const base = analyzeUndercutWindows(state, history, cliffThreshold)
  const playerPrediction = predictions[state.player_car_index]

  return base.map((window) => {
    const rivalPrediction = predictions[window.rivalCarIndex]
    const gapToRival = Math.abs(state.leaderboard.find((row) => row.car_index === window.rivalCarIndex)?.gap_to_player_s ?? 0)
    const cliffAdvantage = playerPrediction && rivalPrediction ? rivalPrediction.meanCliffLap - playerPrediction.meanCliffLap : 0
    const successProbabilityPct = Math.round(
      clamp(
        48 + window.score * 22 + cliffAdvantage * 10 - gapToRival * 8 + (playerPrediction?.confidencePct ?? 45) * 0.12,
        12,
        92,
      ),
    )
    const expectedGainS = Number((window.score * 1.65 + Math.max(0, cliffAdvantage) * 0.42).toFixed(2))
    const failureLossS = Number((Math.max(0.8, gapToRival * 0.55 + (successProbabilityPct < 50 ? 1.4 : 0.75))).toFixed(2))
    const triggerConditions = [
      `traffic gap > ${(gapToRival + 0.8).toFixed(1)}s 확보`,
      `tyre delta 유지 (${Math.max(0.3, cliffAdvantage).toFixed(1)} lap advantage)`,
      successProbabilityPct < 55 ? '아웃랩 워밍업 손실 관리 필요' : '인랩 손실 최소화 시 즉시 실행 가능',
    ]

    return {
      rivalCarIndex: window.rivalCarIndex,
      startLap: Number(window.startLap.toFixed(1)),
      endLap: Number(window.endLap.toFixed(1)),
      opportunityScore: Number((window.score * 100).toFixed(0)),
      successProbabilityPct,
      expectedGainS,
      failureLossS,
      triggerConditions,
      reason: window.reason,
    }
  }).sort((a, b) => b.opportunityScore - a.opportunityScore)
}

function buildCrossovers(player: CliffEnsemble | null, selectionReasons: SelectionReason[], predictions: Record<number, CliffEnsemble>): GraphCrossoverMarker[] {
  if (!player) return []
  return selectionReasons
    .filter((item) => item.role !== 'player')
    .slice(0, 4)
    .map((item) => {
      const rival = predictions[item.carIndex]
      if (!rival) return null
      const lap = Number(((player.meanCliffLap + rival.meanCliffLap) / 2).toFixed(1))
      const gainS = Number(((rival.meanCliffLap - player.meanCliffLap) * 0.48).toFixed(2))
      return {
        rivalCarIndex: item.carIndex,
        lap,
        gainS,
        kind: gainS >= 0 ? 'undercut' : 'overcut',
      }
    })
    .filter((item): item is GraphCrossoverMarker => Boolean(item))
}

function buildActionSignal(params: {
  currentLap: number
  playerPrediction: CliffEnsemble | null
  windows: EnrichedWindow[]
  playerScenarios: StrategyScenario[]
  state: AppState
}): TyreStrategyAnalysis['actionSignal'] {
  const topWindow = params.windows[0]
  const preCliff = params.playerScenarios.find((scenario) => scenario.id === 'pre-cliff')
  const cliffEdge = params.playerScenarios.find((scenario) => scenario.id === 'cliff-edge')
  const playerWear = Number(params.state.leaderboard.find((row) => row.car_index === params.state.player_car_index)?.tyre_wear_pct ?? 0)

  if (topWindow && topWindow.successProbabilityPct >= 70 && topWindow.startLap <= params.currentLap + 1) {
    return {
      call: 'BOX NOW',
      headline: '언더컷 실행 가능: 즉시 박스 콜 우세',
      rationale: `#${topWindow.rivalCarIndex} 대상 gain ${topWindow.expectedGainS.toFixed(2)}s, 성공 확률 ${topWindow.successProbabilityPct}%`,
      tone: 'critical',
    }
  }

  if (params.playerPrediction && params.playerPrediction.meanCliffLap <= params.currentLap + 1.2) {
    return {
      call: 'BOX NOW',
      headline: '클리프 임박: 즉시 피트 필요',
      rationale: `예상 클리프 L${params.playerPrediction.meanCliffLap.toFixed(1)} (${params.playerPrediction.lowLap.toFixed(1)}-${params.playerPrediction.highLap.toFixed(1)})`,
      tone: 'critical',
    }
  }

  if (topWindow && topWindow.successProbabilityPct >= 56) {
    return {
      call: 'BOX IN 1 LAP',
      headline: '언더컷 준비: 다음 랩 실행 권장',
      rationale: `조건: ${topWindow.triggerConditions[0]} / 실패 손실 ${topWindow.failureLossS.toFixed(2)}s`,
      tone: 'watch',
    }
  }

  if (topWindow && topWindow.successProbabilityPct < 50 && playerWear < 62) {
    return {
      call: 'UNDERCUT THREAT',
      headline: '상대 선피트 위협 감시',
      rationale: `#${topWindow.rivalCarIndex} 대응 필요, 윈도우 ${topWindow.startLap.toFixed(1)}-${topWindow.endLap.toFixed(1)}`,
      tone: 'watch',
    }
  }

  return {
    call: 'HOLD',
    headline: '현재 스틴트 유지 가능',
    rationale: preCliff && cliffEdge ? `${preCliff.summary} vs ${cliffEdge.summary}` : '추가 데이터 수집 중',
    tone: 'ok',
  }
}

export function useTyreStrategyAnalysis(state: AppState | null, history: TyreHistory): TyreStrategyAnalysis {
  return useMemo(() => {
    if (!state) return EMPTY_ANALYSIS

    const rows = [...state.leaderboard].sort((a, b) => a.position - b.position)
    const currentLap = Number.isFinite(state.player.lap) ? Number(state.player.lap) : 0
    const cliffThreshold = 0.78

    const predictions: Record<number, CliffEnsemble> = {}
    rows.forEach((row) => {
      const points = (history[row.car_index] ?? []).slice(-10)
      const ensemble = estimateConfidenceInterval(row.car_index, points, cliffThreshold)
      if (ensemble) predictions[row.car_index] = ensemble
    })

    const playerPrediction = predictions[state.player_car_index] ?? null
    const windows = enrichWindows(state, history, cliffThreshold, predictions)
    const selection = computeSelection(state, history, predictions, windows)

    const playerRow = rows.find((row) => row.car_index === state.player_car_index)
    if (!playerRow) return EMPTY_ANALYSIS

    const playerHistory = history[state.player_car_index] ?? []
    const playerLatest = latestPoint(playerHistory)
    const playerCurrentWear = (playerLatest?.wear ?? clamp(Number(playerRow.tyre_wear_pct ?? 0) / 100, 0, 1))
    const rawPlayerSlope = regressionSlope(playerHistory)
    const playerSlope = rawPlayerSlope > 0 ? rawPlayerSlope : 0.036
    const playerScenarios = buildScenarioTree({
      currentLap,
      currentWear: playerCurrentWear,
      slopePerLap: playerSlope,
      predictedCliff: playerPrediction,
      gapToPlayerS: 0,
      position: playerRow.position,
      compound: playerRow.tyre_compound,
    })

    const rivalScenarioRows = selection.reasons
      .filter((item) => item.role !== 'player')
      .slice(0, 3)
      .map((item) => {
        const row = rows.find((candidate) => candidate.car_index === item.carIndex)
        const points = history[item.carIndex] ?? []
        const latest = latestPoint(points)
        const currentWear = latest?.wear ?? clamp(Number(row?.tyre_wear_pct ?? 0) / 100, 0, 1)
        const rawSlope = regressionSlope(points)
        const slope = rawSlope > 0 ? rawSlope : 0.032
        return {
          carIndex: item.carIndex,
          role: item.role,
          scenarios: buildScenarioTree({
            currentLap,
            currentWear,
            slopePerLap: slope,
            predictedCliff: predictions[item.carIndex] ?? null,
            gapToPlayerS: Math.abs(Number(row?.gap_to_player_s ?? 0)),
            position: Number(row?.position ?? 0),
            compound: row?.tyre_compound,
          }),
        }
      })

    const graphPitMarkers: GraphPitMarker[] = [
      ...playerScenarios.map((scenario) => ({
        carIndex: state.player_car_index,
        lap: scenario.pitLap,
        label: scenario.label,
        tone: scenario.tone,
      })),
      ...rivalScenarioRows.flatMap((rival) =>
        rival.scenarios.slice(0, 1).map((scenario) => ({
          carIndex: rival.carIndex,
          lap: scenario.pitLap,
          label: scenario.label,
          tone: scenario.tone,
        })),
      ),
    ]

    const crossovers = buildCrossovers(playerPrediction, selection.reasons, predictions)
    const actionSignal = buildActionSignal({
      currentLap,
      playerPrediction,
      windows,
      playerScenarios,
      state,
    })

    const decisionLog: TyreStrategyAnalysis['decisionLog'] = [
      {
        label: 'Player Cliff CI',
        value: playerPrediction ? `L${playerPrediction.meanCliffLap.toFixed(1)} (${playerPrediction.lowLap.toFixed(1)}-${playerPrediction.highLap.toFixed(1)})` : '데이터 부족',
        tone: playerPrediction && playerPrediction.confidencePct >= 65 ? 'ok' : 'watch',
      },
      {
        label: 'Slope Edge',
        value: `${(playerSlope * 100).toFixed(2)}%/lap vs rival top ${selection.reasons.find((item) => item.role !== 'player') ? `#${selection.reasons.find((item) => item.role !== 'player')?.carIndex}` : '-'}`,
        tone: playerSlope >= 0.045 ? 'critical' : playerSlope >= 0.032 ? 'watch' : 'ok',
      },
      {
        label: 'Best Window',
        value: windows[0] ? `#${windows[0].rivalCarIndex} gain ${windows[0].expectedGainS.toFixed(2)}s / risk ${windows[0].failureLossS.toFixed(2)}s` : '실행 가능 윈도우 없음',
        tone: windows[0] && windows[0].successProbabilityPct >= 65 ? 'ok' : 'watch',
      },
      {
        label: 'Decision',
        value: actionSignal.call,
        tone: actionSignal.tone,
      },
    ]

    return {
      ready: true,
      actionSignal,
      playerPrediction,
      predictions,
      selection,
      scenarios: {
        player: playerScenarios,
        rivals: rivalScenarioRows,
      },
      undercutWindows: windows,
      graph: {
        highlightedIds: selection.highlightedIds,
        fadedIds: selection.fadedIds,
        pitMarkers: graphPitMarkers,
        crossovers,
      },
      decisionLog,
    }
  }, [state, history])
}
