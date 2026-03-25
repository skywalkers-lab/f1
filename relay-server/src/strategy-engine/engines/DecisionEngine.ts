/**
 * Decision Scoring & Strategy Execution System
 * =============================================
 * Multi-objective scoring, decision inertia, and structured execution plans.
 *
 * Replaces linear heuristic formula with:
 *   1. Weighted multi-objective scoring (time, position, risk, traffic, tyre, flexibility)
 *   2. Dynamic weights based on race phase
 *   3. Decision inertia to prevent oscillation
 *   4. Structured execution plans with lap-by-lap intent
 *   5. Critical triggers and contingency actions
 *   6. Human-readable race engineer language
 */

import {
  DecisionObjectives,
  DecisionWeights,
  DecisionInertiaState,
  StrategyExecutionPlan,
  LapIntent,
  StrategyTrigger,
  TyreManagementTarget,
  ContingencyAction,
  DistributionMetrics,
  EnhancedSimulationResult,
  RaceEvolutionState,
  SpatialTrafficState,
  TyreCompound,
  StrategyAction,
  RaceContext,
} from '../types.js'

// ════════════════════════════════════════════════════════════════
// MULTI-OBJECTIVE SCORING
// ════════════════════════════════════════════════════════════════

/**
 * Phase-dependent scoring weights.
 * Early race: prioritize strategic flexibility and tyre longevity
 * Mid race: balanced approach
 * Late race: prioritize position gain and time gain
 */
const PHASE_WEIGHTS: Record<string, DecisionWeights> = {
  early: {
    timeGain: 0.20,
    positionGain: 0.15,
    riskExposure: 0.15,
    trafficExposure: 0.10,
    tyreLongevity: 0.20,
    strategicFlexibility: 0.20,
  },
  mid: {
    timeGain: 0.25,
    positionGain: 0.25,
    riskExposure: 0.15,
    trafficExposure: 0.10,
    tyreLongevity: 0.15,
    strategicFlexibility: 0.10,
  },
  late: {
    timeGain: 0.30,
    positionGain: 0.30,
    riskExposure: 0.10,
    trafficExposure: 0.10,
    tyreLongevity: 0.10,
    strategicFlexibility: 0.10,
  },
}

/**
 * Compute decision objectives from simulation results.
 */
export function computeObjectives(
  result: {
    totalTime: DistributionMetrics
    positionChange: DistributionMetrics
    variance: number
    trafficLossMs: number
    tyreLapsRemaining: number
    futureOptions: number
  },
  baseline: {
    totalTimeMs: number
    currentPosition: number
  },
): DecisionObjectives {
  // Time gain: negative = faster (better)
  const timeGain = -(result.totalTime.mean - baseline.totalTimeMs) / 1000 // in seconds

  // Position gain: positive = improved
  const positionGain = result.positionChange.mean

  // Risk: normalized variance (0 = safe, 1 = very risky)
  const riskExposure = Math.min(1, result.variance / 10)

  // Traffic: normalized (0 = clear, 1 = heavy traffic)
  const trafficExposure = Math.min(1, result.trafficLossMs / 5000)

  // Tyre longevity: normalized remaining laps
  const tyreLongevity = Math.min(1, result.tyreLapsRemaining / 20)

  // Strategic flexibility: future pit options remaining
  const strategicFlexibility = Math.min(1, result.futureOptions / 3)

  return {
    timeGain,
    positionGain,
    riskExposure,
    trafficExposure,
    tyreLongevity,
    strategicFlexibility,
  }
}

/**
 * Score a set of objectives using phase-dependent weights.
 * Returns a composite score (higher = better).
 */
export function scoreObjectives(
  objectives: DecisionObjectives,
  racePhase: 'early' | 'mid' | 'late',
): number {
  const weights = PHASE_WEIGHTS[racePhase]

  // Normalize each objective to a 0-1 scale for comparison
  const normalizedTimeGain = sigmoid(objectives.timeGain, 2)        // More time gain = better
  const normalizedPosGain = sigmoid(objectives.positionGain, 1.5)   // More pos gain = better
  const normalizedRisk = 1 - objectives.riskExposure                // Less risk = better
  const normalizedTraffic = 1 - objectives.trafficExposure          // Less traffic = better
  const normalizedTyre = objectives.tyreLongevity                   // More longevity = better
  const normalizedFlexibility = objectives.strategicFlexibility     // More flexibility = better

  return (
    normalizedTimeGain * weights.timeGain +
    normalizedPosGain * weights.positionGain +
    normalizedRisk * weights.riskExposure +
    normalizedTraffic * weights.trafficExposure +
    normalizedTyre * weights.tyreLongevity +
    normalizedFlexibility * weights.strategicFlexibility
  )
}

function sigmoid(x: number, steepness: number = 1): number {
  return 1 / (1 + Math.exp(-x * steepness))
}

// ════════════════════════════════════════════════════════════════
// DECISION INERTIA
// ════════════════════════════════════════════════════════════════

const BASE_SWITCH_THRESHOLD = 0.08  // 8% improvement required to switch
const MAX_SWITCH_THRESHOLD = 0.20   // Cap at 20%
const INERTIA_GROWTH_PER_LAP = 0.015 // Threshold grows per consecutive lap

/**
 * Initialize inertia state for a new session.
 */
export function createInertiaState(): DecisionInertiaState {
  return {
    previousRecommendation: null,
    lastChangeTimestamp: 0,
    consecutiveLaps: 0,
    switchThreshold: BASE_SWITCH_THRESHOLD,
  }
}

/**
 * Apply decision inertia check.
 * Returns whether a switch should be allowed.
 */
export function applyInertia(
  state: DecisionInertiaState,
  newRecommendation: string,
  newScore: number,
  previousScore: number,
): { shouldSwitch: boolean; updatedState: DecisionInertiaState } {
  // First recommendation: always allow
  if (state.previousRecommendation === null) {
    return {
      shouldSwitch: true,
      updatedState: {
        previousRecommendation: newRecommendation,
        lastChangeTimestamp: Date.now(),
        consecutiveLaps: 1,
        switchThreshold: BASE_SWITCH_THRESHOLD,
      },
    }
  }

  // Same recommendation: increase inertia
  if (newRecommendation === state.previousRecommendation) {
    return {
      shouldSwitch: false,
      updatedState: {
        ...state,
        consecutiveLaps: state.consecutiveLaps + 1,
        switchThreshold: Math.min(
          MAX_SWITCH_THRESHOLD,
          BASE_SWITCH_THRESHOLD + state.consecutiveLaps * INERTIA_GROWTH_PER_LAP,
        ),
      },
    }
  }

  // Different recommendation: check if improvement exceeds threshold
  const improvement = previousScore > 0
    ? (newScore - previousScore) / previousScore
    : newScore - previousScore

  if (improvement > state.switchThreshold) {
    return {
      shouldSwitch: true,
      updatedState: {
        previousRecommendation: newRecommendation,
        lastChangeTimestamp: Date.now(),
        consecutiveLaps: 1,
        switchThreshold: BASE_SWITCH_THRESHOLD,
      },
    }
  }

  // Not enough improvement: maintain current recommendation
  return {
    shouldSwitch: false,
    updatedState: {
      ...state,
      consecutiveLaps: state.consecutiveLaps + 1,
    },
  }
}

// ════════════════════════════════════════════════════════════════
// STRATEGY EXECUTION PLAN
// ════════════════════════════════════════════════════════════════

/**
 * Build a structured execution plan for the recommended strategy.
 */
export function buildExecutionPlan(
  action: StrategyAction,
  context: RaceContext,
  raceEvolution: RaceEvolutionState,
  traffic: SpatialTrafficState,
  lapsToCliff: number,
): StrategyExecutionPlan {
  const currentLap = context.currentLap
  const player = context.drivers[context.playerIndex]
  if (!player) {
    return { lapIntents: [], triggers: [], tyreTargets: [], contingencies: [] }
  }

  const lapIntents = buildLapIntents(action, currentLap, context.lapsRemaining, lapsToCliff, traffic)
  const triggers = buildTriggers(action, player, raceEvolution, traffic, lapsToCliff)
  const tyreTargets = buildTyreTargets(action, currentLap, lapsToCliff, player)
  const contingencies = buildContingencies(action, raceEvolution, currentLap)

  return { lapIntents, triggers, tyreTargets, contingencies }
}

function buildLapIntents(
  action: StrategyAction,
  currentLap: number,
  lapsRemaining: number,
  lapsToCliff: number,
  traffic: SpatialTrafficState,
): LapIntent[] {
  const intents: LapIntent[] = []
  const horizon = Math.min(10, lapsRemaining)
  const pitLap = action.type === 'PIT' ? action.targetLap : null

  for (let i = 0; i < horizon; i++) {
    const lap = currentLap + i
    let intent: LapIntent['intent'] = 'manage'
    let targetDelta: number | null = null
    let notes = ''

    if (pitLap !== null && lap === pitLap) {
      intent = 'box_window'
      notes = `Target: ${action.targetCompound} compound`
    } else if (pitLap !== null && lap === pitLap - 1) {
      intent = 'manage'
      notes = 'In-lap: conserve tyres, fuel save last sector'
    } else if (pitLap !== null && lap === pitLap + 1) {
      intent = 'push'
      notes = 'Out-lap: build tyre temp, push for undercut window'
    } else if (i < 2 && traffic.cleanAirScore > 80) {
      intent = 'push'
      targetDelta = -0.3
      notes = 'Clean air available — push for gap'
    } else if (lapsToCliff - i <= 2 && pitLap === null) {
      intent = 'manage'
      notes = 'Tyre cliff approaching — heavy management required'
    } else if (traffic.cleanAirScore < 40) {
      intent = 'defend'
      notes = 'Heavy traffic — maintain position, avoid excessive tyre wear'
    } else {
      intent = 'manage'
      targetDelta = 0
      notes = 'Standard pace management'
    }

    intents.push({ lap, intent, targetDelta, notes })
  }

  return intents
}

function buildTriggers(
  action: StrategyAction,
  player: { gapToAhead: number; gapToBehind: number; tyreWear: number },
  evolution: RaceEvolutionState,
  traffic: SpatialTrafficState,
  lapsToCliff: number,
): StrategyTrigger[] {
  const triggers: StrategyTrigger[] = []

  // Undercut abort trigger
  if (action.type === 'PIT') {
    triggers.push({
      id: 'undercut_abort',
      condition: `gap_behind < 1.5s`,
      action: 'Abort undercut, consider defensive pit',
      priority: 'critical',
      engineerNote: `뒤차 갭이 1.5초 미만이면 언더컷을 중단하고 방어적 피트를 고려하세요`,
    })
  }

  // Tyre cliff emergency
  if (lapsToCliff <= 3) {
    triggers.push({
      id: 'cliff_emergency',
      condition: `laps_to_cliff <= 2`,
      action: 'Immediate pit entry — cliff imminent',
      priority: 'critical',
      engineerNote: `타이어 클리프까지 ${Math.round(lapsToCliff)}랩 — 즉시 피트 진입 필요`,
    })
  }

  // SC opportunity
  if (evolution.scProbabilityPerLap > 0.08) {
    triggers.push({
      id: 'sc_opportunity',
      condition: 'safety_car_deployed',
      action: 'Evaluate free pit stop — estimated saving: ' +
        `${((1 - 0.42) * evolution.effectivePitLoss).toFixed(1)}s`,
      priority: 'high',
      engineerNote: `SC 발생 시 무료 피트스탑 가능 — 약 ${((1 - 0.42) * evolution.effectivePitLoss).toFixed(1)}초 절약`,
    })
  }

  // Traffic clear window
  if (traffic.cleanAirScore < 50 && action.type !== 'PIT') {
    triggers.push({
      id: 'traffic_clear',
      condition: 'clean_air_window_opens',
      action: 'Push immediately when traffic clears',
      priority: 'high',
      engineerNote: `현재 트래픽 구간 — 클린에어 확보 시 즉시 푸시`,
    })
  }

  // Rival pit watch
  triggers.push({
    id: 'rival_pit',
    condition: 'direct_rival_pits',
    action: 'Re-evaluate strategy within 1 lap',
    priority: 'medium',
    engineerNote: `직접 경쟁자 피트 시 1랩 이내 전략 재평가`,
  })

  return triggers
}

function buildTyreTargets(
  action: StrategyAction,
  currentLap: number,
  lapsToCliff: number,
  player: { tyreWear: number; currentCompound: TyreCompound },
): TyreManagementTarget[] {
  const targets: TyreManagementTarget[] = []

  if (action.type === 'PIT') {
    // Pre-pit: manage to pit lap
    const pitLap = action.targetLap
    targets.push({
      lapRange: [currentLap, pitLap],
      targetWearRate: 0.035,
      maxAcceptableWear: 0.85,
      compound: player.currentCompound,
    })
    // Post-pit: maximize compound
    targets.push({
      lapRange: [pitLap + 1, pitLap + 15],
      targetWearRate: 0.030,
      maxAcceptableWear: 0.65,
      compound: action.targetCompound,
    })
  } else {
    // Stay out: manage to cliff boundary
    targets.push({
      lapRange: [currentLap, currentLap + Math.round(lapsToCliff)],
      targetWearRate: 0.030,
      maxAcceptableWear: 0.78,
      compound: player.currentCompound,
    })
  }

  return targets
}

function buildContingencies(
  action: StrategyAction,
  evolution: RaceEvolutionState,
  currentLap: number,
): ContingencyAction[] {
  const contingencies: ContingencyAction[] = []

  contingencies.push({
    event: 'SC',
    action: action.type === 'PIT'
      ? `Advance pit to SC lap if within ${Math.round(action.targetLap - currentLap)} laps of planned stop`
      : 'Box immediately for free pit stop',
    conditions: 'SC deployed and pit lane open',
    priority: 'critical',
  })

  contingencies.push({
    event: 'VSC',
    action: action.type === 'PIT'
      ? 'Consider advancing pit — ~35% pit loss reduction'
      : 'Evaluate VSC pit — moderate benefit',
    conditions: 'VSC deployed',
    priority: 'high',
  })

  contingencies.push({
    event: 'RAIN',
    action: 'Switch to intermediate/wet compounds immediately',
    conditions: 'Rain detected on track',
    priority: 'critical',
  })

  contingencies.push({
    event: 'RIVAL_PIT',
    action: 'Re-evaluate undercut/overcut windows',
    conditions: 'Direct competitor enters pit lane',
    priority: 'medium',
  })

  return contingencies
}

// ════════════════════════════════════════════════════════════════
// ENGINEER BRIEFING GENERATION
// ════════════════════════════════════════════════════════════════

/**
 * Generate a human-readable race engineer briefing.
 */
export function generateEngineerBriefing(
  action: StrategyAction,
  objectives: DecisionObjectives,
  evolution: RaceEvolutionState,
  traffic: SpatialTrafficState,
  confidence: number,
  lapsToCliff: number,
): string {
  const parts: string[] = []

  // Main call
  if (action.type === 'PIT') {
    parts.push(`"Box box, Lap ${action.targetLap}. ${action.targetCompound} tyres."`)
  } else {
    parts.push(`"Stay out. Manage the tyres."`)
  }

  // Position outlook
  if (objectives.positionGain > 0.5) {
    parts.push(`Expected gain: P${Math.round(objectives.positionGain)} positions.`)
  } else if (objectives.positionGain < -0.5) {
    parts.push(`Risk of losing P${Math.round(Math.abs(objectives.positionGain))}.`)
  }

  // Tyre situation
  if (lapsToCliff <= 3) {
    parts.push(`Tyres critical — cliff in ${Math.round(lapsToCliff)} laps.`)
  } else if (lapsToCliff <= 8) {
    parts.push(`Tyre management phase — ${Math.round(lapsToCliff)} laps to cliff.`)
  }

  // Traffic
  if (traffic.cleanAirScore < 40) {
    parts.push(`Heavy traffic ahead — clean air score ${Math.round(traffic.cleanAirScore)}/100.`)
  } else if (traffic.cleanAirScore > 80) {
    parts.push(`Clean air — push available.`)
  }

  // SC context
  if (evolution.scProbabilityPerLap > 0.12) {
    parts.push(`SC probability elevated (${Math.round(evolution.scProbabilityPerLap * 100)}%/lap).`)
  }

  // Confidence
  if (confidence < 50) {
    parts.push(`Low confidence — situation volatile.`)
  }

  return parts.join(' ')
}
