/**
 * Enhanced Race Simulator — Multi-Layer Orchestrator
 * ===================================================
 * Coordinates all four architecture layers:
 *
 *   Layer 1: Deterministic Simulation (per-lap physics integration)
 *   Layer 2: Probabilistic Prediction (Monte Carlo with distributions)
 *   Layer 3: Race Event Anticipation (SC/VSC/weather evolution)
 *   Layer 4: Decision Scoring & Confidence (multi-objective ranking)
 *
 * Key improvements over previous RaceSimulator:
 *   - Full Monte Carlo batches (50-200 runs) with distributions
 *   - Probability-based SC/VSC event sampling per run
 *   - Enhanced tyre model with 3-phase compound curves
 *   - Rival strategy tree branching
 *   - Spatial-temporal traffic modeling
 *   - Decision inertia system
 *   - Structured execution plans
 *   - Partial recomputation (only recompute changed scenarios)
 *   - Adaptive resolution (reduce runs under load)
 */

import {
  EnhancedSimulationResult,
  StrategyEngineOutput,
  DistributionMetrics,
  StrategyAction,
  StrategyContext,
  RaceContext,
  RaceScenario,
  SimulationConfig,
  DecisionObjectives,
  DecisionInertiaState,
  RaceEvolutionState,
  SpatialTrafficState,
  TyreCompound,
  DrivingMode,
  SimulationResult,
  LapDetail,
  RiskProfile,
  MonteCarloStats,
  ScenarioResult,
  SimulationMetadata,
  LapState,
} from '../types.js'
import { DEFAULT_SIMULATION_CONFIG, getTrackPhysics } from '../config/SimulationConfig.js'
import { LRUCache, SimulationCacheKeyBuilder } from '../cache/LRUCache.js'
import { LapSimulator } from './LapSimulator.js'
import { OpponentModel } from './OpponentModel.js'
import { RaceEvolutionModel } from '../models/RaceEvolutionModel.js'
import {
  computeTyreDegradation,
  getDegradationProfile,
  type TyreDegradationContext,
} from '../models/EnhancedTyreModel.js'
import {
  analyzeTraffic,
  projectTrafficForScenario,
} from '../models/SpatialTrafficModel.js'
import {
  buildRivalStrategyTrees,
  projectRival,
} from '../models/RivalStrategyModel.js'
import {
  computeObjectives,
  scoreObjectives,
  applyInertia,
  createInertiaState,
  buildExecutionPlan,
  generateEngineerBriefing,
} from './DecisionEngine.js'

// ════════════════════════════════════════════════════════════════
// SEEDED PRNG (Xorshift128 for reproducible Monte Carlo)
// ════════════════════════════════════════════════════════════════

class PRNG {
  private s: Uint32Array
  constructor(seed: number) {
    this.s = new Uint32Array(4)
    this.s[0] = seed >>> 0
    this.s[1] = (seed * 2654435761) >>> 0
    this.s[2] = (seed * 2246822519) >>> 0
    this.s[3] = (seed * 3266489917) >>> 0
    for (let i = 0; i < 20; i++) this.next()
  }
  next(): number {
    const s = this.s
    let t = s[3]
    t ^= t << 11; t ^= t >>> 8
    s[3] = s[2]; s[2] = s[1]; s[1] = s[0]
    t ^= s[0]; t ^= s[0] >>> 19; s[0] = t
    return (t >>> 0) / 4294967296
  }
  gaussian(mean = 0, stddev = 1): number {
    const u1 = Math.max(1e-10, this.next())
    const u2 = this.next()
    return mean + Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2) * stddev
  }
  bernoulli(p: number): boolean { return this.next() < p }
  poisson(lambda: number): number {
    if (lambda <= 0) return 0
    const L = Math.exp(-lambda)
    let k = 0, p = 1
    do { k++; p *= this.next() } while (p > L)
    return k - 1
  }
  uniform(lo: number, hi: number): number {
    return lo + this.next() * (hi - lo)
  }
}

// ════════════════════════════════════════════════════════════════
// MAIN ENHANCED RACE SIMULATOR
// ════════════════════════════════════════════════════════════════

interface SingleRunResult {
  totalTimeMs: number
  finalPosition: number
  positionChange: number
  scOccurred: boolean
  vscOccurred: boolean
  finalWear: number
  finalFuel: number
  trafficLossMs: number
  lapDetails: LapDetail[]
}

export class EnhancedRaceSimulator {
  private config: SimulationConfig
  private lapSimulator: LapSimulator
  private opponentModel: OpponentModel
  private evolutionModel: RaceEvolutionModel
  private cache: LRUCache<EnhancedSimulationResult>
  private inertiaState: DecisionInertiaState
  private lastScores: Map<string, number> = new Map()

  constructor(config: SimulationConfig = DEFAULT_SIMULATION_CONFIG) {
    this.config = config
    this.lapSimulator = new LapSimulator(config)
    this.opponentModel = new OpponentModel()
    this.evolutionModel = new RaceEvolutionModel(config)
    this.cache = new LRUCache(config.cache.maxSize, config.cache.ttlMs)
    this.inertiaState = createInertiaState()
  }

  /**
   * Main entry point: evaluate a complete strategy with full probabilistic analysis.
   */
  async evaluateStrategy(context: StrategyContext): Promise<EnhancedSimulationResult> {
    const startTime = Date.now()

    // ── Layer 3: Race Evolution ──
    const raceEvolution = this.evolutionModel.evaluate(context.raceContext)

    // ── Traffic Analysis ──
    const player = context.raceContext.drivers[context.raceContext.playerIndex]
    const rivals = context.raceContext.drivers.filter(
      (_, i) => i !== context.raceContext.playerIndex,
    )
    const trafficAnalysis = analyzeTraffic({
      player,
      rivals,
      track: context.raceContext,
    })

    // ── Rival Strategy Trees ──
    const rivalTrees = buildRivalStrategyTrees(
      context.raceContext,
      context.action.type === 'PIT' ? context.action.targetLap : null,
    )

    // ── Layer 2: Monte Carlo Simulation ──
    const mcResult = this.runEnhancedMonteCarlo(context, raceEvolution)

    // ── Layer 1: Deterministic Baseline (for lap details) ──
    const baseline = this.simulateDeterministicRun(context)

    // ── Build distributions ──
    const distributions = {
      totalTime: mcResult.timeDist,
      positionChange: mcResult.positionChangeDist,
      finalPosition: mcResult.positionDist,
    }

    // ── Compute objectives ──
    const objectives = computeObjectives(
      {
        totalTime: distributions.totalTime,
        positionChange: distributions.positionChange,
        variance: distributions.positionChange.stddev,
        trafficLossMs: trafficAnalysis.cumulativeTrafficLoss,
        tyreLapsRemaining: this.estimateTyreLapsRemaining(context),
        futureOptions: this.countFutureOptions(context),
      },
      {
        totalTimeMs: baseline.totalTime * 1000,
        currentPosition: context.raceContext.position,
      },
    )

    // ── Tyre cliff analysis ──
    const tyreProfile = getDegradationProfile(player.currentCompound)
    const lapsToCliff = Math.max(0,
      (tyreProfile.cliffPhase.wearThreshold - player.tyreWear) /
      Math.max(0.005, tyreProfile.stablePhase.wearRatePerLap),
    )

    // ── Execution plan ──
    const executionPlan = buildExecutionPlan(
      context.action,
      context.raceContext,
      raceEvolution,
      trafficAnalysis,
      lapsToCliff,
    )

    // ── Engineer notes ──
    const engineerNotes = this.generateNotes(context, raceEvolution, trafficAnalysis, mcResult, lapsToCliff)

    // ── Probabilistic confidence ──
    const probConfidence = this.computeProbabilisticConfidence(mcResult, distributions)

    // ── Scenario variance ──
    const scenarioVariance = {
      normalVsNeutralized: Math.abs(
        (mcResult.normalTimeMs - mcResult.neutralizedTimeMs) / Math.max(1, mcResult.normalTimeMs),
      ),
      bestVsWorst: (distributions.totalTime.worstCase - distributions.totalTime.bestCase) /
        Math.max(1, distributions.totalTime.mean),
      crossScenarioStability: 1 - Math.min(1, distributions.totalTime.stddev / Math.max(1, distributions.totalTime.mean)),
    }

    // ── Build backward-compatible base result ──
    const riskProfile = this.computeRiskProfile(baseline.lapDetails, context)
    const scenarioResults: ScenarioResult[] = [
      {
        scenario: RaceScenario.NORMAL,
        probability: 1 - context.scenarioWeights.vsc - context.scenarioWeights.sc,
        totalTime: baseline.totalTime,
        finalPosition: baseline.finalPosition,
        riskProfile,
      },
    ]

    const computeTimeMs = Date.now() - startTime

    const result: EnhancedSimulationResult = {
      // Backward compatible SimulationResult fields
      totalTime: baseline.totalTime,
      expectedPositionChange: distributions.positionChange.mean,
      finalPosition: Math.round(distributions.finalPosition.mean),
      riskProfile,
      monteCarloStats: mcResult.stats,
      lapDetails: baseline.lapDetails,
      scenarioResults,
      metadata: {
        actionId: context.action.id,
        horizonLaps: context.horizonLaps,
        cacheHit: false,
        computeTimeMs,
        monteCarloRuns: mcResult.stats.runs,
      },
      // Enhanced fields
      distributions,
      probabilisticConfidence: probConfidence,
      scenarioVariance,
      engineerNotes,
      raceEvolution,
      trafficAnalysis,
      rivalStrategies: rivalTrees,
      objectives,
      executionPlan,
      inertia: this.inertiaState,
    }

    return result
  }

  /**
   * Evaluate multiple strategies and return the full pipeline output.
   */
  async evaluateAll(
    actions: StrategyAction[],
    raceContext: RaceContext,
    scenarioWeights: { normal: number; vsc: number; sc: number },
  ): Promise<StrategyEngineOutput> {
    const startTime = Date.now()

    // Evaluate each action
    const results: { action: StrategyAction; result: EnhancedSimulationResult; score: number }[] = []

    for (const action of actions) {
      const ctx: StrategyContext = {
        action,
        raceContext,
        horizonLaps: Math.min(30, raceContext.lapsRemaining),
        scenarioWeights,
      }
      const result = await this.evaluateStrategy(ctx)
      const racePhase = result.raceEvolution.racePhase
      const score = scoreObjectives(result.objectives, racePhase)
      results.push({ action, result, score })
    }

    // Sort by score
    results.sort((a, b) => b.score - a.score)

    // Apply decision inertia
    const bestCandidate = results[0]
    const previousScore = this.lastScores.get(this.inertiaState.previousRecommendation ?? '') ?? 0
    const inertiaResult = applyInertia(
      this.inertiaState,
      bestCandidate.action.id,
      bestCandidate.score,
      previousScore,
    )
    this.inertiaState = inertiaResult.updatedState
    this.lastScores.set(bestCandidate.action.id, bestCandidate.score)

    // If inertia prevents switch, reorder
    let recommended: EnhancedSimulationResult
    let alternatives: EnhancedSimulationResult[]
    if (!inertiaResult.shouldSwitch && this.inertiaState.previousRecommendation) {
      const prev = results.find(r => r.action.id === this.inertiaState.previousRecommendation)
      if (prev) {
        recommended = prev.result
        alternatives = results.filter(r => r !== prev).map(r => r.result)
      } else {
        recommended = results[0].result
        alternatives = results.slice(1).map(r => r.result)
      }
    } else {
      recommended = results[0].result
      alternatives = results.slice(1).map(r => r.result)
    }

    // Confidence
    const separation = results.length >= 2
      ? Math.abs(results[0].score - results[1].score)
      : 1.0
    const confidence = Math.min(100, Math.round(
      recommended.probabilisticConfidence * 0.5 +
      Math.min(40, separation * 200) +
      (recommended.monteCarloStats.runs / this.config.monte.maxRuns) * 10,
    ))

    // Engineer briefing
    const player = raceContext.drivers[raceContext.playerIndex]
    const tyreProfile = getDegradationProfile(player.currentCompound)
    const lapsToCliff = Math.max(0,
      (tyreProfile.cliffPhase.wearThreshold - player.tyreWear) /
      Math.max(0.005, tyreProfile.stablePhase.wearRatePerLap),
    )
    const engineerBriefing = generateEngineerBriefing(
      results[0].action,
      recommended.objectives,
      recommended.raceEvolution,
      recommended.trafficAnalysis,
      confidence,
      lapsToCliff,
    )

    const totalRuns = results.reduce((s, r) => s + r.result.monteCarloStats.runs, 0)

    return {
      recommended,
      alternatives,
      confidence,
      separation,
      raceEvolution: recommended.raceEvolution,
      inertia: this.inertiaState,
      engineerBriefing,
      computeTimeMs: Date.now() - startTime,
      totalRuns,
      cacheHit: false,
      timestamp: Date.now(),
    }
  }

  // ════════════════════════════════════════════════════════════════
  // MONTE CARLO ENGINE
  // ════════════════════════════════════════════════════════════════

  private runEnhancedMonteCarlo(
    context: StrategyContext,
    evolution: RaceEvolutionState,
  ): {
    stats: MonteCarloStats
    timeDist: DistributionMetrics
    positionDist: DistributionMetrics
    positionChangeDist: DistributionMetrics
    normalTimeMs: number
    neutralizedTimeMs: number
    scRunCount: number
  } {
    const startTime = Date.now()
    const budget = this.config.monte.adaptiveThreshold > 0
      ? 100  // ms budget
      : Infinity

    const minRuns = this.config.monte.minRuns
    const maxRuns = this.config.monte.maxRuns

    const times: number[] = []
    const positions: number[] = []
    const posChanges: number[] = []
    let normalTimeSum = 0
    let normalCount = 0
    let neutralizedTimeSum = 0
    let neutralizedCount = 0
    let scRuns = 0

    for (let i = 0; i < maxRuns; i++) {
      // Adaptive resolution: stop early if over budget
      if (i >= minRuns && (Date.now() - startTime) > budget) break

      const rng = new PRNG(42 + i * 7919 + context.action.id.charCodeAt(0) * 31)
      const result = this.simulateMonteCarloRun(context, evolution, rng)

      times.push(result.totalTimeMs)
      positions.push(result.finalPosition)
      posChanges.push(result.positionChange)

      if (result.scOccurred || result.vscOccurred) {
        scRuns++
        neutralizedTimeSum += result.totalTimeMs
        neutralizedCount++
      } else {
        normalTimeSum += result.totalTimeMs
        normalCount++
      }
    }

    return {
      stats: this.computeMonteCarloStats(times),
      timeDist: this.computeDistribution(times),
      positionDist: this.computeDistribution(positions),
      positionChangeDist: this.computeDistribution(posChanges),
      normalTimeMs: normalCount > 0 ? normalTimeSum / normalCount : 0,
      neutralizedTimeMs: neutralizedCount > 0 ? neutralizedTimeSum / neutralizedCount : 0,
      scRunCount: scRuns,
    }
  }

  private simulateMonteCarloRun(
    context: StrategyContext,
    evolution: RaceEvolutionState,
    rng: PRNG,
  ): SingleRunResult {
    const { action, raceContext, horizonLaps } = context
    const player = raceContext.drivers[raceContext.playerIndex]
    const track = getTrackPhysics(this.config, raceContext.trackId)

    // Sample SC/VSC events for this run
    let scOccurred = false
    let vscOccurred = false
    const scLaps = new Set<number>()
    const vscLaps = new Set<number>()

    for (let lap = 0; lap < horizonLaps; lap++) {
      if (rng.bernoulli(evolution.scProbabilityPerLap)) {
        scOccurred = true
        const duration = Math.round(rng.uniform(3, 6))
        for (let d = 0; d < duration && lap + d < horizonLaps; d++) scLaps.add(lap + d)
      }
      if (!scLaps.has(lap) && rng.bernoulli(evolution.vscProbabilityPerLap)) {
        vscOccurred = true
        const duration = Math.round(rng.uniform(2, 4))
        for (let d = 0; d < duration && lap + d < horizonLaps; d++) vscLaps.add(lap + d)
      }
    }

    // Simulate laps
    let totalTimeMs = 0
    let wear = player.tyreWear
    let fuel = player.fuelRemaining
    let compound = player.currentCompound
    let stintLap = player.tyreLaps
    let position = raceContext.position
    let trafficLossTotal = 0
    const lapDetails: LapDetail[] = []

    for (let offset = 0; offset < horizonLaps; offset++) {
      const raceLap = raceContext.currentLap + offset
      const isUnderSC = scLaps.has(offset)
      const isUnderVSC = vscLaps.has(offset)
      const isPitLap = action.type === 'PIT' && action.targetLap === raceLap

      // Pit stop
      if (isPitLap) {
        let pitLoss = track.pitLossMean * 1000 + rng.gaussian(0, track.pitLossStdDev * 1000)
        if (isUnderSC) pitLoss *= 0.42
        else if (isUnderVSC) pitLoss *= 0.65
        totalTimeMs += Math.max(12000, pitLoss)
        compound = action.targetCompound
        wear = 0.06 + rng.gaussian(0, 0.01)
        stintLap = 0
      }

      // Lap time computation
      if (isUnderSC) {
        totalTimeMs += player.baseLapTime * 1000 * 1.28 + rng.gaussian(0, 200)
      } else if (isUnderVSC) {
        totalTimeMs += player.baseLapTime * 1000 * 1.15 + rng.gaussian(0, 300)
      } else {
        // Enhanced tyre model
        const tyreDeg = computeTyreDegradation({
          compound,
          currentWear: wear,
          stintLap,
          fuelKg: fuel,
          gapToCarAheadS: player.gapToAhead,
          raceLap,
          totalRaceLaps: raceContext.currentLap + raceContext.lapsRemaining,
          tyreTemp: player.tyreTemp,
        })

        // Fuel weight penalty
        const fuelPenaltyMs = Math.max(0, fuel - 20) * 33

        // Traffic penalty
        const trafficMs = player.gapToAhead < 2
          ? (1 - player.gapToAhead / 2) * 1200 * (0.8 + rng.gaussian(0, 0.15))
          : 0
        trafficLossTotal += Math.max(0, trafficMs)

        const baseLapMs = player.baseLapTime * 1000
        const lapTimeMs = baseLapMs + tyreDeg.totalPenaltyMs + fuelPenaltyMs + trafficMs +
          rng.gaussian(0, baseLapMs * 0.005)
        totalTimeMs += Math.max(baseLapMs * 0.85, lapTimeMs)

        // Advance state
        wear = tyreDeg.newWear
        fuel = Math.max(0, fuel - this.config.physics.fuel.baseBurnPerLap * (1 + rng.gaussian(0, 0.03)))
      }

      stintLap++

      // Position changes (simplified for MC speed)
      if (!isUnderSC && !isUnderVSC && rng.bernoulli(0.05)) {
        position = Math.max(1, position + (rng.bernoulli(0.55) ? -1 : 1))
      }

      lapDetails.push({
        lapNumber: raceLap,
        lapTime: (totalTimeMs / (offset + 1)) / 1000, // avg so far
        tyreWear: wear,
        fuel,
        ersLevel: 0,
        position,
        trafficState: {
          gapAhead: player.gapToAhead,
          gapBehind: player.gapToBehind,
          dirtyAirPenalty: 0,
          drsEnabled: false,
          drsActivated: false,
          drsTrain: false,
          overtakeProbability: 0,
          overtakeSuccess: false,
        },
        isPitLap,
      })
    }

    return {
      totalTimeMs,
      finalPosition: position,
      positionChange: raceContext.position - position,
      scOccurred,
      vscOccurred,
      finalWear: wear,
      finalFuel: fuel,
      trafficLossMs: trafficLossTotal,
      lapDetails,
    }
  }

  // ════════════════════════════════════════════════════════════════
  // DETERMINISTIC BASELINE
  // ════════════════════════════════════════════════════════════════

  private simulateDeterministicRun(context: StrategyContext): {
    totalTime: number
    lapDetails: LapDetail[]
    finalPosition: number
  } {
    const { action, raceContext, horizonLaps } = context
    const track = getTrackPhysics(this.config, raceContext.trackId)
    const player = raceContext.drivers[raceContext.playerIndex]

    let currentState: LapState = {
      lapNumber: raceContext.currentLap,
      compound: player.currentCompound,
      tyreWear: player.tyreWear,
      tyreTemp: player.tyreTemp,
      fuel: player.fuelRemaining,
      ersLevel: player.ersLevel,
      fuelBurnRate: this.config.physics.fuel.baseBurnPerLap,
      fuelMode: action.fuelMode ?? DrivingMode.BALANCED,
      ersMode: action.ersMode ?? DrivingMode.BALANCED,
      baseLapTime: track.baseLapTime,
    }

    let totalTime = 0
    const lapDetails: LapDetail[] = []
    let position = raceContext.position

    for (let offset = 0; offset < horizonLaps; offset++) {
      const lapNumber = raceContext.currentLap + offset
      const isPitLap = action.type === 'PIT' && action.targetLap === lapNumber

      const lapResult = this.lapSimulator.simulateLap(
        currentState,
        {
          lapNumber,
          isPitLap,
          isPitOutLap: isPitLap,
          trafficContext: {
            gapAhead: player.gapToAhead,
            gapBehind: player.gapToBehind,
            trafficDensity: 0.5,
            onWetTrack: raceContext.weather === 'RAIN',
          },
        },
        isPitLap ? action.targetCompound : undefined,
      )

      totalTime += lapResult.lapTime
      currentState = lapResult.updatedState

      lapDetails.push({
        lapNumber,
        lapTime: lapResult.lapTime,
        tyreWear: lapResult.updatedState.tyreWear,
        fuel: lapResult.updatedState.fuel,
        ersLevel: lapResult.updatedState.ersLevel,
        position,
        trafficState: {
          gapAhead: player.gapToAhead,
          gapBehind: player.gapToBehind,
          dirtyAirPenalty: 0,
          drsEnabled: false,
          drsActivated: false,
          drsTrain: false,
          overtakeProbability: 0,
          overtakeSuccess: false,
        },
        isPitLap,
      })
    }

    return { totalTime, lapDetails, finalPosition: position }
  }

  // ════════════════════════════════════════════════════════════════
  // UTILITY METHODS
  // ════════════════════════════════════════════════════════════════

  private computeDistribution(values: number[]): DistributionMetrics {
    if (values.length === 0) {
      return { mean: 0, median: 0, p10: 0, p90: 0, bestCase: 0, worstCase: 0, stddev: 0 }
    }
    const sorted = [...values].sort((a, b) => a - b)
    const n = sorted.length
    const mean = sorted.reduce((a, b) => a + b, 0) / n
    const median = n % 2 === 0 ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2 : sorted[Math.floor(n / 2)]
    const p10 = sorted[Math.max(0, Math.floor(n * 0.1))]
    const p90 = sorted[Math.min(n - 1, Math.floor(n * 0.9))]
    const variance = sorted.reduce((acc, v) => acc + (v - mean) ** 2, 0) / n
    return {
      mean: Math.round(mean * 100) / 100,
      median: Math.round(median * 100) / 100,
      p10: Math.round(p10 * 100) / 100,
      p90: Math.round(p90 * 100) / 100,
      bestCase: Math.round(sorted[0] * 100) / 100,
      worstCase: Math.round(sorted[n - 1] * 100) / 100,
      stddev: Math.round(Math.sqrt(variance) * 100) / 100,
    }
  }

  private computeMonteCarloStats(times: number[]): MonteCarloStats {
    const n = times.length
    if (n === 0) return { runs: 0, mean: 0, variance: 0, stdDev: 0, min: 0, max: 0, percentile50: 0, percentile95: 0 }
    const sorted = [...times].sort((a, b) => a - b)
    const mean = sorted.reduce((a, b) => a + b, 0) / n
    const variance = sorted.reduce((s, x) => s + (x - mean) ** 2, 0) / n
    return {
      runs: n,
      mean,
      variance,
      stdDev: Math.sqrt(variance),
      min: sorted[0],
      max: sorted[n - 1],
      percentile50: sorted[Math.floor(n * 0.5)],
      percentile95: sorted[Math.floor(n * 0.95)],
    }
  }

  private computeProbabilisticConfidence(
    mc: { stats: MonteCarloStats; positionChangeDist: DistributionMetrics },
    distributions: { totalTime: DistributionMetrics },
  ): number {
    // Confidence based on:
    // 1. Outcome stability (low CV = high confidence)
    const cv = mc.stats.mean > 0 ? mc.stats.stdDev / mc.stats.mean : 1
    const stabilityScore = Math.max(0, 1 - cv * 5) * 40

    // 2. Sample size adequacy
    const sampleScore = Math.min(20, mc.stats.runs / this.config.monte.maxRuns * 20)

    // 3. Narrow distribution spread
    const spread = distributions.totalTime.p90 - distributions.totalTime.p10
    const spreadScore = Math.max(0, 30 - spread / 100)

    return Math.min(100, Math.max(0, stabilityScore + sampleScore + spreadScore))
  }

  private computeRiskProfile(lapDetails: LapDetail[], context: StrategyContext): RiskProfile {
    let tyrePunctureRisk = 0
    let trafficRisk = 0
    let ersRisk = 0
    let fuelRisk = 0

    for (const lap of lapDetails) {
      tyrePunctureRisk += lap.tyreWear * 0.5 / lapDetails.length
      fuelRisk += (lap.fuel < 5 ? 0.2 : 0) / lapDetails.length
    }

    const overall = tyrePunctureRisk * 0.4 + trafficRisk * 0.2 + ersRisk * 0.2 + fuelRisk * 0.2
    return {
      tyrePunctureRisk: Math.min(1, tyrePunctureRisk),
      trafficAccidentRisk: Math.min(1, trafficRisk),
      ersDepletionRisk: Math.min(1, ersRisk),
      fuelShortageRisk: Math.min(1, fuelRisk),
      overallRisk: Math.min(1, overall),
      riskBreakdown: {
        tyre: Math.min(1, tyrePunctureRisk),
        traffic: Math.min(1, trafficRisk),
        ers: Math.min(1, ersRisk),
        fuel: Math.min(1, fuelRisk),
      },
    }
  }

  private estimateTyreLapsRemaining(context: StrategyContext): number {
    const player = context.raceContext.drivers[context.raceContext.playerIndex]
    const profile = getDegradationProfile(player.currentCompound)
    const wearRate = Math.max(0.005, profile.stablePhase.wearRatePerLap)
    return Math.max(0, (profile.cliffPhase.wearThreshold - player.tyreWear) / wearRate)
  }

  private countFutureOptions(context: StrategyContext): number {
    const remaining = context.raceContext.lapsRemaining
    let options = 0
    if (remaining > 20) options += 2 // Two-stop possible
    if (remaining > 10) options += 1 // One stop possible
    if (remaining > 5) options += 1  // Late stop possible
    return options
  }

  private generateNotes(
    context: StrategyContext,
    evolution: RaceEvolutionState,
    traffic: SpatialTrafficState,
    mc: { scRunCount: number; stats: MonteCarloStats },
    lapsToCliff: number,
  ): string[] {
    const notes: string[] = []
    const action = context.action

    if (action.type === 'PIT') {
      notes.push(`Box lap ${action.targetLap} → ${action.targetCompound}`)
    } else {
      notes.push('Stay out — manage current compound')
    }

    if (lapsToCliff <= 3) {
      notes.push(`⚠ Tyre cliff in ~${Math.round(lapsToCliff)} laps`)
    }

    if (traffic.cleanAirScore < 40) {
      notes.push(`Traffic: clean air score ${Math.round(traffic.cleanAirScore)}/100`)
    }

    if (traffic.inDrsTrain) {
      notes.push(`In DRS train (${traffic.drsTrainLength} cars)`)
    }

    if (evolution.scProbabilityPerLap > 0.1) {
      notes.push(`SC probability ${Math.round(evolution.scProbabilityPerLap * 100)}%/lap`)
    }

    if (mc.scRunCount > mc.stats.runs * 0.2) {
      notes.push(`SC occurred in ${Math.round(mc.scRunCount / mc.stats.runs * 100)}% of simulations`)
    }

    return notes
  }

  /**
   * Reset inertia (e.g., after pit stop or SC).
   */
  resetInertia(): void {
    this.inertiaState = createInertiaState()
    this.lastScores.clear()
  }

  /**
   * Get cache statistics.
   */
  getCacheStats() {
    return this.cache.getStats()
  }

  /**
   * Clear cache.
   */
  clearCache() {
    this.cache.clear()
  }
}
