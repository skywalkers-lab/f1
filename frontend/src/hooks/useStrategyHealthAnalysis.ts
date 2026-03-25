import { useEffect, useMemo, useRef } from 'react'
import { AppState } from '../lib/types'
import { getStrategyGap } from '../lib/dashboardMetrics'

export type FeedbackCause = 'tyre' | 'traffic' | 'timing' | 'weather' | 'execution' | 'other'

export type StrategyFeedbackRecord = {
  id: string
  timestamp: number
  action: string
  reward: number
  expectedDeltaMs: number
  actualDeltaMs: number
  cause: FeedbackCause
}

type Tone = 'ok' | 'watch' | 'critical'

type ConfidenceFactor = {
  key: 'data' | 'separation' | 'stability' | 'external'
  label: string
  score: number
  tone: Tone
  detail: string
}

type InputContribution = {
  key: string
  label: string
  rawValue: string
  impactScore: number
  direction: 'up' | 'down' | 'flat'
  impactText: string
}

type CandidateInsight = {
  action: string
  score: number
  scoreText: string
  expectedGainMs: number
  expectedGainText: string
  risk: 'low' | 'medium' | 'high'
  downsideMs: number
  downsideText: string
  intensityPct: number
  isBest: boolean
  isConditional: boolean
  reason: string
}

type CausalReason = {
  id: string
  cause: string
  impact: string
  conclusion: string
  tone: 'positive' | 'warning' | 'neutral'
}

export type StrategyHealthAnalysis = {
  ready: boolean
  scorePct: number
  strategyGap: number
  strategyStability: {
    label: string
    tone: Tone
    isUnstable: boolean
  }
  confidenceBreakdown: ConfidenceFactor[]
  confidenceIndex: {
    score: number
    label: string
    tone: Tone
  }
  inputContributions: InputContribution[]
  candidateInsights: CandidateInsight[]
  conditionalDecision: {
    enabled: boolean
    message: string
  }
  causalReasons: CausalReason[]
  feedbackReadiness: {
    ready: boolean
    trigger: string
    recommendedAction: string
    expectedDeltaMs: number
  }
  feedbackTrend: {
    sampleCount: number
    successRatePct: number
    avgErrorMs: number
    avgErrorText: string
    trendLabel: string
    tone: Tone
  }
  alerts: {
    confidenceDrop: boolean
    gapDrop: boolean
    tone: Tone
    message: string
  }
}

const EMPTY_ANALYSIS: StrategyHealthAnalysis = {
  ready: false,
  scorePct: 0,
  strategyGap: 0,
  strategyStability: {
    label: '-',
    tone: 'watch',
    isUnstable: false,
  },
  confidenceBreakdown: [],
  confidenceIndex: {
    score: 0,
    label: '-',
    tone: 'watch',
  },
  inputContributions: [],
  candidateInsights: [],
  conditionalDecision: {
    enabled: false,
    message: '-',
  },
  causalReasons: [],
  feedbackReadiness: {
    ready: false,
    trigger: '-',
    recommendedAction: '-',
    expectedDeltaMs: 0,
  },
  feedbackTrend: {
    sampleCount: 0,
    successRatePct: 0,
    avgErrorMs: 0,
    avgErrorText: '-',
    trendLabel: '-',
    tone: 'watch',
  },
  alerts: {
    confidenceDrop: false,
    gapDrop: false,
    tone: 'watch',
    message: '-',
  },
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function toTone(score: number): Tone {
  if (score >= 70) return 'ok'
  if (score >= 45) return 'watch'
  return 'critical'
}

function toSignedMs(ms: number): string {
  const sign = ms > 0 ? '+' : ms < 0 ? '-' : ''
  return `${sign}${Math.abs(ms).toFixed(0)}ms`
}

function toSignedSec(ms: number): string {
  const sign = ms > 0 ? '+' : ms < 0 ? '-' : ''
  return `${sign}${(Math.abs(ms) / 1000).toFixed(3)}s`
}

function stdDev(values: number[]): number {
  if (!values.length) return 0
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length
  return Math.sqrt(variance)
}

function parseNumeric(value: string | number | undefined): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function buildDataSufficiency(state: AppState): ConfidenceFactor {
  const lapSamples = state.pace?.recent?.length ?? 0
  const trafficSamples = state.leaderboard?.length ?? 0
  const dataScore = clamp(lapSamples * 12 + trafficSamples * 2.2, 0, 100)
  return {
    key: 'data',
    label: '데이터 충분성',
    score: dataScore,
    tone: toTone(dataScore),
    detail: `랩 샘플 ${lapSamples} / 트래픽 샘플 ${trafficSamples}`,
  }
}

function buildSeparation(state: AppState): ConfidenceFactor {
  const gap = getStrategyGap(state)
  const score = clamp(gap * 500, 0, 100)
  return {
    key: 'separation',
    label: '시나리오 분리도',
    score,
    tone: toTone(score),
    detail: `Top2 gap ${gap.toFixed(3)}`,
  }
}

function buildStability(history: Array<{ action: string; score: number }>): ConfidenceFactor {
  if (history.length < 2) {
    return {
      key: 'stability',
      label: '모델 안정성',
      score: 55,
      tone: 'watch',
      detail: '변동성 샘플 수집 중',
    }
  }

  const scoreSeries = history.map((entry) => entry.score)
  const volatility = stdDev(scoreSeries)
  let actionSwitch = 0
  for (let i = 1; i < history.length; i += 1) {
    if (history[i - 1].action !== history[i].action) actionSwitch += 1
  }
  const switchRate = actionSwitch / Math.max(1, history.length - 1)
  const score = clamp(100 - volatility * 220 - switchRate * 55, 0, 100)

  return {
    key: 'stability',
    label: '모델 안정성',
    score,
    tone: toTone(score),
    detail: `volatility ${volatility.toFixed(3)} / switch ${(switchRate * 100).toFixed(0)}%`,
  }
}

function buildExternalUncertainty(state: AppState): ConfidenceFactor {
  const raceControl = String(state.race_control_state ?? '').toUpperCase()
  const weather = String(state.weather_state ?? '').toUpperCase()

  let penalty = 0
  if (raceControl.includes('SC') || raceControl.includes('VSC') || raceControl.includes('YELLOW')) penalty += 35
  if (weather.includes('RAIN') || weather.includes('WEATHER_3') || weather.includes('WEATHER_4') || weather.includes('WEATHER_5')) penalty += 30

  const score = clamp(100 - penalty, 0, 100)
  return {
    key: 'external',
    label: '외부 변수 불확실성',
    score,
    tone: toTone(score),
    detail: raceControl.includes('SC') || raceControl.includes('VSC') ? 'SC/VSC 활성 가능성' : '변수 안정',
  }
}

function influenceForInput(key: string, value: string | number, action: string): { impact: number; direction: 'up' | 'down' | 'flat' } {
  const v = parseNumeric(value)
  const upperAction = action.toUpperCase()

  if (key === 'tyre_age') {
    const impact = clamp(v * 4.8, 0, 100)
    const direction = upperAction.includes('PIT') ? 'up' : 'down'
    return { impact, direction }
  }
  if (key === 'traffic_density') {
    const impact = clamp(v * 30, 0, 100)
    const direction = upperAction.includes('STAY') ? 'down' : 'up'
    return { impact, direction }
  }
  if (key === 'pit_loss_est_s') {
    const impact = clamp(v * 4.2, 0, 100)
    const direction = upperAction.includes('PIT') ? 'down' : 'up'
    return { impact, direction }
  }
  if (key === 'fuel_remaining_kg') {
    const impact = clamp(Math.abs(v - 20) * 2.6, 0, 90)
    const direction = v < 12 ? 'up' : 'flat'
    return { impact, direction }
  }
  if (key === 'laps_remaining') {
    const impact = clamp(v * 2.4, 0, 80)
    const direction = v < 10 ? 'up' : 'flat'
    return { impact, direction }
  }
  if (key === 'sc_vsc_status') {
    const raw = String(value).toUpperCase()
    const impact = raw.includes('SC') || raw.includes('VSC') ? 72 : 14
    return { impact, direction: 'flat' }
  }
  if (key === 'weather_state') {
    const raw = String(value).toUpperCase()
    const impact = raw.includes('WEATHER_3') || raw.includes('WEATHER_4') || raw.includes('WEATHER_5') ? 66 : 18
    return { impact, direction: 'flat' }
  }

  return { impact: 18, direction: 'flat' }
}

function buildInputContributions(state: AppState): InputContribution[] {
  const keyInputs = state.strategy?.key_inputs ?? {}
  const action = state.strategy?.action ?? 'STAY_OUT'

  return Object.entries(keyInputs)
    .map(([key, value]) => {
      const influence = influenceForInput(key, value, action)
      return {
        key,
        label: key,
        rawValue: String(value),
        impactScore: influence.impact,
        direction: influence.direction,
        impactText:
          influence.direction === 'up'
            ? '선택 액션 강화'
            : influence.direction === 'down'
              ? '선택 액션 약화'
              : '중립/조건부',
      }
    })
    .sort((a, b) => b.impactScore - a.impactScore)
}

function buildCandidateInsights(state: AppState, strategyGap: number): CandidateInsight[] {
  const candidates = (state.strategy?.candidates ?? []).slice(0, 4)
  const topScore = candidates[0]?.score ?? 0
  const trafficDensity = parseNumeric(state.strategy?.key_inputs?.traffic_density)
  const pitLoss = parseNumeric(state.strategy?.key_inputs?.pit_loss_est_s) * 1000

  return candidates.map((candidate, idx) => {
    const relative = candidate.score - topScore
    const expectedGainMs = Math.round(relative * 9800 + strategyGap * 2500)
    const riskScore = clamp(trafficDensity * 1.3 + (idx * 8), 0, 100)
    const risk: 'low' | 'medium' | 'high' = riskScore >= 67 ? 'high' : riskScore >= 38 ? 'medium' : 'low'
    const downsideMs = Math.round(expectedGainMs - (risk === 'high' ? 2600 : risk === 'medium' ? 1200 : 500) - pitLoss * 0.12)
    const topDelta = idx === 0 ? 0 : topScore - candidate.score

    return {
      action: candidate.action,
      score: candidate.score,
      scoreText: candidate.score.toFixed(3),
      expectedGainMs,
      expectedGainText: toSignedSec(expectedGainMs),
      risk,
      downsideMs,
      downsideText: toSignedSec(downsideMs),
      intensityPct: clamp(candidate.score * 100, 6, 100),
      isBest: idx === 0,
      isConditional: idx <= 1 && topDelta < 0.06,
      reason: candidate.reason,
    }
  })
}

function toneFromReason(reason: string): 'positive' | 'warning' | 'neutral' {
  const r = reason.toLowerCase()
  if (r.includes('risk') || r.includes('traffic') || r.includes('loss') || r.includes('열화')) return 'warning'
  if (r.includes('gain') || r.includes('window') || r.includes('advantage') || r.includes('우위')) return 'positive'
  return 'neutral'
}

function buildCausalReasons(rawReason: string): CausalReason[] {
  const parts = rawReason
    .split('. ')
    .map((line) => line.trim())
    .filter(Boolean)

  const grouped = new Map<string, CausalReason>()

  parts.forEach((part, idx) => {
    const tokens = part.split(/,|;|->|=>/).map((t) => t.trim()).filter(Boolean)
    const cause = tokens[0] ?? part
    const impact = tokens[1] ?? `${cause} 영향 확대`
    const conclusion = tokens[2] ?? '현재 전략 반영'
    const key = cause.slice(0, 24).toLowerCase()

    if (!grouped.has(key)) {
      grouped.set(key, {
        id: `${key}-${idx}`,
        cause,
        impact,
        conclusion,
        tone: toneFromReason(part),
      })
    }
  })

  return Array.from(grouped.values())
}

function deriveStabilityLabel(gap: number): { label: string; tone: Tone; isUnstable: boolean } {
  if (gap < 0.045) return { label: '결정 불안정 상태: 대기 권장', tone: 'critical', isUnstable: true }
  if (gap < 0.09) return { label: '결정 경계 상태: 조건부 선택', tone: 'watch', isUnstable: false }
  return { label: '결정 확신 상태', tone: 'ok', isUnstable: false }
}

export function useStrategyHealthAnalysis(
  state: AppState | null,
  feedbackHistory: StrategyFeedbackRecord[],
): StrategyHealthAnalysis {
  const snapshotRef = useRef<Array<{ frame: number; action: string; score: number; at: number }>>([])
  const previousConfidenceRef = useRef<number | null>(null)
  const previousGapRef = useRef<number | null>(null)
  const actionChangedAtRef = useRef<number>(Date.now())
  const previousActionRef = useRef<string | null>(null)

  useEffect(() => {
    if (!state?.strategy) return

    const next = {
      frame: state.last_frame_identifier,
      action: state.strategy.action,
      score: state.strategy.score,
      at: Date.now(),
    }

    const exists = snapshotRef.current.some((entry) => entry.frame === next.frame)
    if (!exists) {
      snapshotRef.current = [...snapshotRef.current.slice(-9), next]
    }

    if (previousActionRef.current && previousActionRef.current !== next.action) {
      actionChangedAtRef.current = Date.now()
    }
    previousActionRef.current = next.action
  }, [state])

  return useMemo(() => {
    if (!state?.strategy) return EMPTY_ANALYSIS

    const strategyGap = getStrategyGap(state)
    const stability = deriveStabilityLabel(strategyGap)

    const confidenceFactors: ConfidenceFactor[] = [
      buildDataSufficiency(state),
      buildSeparation(state),
      buildStability(snapshotRef.current.map((entry) => ({ action: entry.action, score: entry.score }))),
      buildExternalUncertainty(state),
    ]

    const confidenceScore = Math.round(
      confidenceFactors.reduce((sum, factor, idx) => {
        const weight = idx === 0 ? 0.24 : idx === 1 ? 0.31 : idx === 2 ? 0.28 : 0.17
        return sum + factor.score * weight
      }, 0),
    )

    const confidenceTone = toTone(confidenceScore)
    const confidenceLabel = confidenceTone === 'ok' ? '신뢰 가능' : confidenceTone === 'watch' ? '조건부 신뢰' : '신뢰 낮음'

    const contribution = buildInputContributions(state)
    const candidateInsights = buildCandidateInsights(state, strategyGap)

    const top = candidateInsights[0]
    const second = candidateInsights[1]
    const conditional = !!top && !!second && Math.abs(top.score - second.score) < 0.06

    const conditionalDecision = {
      enabled: conditional,
      message: conditional
        ? `${top.action} 단독 확정 대신 조건부 선택 권장 (Top2 gap ${(Math.abs(top.score - second.score)).toFixed(3)})`
        : '단일 추천 전략 실행 가능',
    }

    const reasons = buildCausalReasons(state.strategy.reason ?? '추천 근거 데이터 없음')

    const now = Date.now()
    const elapsedFromActionChange = now - actionChangedAtRef.current
    const eventSummary = String(state.last_event_summary ?? '').toLowerCase()
    const eventTriggered = eventSummary.includes('pit') || eventSummary.includes('undercut') || eventSummary.includes('overtake')
    const lapTriggered = (state.player.lap ?? 0) > 1 && elapsedFromActionChange > 22_000

    const feedbackReady = eventTriggered || lapTriggered
    const feedbackTrigger = eventTriggered
      ? '이벤트 트리거 감지 (pit/undercut/overtake)'
      : lapTriggered
        ? '시간 기반 트리거 (전략 갱신 후 22s 경과)'
        : '평가 대기'

    const expectedDeltaMs = Math.round((top?.expectedGainMs ?? 0))

    const recentFeedback = feedbackHistory.slice(-5)
    const successCount = recentFeedback.filter((item) => item.reward > 0).length
    const successRatePct = recentFeedback.length ? Math.round((successCount / recentFeedback.length) * 100) : 0
    const avgErrorMs = recentFeedback.length
      ? Math.round(recentFeedback.reduce((sum, item) => sum + Math.abs(item.actualDeltaMs - item.expectedDeltaMs), 0) / recentFeedback.length)
      : 0

    const trendTone: Tone = recentFeedback.length === 0
      ? 'watch'
      : successRatePct >= 70 && avgErrorMs <= 750
        ? 'ok'
        : successRatePct >= 45 && avgErrorMs <= 1500
          ? 'watch'
          : 'critical'

    const trendLabel = recentFeedback.length === 0
      ? '피드백 샘플 수집 필요'
      : trendTone === 'ok'
        ? '모델 성능 양호'
        : trendTone === 'watch'
          ? '모델 성능 경계'
          : '모델 성능 저하'

    const previousConfidence = previousConfidenceRef.current
    const previousGap = previousGapRef.current
    const confidenceDrop = previousConfidence !== null && previousConfidence - confidenceScore >= 12
    const gapDrop = previousGap !== null && previousGap - strategyGap >= 0.04

    const alertTone: Tone = confidenceDrop || gapDrop ? 'critical' : stability.tone === 'critical' ? 'watch' : 'ok'
    const alertMessage =
      alertTone === 'critical'
        ? '신뢰도 급락 또는 격차 축소 감지: 즉시 수동 검토 필요'
        : alertTone === 'watch'
          ? '전략 경쟁 심화: 조건부 실행 권장'
          : '전략 상태 안정'

    previousConfidenceRef.current = confidenceScore
    previousGapRef.current = strategyGap

    return {
      ready: true,
      scorePct: Math.round(clamp((state.strategy.score ?? 0) * 100, 0, 100)),
      strategyGap,
      strategyStability: stability,
      confidenceBreakdown: confidenceFactors,
      confidenceIndex: {
        score: confidenceScore,
        label: confidenceLabel,
        tone: confidenceTone,
      },
      inputContributions: contribution,
      candidateInsights,
      conditionalDecision,
      causalReasons: reasons,
      feedbackReadiness: {
        ready: feedbackReady,
        trigger: feedbackTrigger,
        recommendedAction: top?.action ?? state.strategy.action,
        expectedDeltaMs,
      },
      feedbackTrend: {
        sampleCount: recentFeedback.length,
        successRatePct,
        avgErrorMs,
        avgErrorText: recentFeedback.length ? toSignedMs(avgErrorMs) : '-',
        trendLabel,
        tone: trendTone,
      },
      alerts: {
        confidenceDrop,
        gapDrop,
        tone: alertTone,
        message: alertMessage,
      },
    }
  }, [state, feedbackHistory])
}
