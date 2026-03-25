// #26 — Predictor confidence intervals in strategy panel
// #27 — Uncertainty-aware BOX/PUSH/HOLD recommendation thresholds

import type { UnifiedStrategyDecision, ScenarioOutcome } from './unifiedMonteCarloCore'

// ═══════════════════════════════════════════════════════════════
// #26: Confidence interval calculations
// ═══════════════════════════════════════════════════════════════

export type ConfidenceInterval = {
  mean: number
  lower: number
  upper: number
  confidenceLevel: number  // e.g. 0.90 for 90%
  sampleSize: number
}

export type StrategyConfidenceInfo = {
  positionCI: ConfidenceInterval
  gainCI: ConfidenceInterval
  scImpactCI: ConfidenceInterval
  convergenceQuality: 'excellent' | 'good' | 'fair' | 'poor'
}

/**
 * Compute confidence intervals for a strategy scenario.
 * Uses z-scores for normal approximation (valid for MC runs > 30).
 */
export function computeScenarioConfidence(
  scenario: ScenarioOutcome,
  totalRuns: number,
  confidenceLevel = 0.90,
): StrategyConfidenceInfo {
  const zScores: Record<number, number> = {
    0.80: 1.28,
    0.90: 1.645,
    0.95: 1.96,
    0.99: 2.576,
  }
  const z = zScores[confidenceLevel] ?? 1.645

  // Position CI
  const posMean = (scenario.position.p10 + scenario.position.p90) / 2
  const posSpread = (scenario.position.p90 - scenario.position.p10) / (2 * 1.645) // approx std from p10-p90
  const posMargin = z * posSpread / Math.sqrt(Math.max(1, totalRuns))

  // Gain CI
  const gainMean = scenario.expectedGain.mean
  const gainStd = (scenario.expectedGain.p90 - scenario.expectedGain.p10) / (2 * 1.645)
  const gainMargin = z * gainStd / Math.sqrt(Math.max(1, totalRuns))

  // SC impact CI
  const scMean = (scenario.conditionalWithSC.mean + scenario.conditionalNoSC.mean) / 2
  const scSpread = Math.abs(scenario.conditionalWithSC.mean - scenario.conditionalNoSC.mean) / 2
  const scMargin = z * scSpread / Math.sqrt(Math.max(1, totalRuns))

  // Convergence quality based on outcome stability
  let convergenceQuality: StrategyConfidenceInfo['convergenceQuality'] = 'poor'
  if (scenario.outcomeStability > 0.85) convergenceQuality = 'excellent'
  else if (scenario.outcomeStability > 0.70) convergenceQuality = 'good'
  else if (scenario.outcomeStability > 0.50) convergenceQuality = 'fair'

  return {
    positionCI: {
      mean: posMean,
      lower: posMean - posMargin,
      upper: posMean + posMargin,
      confidenceLevel,
      sampleSize: totalRuns,
    },
    gainCI: {
      mean: gainMean,
      lower: gainMean - gainMargin,
      upper: gainMean + gainMargin,
      confidenceLevel,
      sampleSize: totalRuns,
    },
    scImpactCI: {
      mean: scMean,
      lower: scMean - scMargin,
      upper: scMean + scMargin,
      confidenceLevel,
      sampleSize: totalRuns,
    },
    convergenceQuality,
  }
}

// ═══════════════════════════════════════════════════════════════
// #27: Uncertainty-aware BOX/PUSH/HOLD recommendation
// ═══════════════════════════════════════════════════════════════

export type UncertaintyRecommendation = {
  action: 'BOX' | 'PUSH' | 'HOLD'
  confidence: 'high' | 'medium' | 'low'
  urgency: number // 0-1
  reasoning: string
  uncertaintyBand: { lower: string; upper: string }
}

const BOX_GAIN_THRESHOLD = -0.5
const PUSH_GAIN_THRESHOLD = 0.3
const HIGH_CONFIDENCE_MIN = 0.7
const MEDIUM_CONFIDENCE_MIN = 0.45

export function computeUncertaintyRecommendation(
  decision: UnifiedStrategyDecision,
): UncertaintyRecommendation {
  const rec = decision.recommended
  const ci = computeScenarioConfidence(rec, decision.totalRuns)

  const gainLower = ci.gainCI.lower
  const gainUpper = ci.gainCI.upper
  const confScore = decision.confidenceScore / 100

  // Determine action
  let action: UncertaintyRecommendation['action'] = 'HOLD'
  let reasoning = ''

  const tyreCritical = rec.tyreCriticalRisk > 0.5
  const scOpportunity = rec.scProbabilityUsed > 0.25 && rec.conditionalWithSC.mean > 1.0

  if (tyreCritical || (gainLower < BOX_GAIN_THRESHOLD && rec.label.includes('PIT'))) {
    action = 'BOX'
    reasoning = tyreCritical
      ? `타이어 클리프 리스크 ${Math.round(rec.tyreCriticalRisk * 100)}% — 즉시 피트`
      : `예상 이득 하한 ${gainLower.toFixed(1)}pos — 피트 추천`
  } else if (gainUpper > PUSH_GAIN_THRESHOLD && confScore > MEDIUM_CONFIDENCE_MIN) {
    action = 'PUSH'
    reasoning = `예상 이득 상한 +${gainUpper.toFixed(1)}pos, 신뢰도 ${Math.round(confScore * 100)}%`
  } else {
    action = 'HOLD'
    reasoning = scOpportunity
      ? `SC 기회 대기 중 (SC 확률 ${Math.round(rec.scProbabilityUsed * 100)}%)`
      : `불확실성 구간 내 — 현 전략 유지`
  }

  let confidence: UncertaintyRecommendation['confidence'] = 'low'
  if (confScore >= HIGH_CONFIDENCE_MIN && ci.convergenceQuality === 'excellent') {
    confidence = 'high'
  } else if (confScore >= MEDIUM_CONFIDENCE_MIN) {
    confidence = 'medium'
  }

  const urgency = Math.max(0, Math.min(1,
    (tyreCritical ? 0.5 : 0) +
    (rec.trafficRisk > 0.3 ? 0.2 : 0) +
    (Math.abs(ci.gainCI.mean) > 1.0 ? 0.3 : 0.1)
  ))

  return {
    action,
    confidence,
    urgency,
    reasoning,
    uncertaintyBand: {
      lower: `${gainLower >= 0 ? '+' : ''}${gainLower.toFixed(1)}pos`,
      upper: `${gainUpper >= 0 ? '+' : ''}${gainUpper.toFixed(1)}pos`,
    },
  }
}
