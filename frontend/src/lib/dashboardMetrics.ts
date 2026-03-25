import { AppState } from './types'

export type FeedHealth = {
  score: number
  tone: 'good' | 'warn' | 'critical'
  label: string
}

export type FuelWindow = {
  lapsLeft: number
  fuelPerLap: number
  marginLaps: number
  tone: 'safe' | 'watch' | 'critical'
}

export type DataReliability = {
  systemReliability: number
  freshnessScore: number
  tone: 'good' | 'warn' | 'critical'
  label: string
  confidenceModifier: number
}

export type FuelRiskLevel = {
  score: number
  tone: 'safe' | 'watch' | 'critical'
  pushAllowed: boolean
  saveRequired: boolean
  riskAllowance: 'high' | 'medium' | 'low'
  summary: string
}

export type PaceStability = {
  score: number
  tone: 'good' | 'warn' | 'critical'
  tyreDegImpact: number
  trafficImpact: number
  consistencyImpact: number
  summary: string
}

export type StrategyConfidenceState = {
  score: number
  tone: 'good' | 'warn' | 'critical'
  decisionEdge: number
  conservativeRequired: boolean
  summary: string
}

export type RecommendedActionState = {
  call: 'PUSH' | 'HOLD' | 'SAVE' | 'BOX'
  tone: 'good' | 'warn' | 'critical'
  rationale: string
}

export type OverallHealth = {
  score: number
  tone: 'good' | 'warn' | 'critical'
  label: string
}

export type RaceStateSnapshot = {
  overallHealth: OverallHealth
  dataReliability: DataReliability
  strategyConfidence: StrategyConfidenceState
  fuelRiskLevel: FuelRiskLevel
  paceStability: PaceStability
  recommendedActionState: RecommendedActionState
  feedHealth: FeedHealth
  fuelWindow: FuelWindow
  stateAgeMs: number | null
  connectionTone: 'live' | 'stale' | 'down'
  sessionProgressPct: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function toneFromScore(score: number): 'good' | 'warn' | 'critical' {
  if (score >= 72) return 'good'
  if (score >= 45) return 'warn'
  return 'critical'
}

function labelFromTone(tone: 'good' | 'warn' | 'critical'): string {
  if (tone === 'good') return 'STABLE'
  if (tone === 'warn') return 'WATCH'
  return 'DEGRADED'
}

export function getStateAgeMs(state: AppState | null): number | null {
  if (!state?.last_update_iso) return null
  const age = Date.now() - new Date(state.last_update_iso).getTime()
  return Number.isFinite(age) && age >= 0 ? age : null
}

export function formatStateAge(ageMs: number | null): string {
  if (ageMs === null) return '-'
  if (ageMs < 1000) return `${ageMs}ms`
  if (ageMs < 60_000) return `${(ageMs / 1000).toFixed(1)}s`
  return `${(ageMs / 60_000).toFixed(1)}m`
}

export function getFeedHealth(state: AppState | null): FeedHealth {
  const stats = state?.ingest_stats
  if (!stats) {
    return { score: 0, tone: 'critical', label: 'NO FEED' }
  }

  const received = Math.max(1, stats.packets_received ?? stats.packets_decoded ?? 1)
  const outOfOrder = stats.out_of_order_packets ?? 0
  const lossRatio = (stats.packets_dropped + stats.decode_errors + stats.duplicate_packets * 0.5 + outOfOrder * 0.3) / received
  const score = Math.max(0, Math.min(100, Math.round(100 - lossRatio * 100)))

  if (score >= 97) return { score, tone: 'good', label: 'STABLE' }
  if (score >= 90) return { score, tone: 'warn', label: 'WATCH' }
  return { score, tone: 'critical', label: 'DEGRADED' }
}

export function getSessionProgressPct(state: AppState | null): number {
  const lap = state?.player.lap ?? 0
  const totalLaps = state?.total_laps ?? 0
  if (!totalLaps) return 0
  return Math.max(0, Math.min(100, (lap / totalLaps) * 100))
}

export function getFuelWindow(state: AppState | null): FuelWindow {
  const fuel = Math.max(0, state?.player.fuel ?? 0)
  const totalLaps = state?.total_laps ?? 0
  const completedLaps = state?.player.lap ?? 0
  const lapsLeft = Math.max(0, totalLaps - completedLaps)
  // Prefer tracked fuel delta from backend when available
  const trackedDelta = state?.player.fuel_delta_per_lap ?? 0
  const fuelPerLap = trackedDelta > 0.01
    ? trackedDelta
    : lapsLeft > 0 ? fuel / Math.max(lapsLeft, 1) : fuel
  const marginLaps = fuelPerLap > 0.01 ? fuel / fuelPerLap - lapsLeft : 99

  let tone: FuelWindow['tone'] = 'safe'
  if (marginLaps < 0.4) tone = 'critical'
  else if (marginLaps < 1.2) tone = 'watch'

  return {
    lapsLeft,
    fuelPerLap,
    marginLaps,
    tone,
  }
}

export function getStrategyGap(state: AppState | null): number {
  const candidates = state?.strategy.candidates ?? []
  if (candidates.length < 2) return 0
  return Math.max(0, candidates[0].score - candidates[1].score)
}

export function getPaceSpreadMs(state: AppState | null): number {
  const recent = state?.pace.recent ?? []
  if (recent.length < 2) return 0
  const times = recent.map((entry) => entry.lap_time_ms).filter((value) => Number.isFinite(value) && value > 0)
  if (times.length < 2) return 0
  return Math.max(...times) - Math.min(...times)
}

export function getLatestGapToLeaderMs(state: AppState | null): number | null {
  if (!state?.leaderboard?.length) return null
  const leaderRow = state.leaderboard.find((row) => row.position === 1)
  if (!leaderRow) return null
  return Math.round(Math.abs(leaderRow.gap_to_player_s ?? 0) * 1000)
}

export function getConnectionTone(status: string, ageMs: number | null): 'live' | 'stale' | 'down' {
  if (status !== 'connected') return 'down'
  if (ageMs !== null && ageMs > 3500) return 'stale'
  return 'live'
}

function evaluateDataReliability(feedHealth: FeedHealth, connectionTone: 'live' | 'stale' | 'down', ageMs: number | null): DataReliability {
  const freshnessScore =
    connectionTone === 'down'
      ? 0
      : connectionTone === 'stale'
        ? clamp(48 - Math.max(0, ((ageMs ?? 3500) - 3500) / 120), 10, 58)
        : ageMs === null
          ? 78
          : clamp(100 - ageMs / 22, 70, 100)

  const systemReliability = Math.round(feedHealth.score * 0.7 + freshnessScore * 0.3)
  const tone = toneFromScore(systemReliability)
  const confidenceModifier = Number(clamp(systemReliability / 100, 0.28, 1).toFixed(2))

  return {
    systemReliability,
    freshnessScore: Math.round(freshnessScore),
    tone,
    label: tone === 'good' ? 'TRUSTED' : tone === 'warn' ? 'LIMITED' : 'UNRELIABLE',
    confidenceModifier,
  }
}

function evaluateFuelRisk(fuelWindow: FuelWindow): FuelRiskLevel {
  const score = Math.round(clamp(100 - (1.4 - fuelWindow.marginLaps) * 38, 0, 100))
  const tone: FuelRiskLevel['tone'] = fuelWindow.tone

  return {
    score,
    tone,
    pushAllowed: fuelWindow.marginLaps >= 1.3,
    saveRequired: fuelWindow.marginLaps < 0.7,
    riskAllowance: fuelWindow.marginLaps >= 1.5 ? 'high' : fuelWindow.marginLaps >= 0.8 ? 'medium' : 'low',
    summary:
      fuelWindow.marginLaps >= 1.3
        ? '공격 주행 허용'
        : fuelWindow.marginLaps >= 0.7
          ? '연료 관리 병행 필요'
          : '즉시 연료 세이브 필요',
  }
}

function evaluatePaceStability(state: AppState | null): PaceStability {
  const recent = state?.pace.recent ?? []
  const playerRow = state?.leaderboard.find((row) => row.car_index === state.player_car_index)
  const wearPct = Number(playerRow?.tyre_wear_pct ?? 0)
  const spreadMs = getPaceSpreadMs(state)
  const consistency = clamp(Number(state?.pace.consistency_pct ?? 0), 0, 100)

  const sorted = [...(state?.leaderboard ?? [])].sort((a, b) => a.position - b.position)
  const playerIndex = sorted.findIndex((row) => row.car_index === state?.player_car_index)
  const ahead = playerIndex > 0 ? sorted[playerIndex - 1] : undefined
  const behind = playerIndex >= 0 && playerIndex < sorted.length - 1 ? sorted[playerIndex + 1] : undefined
  const trafficGapAhead = ahead ? Math.abs((playerRow?.gap_to_player_s ?? 0) - ahead.gap_to_player_s) : 9
  const trafficGapBehind = behind ? Math.abs(behind.gap_to_player_s - (playerRow?.gap_to_player_s ?? 0)) : 9
  const trafficCompression = Math.min(trafficGapAhead, trafficGapBehind)

  const tyreDegImpact = Math.round(clamp(wearPct * 1.15 + spreadMs / 55, 0, 100))
  const trafficImpact = Math.round(clamp((trafficCompression < 1 ? 80 : trafficCompression < 2 ? 52 : 20) + spreadMs / 80, 0, 100))
  const consistencyImpact = Math.round(clamp(100 - consistency, 0, 100))
  const score = Math.round(clamp(100 - tyreDegImpact * 0.34 - trafficImpact * 0.28 - consistencyImpact * 0.38, 0, 100))
  const tone = toneFromScore(score)

  return {
    score,
    tone,
    tyreDegImpact,
    trafficImpact,
    consistencyImpact,
    summary:
      tone === 'good'
        ? '페이스 안정'
        : tone === 'warn'
          ? '트래픽 또는 열화 영향 증가'
          : '일관성 붕괴, 전략 리스크 상승',
  }
}

function evaluateStrategyConfidence(state: AppState | null, dataReliability: DataReliability, paceStability: PaceStability): StrategyConfidenceState {
  const decisionEdge = getStrategyGap(state)
  const gapScore = clamp(decisionEdge * 520, 0, 100)
  const score = Math.round(clamp(gapScore * 0.5 + dataReliability.systemReliability * 0.28 + paceStability.score * 0.22, 0, 100))
  const tone = toneFromScore(score)

  return {
    score,
    tone,
    decisionEdge,
    conservativeRequired: tone !== 'good' || decisionEdge < 0.08,
    summary:
      tone === 'good'
        ? '전략 확신 우세'
        : tone === 'warn'
          ? '보수적 판단 필요'
          : '추가 데이터 확보 우선',
  }
}

function evaluateRecommendedAction(
  state: AppState | null,
  fuelRiskLevel: FuelRiskLevel,
  paceStability: PaceStability,
  strategyConfidence: StrategyConfidenceState,
  dataReliability: DataReliability,
): RecommendedActionState {
  const playerRow = state?.leaderboard.find((row) => row.car_index === state.player_car_index)
  const wearPct = Number(playerRow?.tyre_wear_pct ?? 0)
  const pitWindowOpen = !!playerRow?.pit_window_open

  if (pitWindowOpen && (wearPct >= 68 || paceStability.tone === 'critical') && dataReliability.tone !== 'critical') {
    return {
      call: 'BOX',
      tone: 'critical',
      rationale: '피트 윈도우 + 열화/페이스 붕괴 조합',
    }
  }

  if (fuelRiskLevel.saveRequired || dataReliability.tone === 'critical') {
    return {
      call: 'SAVE',
      tone: fuelRiskLevel.saveRequired ? 'critical' : 'warn',
      rationale: fuelRiskLevel.saveRequired ? '연료 마진 부족' : '데이터 신뢰도 저하로 공격 판단 제한',
    }
  }

  if (fuelRiskLevel.pushAllowed && strategyConfidence.tone === 'good' && paceStability.tone === 'good') {
    return {
      call: 'PUSH',
      tone: 'good',
      rationale: '연료/페이스/전략 확신 모두 공격 허용',
    }
  }

  return {
    call: 'HOLD',
    tone: 'warn',
    rationale: '현 상태 유지 후 추가 신호 대기',
  }
}

export function evaluateRaceState(state: AppState | null, status: string): RaceStateSnapshot {
  const stateAgeMs = getStateAgeMs(state)
  const connectionTone = getConnectionTone(status, stateAgeMs)
  const feedHealth = getFeedHealth(state)
  const fuelWindow = getFuelWindow(state)
  const sessionProgressPct = getSessionProgressPct(state)
  const dataReliability = evaluateDataReliability(feedHealth, connectionTone, stateAgeMs)
  const fuelRiskLevel = evaluateFuelRisk(fuelWindow)
  const paceStability = evaluatePaceStability(state)
  const strategyConfidence = evaluateStrategyConfidence(state, dataReliability, paceStability)
  const recommendedActionState = evaluateRecommendedAction(state, fuelRiskLevel, paceStability, strategyConfidence, dataReliability)

  const overallScore = Math.round(
    clamp(
      dataReliability.systemReliability * 0.34 +
        fuelRiskLevel.score * 0.18 +
        paceStability.score * 0.24 +
        strategyConfidence.score * 0.24,
      0,
      100,
    ),
  )
  const overallTone = recommendedActionState.call === 'BOX' || recommendedActionState.call === 'SAVE'
    ? overallScore >= 55 ? 'warn' : 'critical'
    : toneFromScore(overallScore)

  return {
    overallHealth: {
      score: overallScore,
      tone: overallTone,
      label: labelFromTone(overallTone),
    },
    dataReliability,
    strategyConfidence,
    fuelRiskLevel,
    paceStability,
    recommendedActionState,
    feedHealth,
    fuelWindow,
    stateAgeMs,
    connectionTone,
    sessionProgressPct,
  }
}