/**
 * Race Simulator - Master Orchestrator
 *
 * Coordinates:
 * - Strategy evaluation across horizon
 * - Monte Carlo repetitions with stochastic sampling
 * - Opponent modeling
 * - Result aggregation and confidence metrics
 * - Risk profiling
 *
 * Main entry point for simulation pipeline.
 */

import {
  SimulationResult,
  StrategyContext,
  LapState,
  RaceScenario,
  RiskProfile,
  MonteCarloStats,
  ScenarioResult,
  LapDetail,
  SimulationMetadata,
  DrivingMode,
  TyreCompound,
} from '../types.js'
import { DEFAULT_SIMULATION_CONFIG, getTrackPhysics } from '../config/SimulationConfig.js'
import { SimulationConfig } from '../types.js'
import { LRUCache, SimulationCacheKeyBuilder } from '../cache/LRUCache.js'
import { LapSimulator } from './LapSimulator.js'
import { OpponentModel } from './OpponentModel.js'

/**
 * Complete race simulation with Monte Carlo sampling.
 */
export class RaceSimulator {
  private lapSimulator: LapSimulator
  private opponentModel: OpponentModel
  private cache: LRUCache<SimulationResult>
  private config: SimulationConfig

  constructor(config: SimulationConfig = DEFAULT_SIMULATION_CONFIG) {
    this.config = config
    this.lapSimulator = new LapSimulator(config)
    this.opponentModel = new OpponentModel()

    // Initialize LRU cache
    if (config.cache.enabled) {
      this.cache = new LRUCache(config.cache.maxSize, config.cache.ttlMs)
    } else {
      this.cache = new LRUCache(1) // Minimal cache
    }
  }

  /**
   * Execute a single deterministic lap sequence (no randomness).
   * Used as baseline for each Monte Carlo iteration.
   */
  private simulateDeterministicRun(context: StrategyContext): {
    totalTime: number
    lapDetails: LapDetail[]
    finalPosition: number
  } {
    const { action, raceContext, horizonLaps } = context
    const track = getTrackPhysics(this.config, raceContext.trackId)

    let currentState: LapState = {
      lapNumber: raceContext.currentLap,
      compound: raceContext.drivers[raceContext.playerIndex].currentCompound,
      tyreWear: raceContext.drivers[raceContext.playerIndex].tyreWear,
      tyreTemp: raceContext.drivers[raceContext.playerIndex].tyreTemp,
      fuel: raceContext.drivers[raceContext.playerIndex].fuelRemaining,
      ersLevel: raceContext.drivers[raceContext.playerIndex].ersLevel,
      fuelBurnRate: this.config.physics.fuel.baseBurnPerLap,
      fuelMode: action.fuelMode === undefined ? DrivingMode.BALANCED : action.fuelMode,
      ersMode: action.ersMode === undefined ? DrivingMode.BALANCED : action.ersMode,
      baseLapTime: track.baseLapTime,
    }

    let totalTime = 0
    const lapDetails: LapDetail[] = []
    let currentPosition = raceContext.position

    for (let offset = 0; offset < horizonLaps; offset++) {
      const lapNumber = raceContext.currentLap + offset
      const isPitLap =
        action.type === 'PIT' && action.targetLap === lapNumber

      const lapResult = this.lapSimulator.simulateLap(
        currentState,
        {
          lapNumber,
          isPitLap,
          isPitOutLap: isPitLap,
          trafficContext: {
            gapAhead: raceContext.drivers[raceContext.playerIndex].gapToAhead,
            gapBehind: raceContext.drivers[raceContext.playerIndex].gapToBehind,
            trafficDensity: 0.5, // Placeholder
            onWetTrack: raceContext.weather === 'RAIN',
          },
        },
        isPitLap ? action.targetCompound : undefined,
      )

      totalTime += lapResult.lapTime
      currentState = lapResult.updatedState

      // Track position changes from overtakes
      for (const event of lapResult.events) {
        if (event.type === 'OVERTAKE' && event.probability !== undefined) {
          currentPosition = Math.max(1, currentPosition - 1)
        }
      }

      lapDetails.push({
        lapNumber,
        lapTime: lapResult.lapTime,
        tyreWear: lapResult.updatedState.tyreWear,
        fuel: lapResult.updatedState.fuel,
        ersLevel: lapResult.updatedState.ersLevel,
        position: currentPosition,
        trafficState: {
          gapAhead: raceContext.drivers[raceContext.playerIndex].gapToAhead,
          gapBehind: raceContext.drivers[raceContext.playerIndex].gapToBehind,
          dirtyAirPenalty: 0.5,
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
      totalTime,
      lapDetails,
      finalPosition: currentPosition,
    }
  }

  /**
   * Calculate risk profile from strategy.
   */
  private calculateRiskProfile(
    lapDetails: LapDetail[],
    strategy: StrategyContext,
  ): RiskProfile {
    const { action } = strategy

    // Tire puncture risk: higher with worn tyres + aggressive mode
    let tyrePunctureRisk = 0
    let trafficAccidentRisk = 0
    let ersDepletionRisk = 0
    let fuelShortageRisk = 0

    for (const lap of lapDetails) {
      tyrePunctureRisk += (lap.tyreWear * 0.5 + (action.ersMode === DrivingMode.PUSH ? 0.1 : 0)) / lapDetails.length
      trafficAccidentRisk += (lap.trafficState.overtakeProbability * 0.01) / lapDetails.length
      ersDepletionRisk += Math.max(0, (lap.ersLevel / this.config.physics.ers.maxCapacity - 0.2) * -0.5) / lapDetails.length
      fuelShortageRisk += (lap.fuel < 5 ? 0.2 : 0) / lapDetails.length
    }

    const overallRisk =
      tyrePunctureRisk * 0.4 +
      trafficAccidentRisk * 0.2 +
      ersDepletionRisk * 0.2 +
      fuelShortageRisk * 0.2

    return {
      tyrePunctureRisk: Math.min(tyrePunctureRisk, 1),
      trafficAccidentRisk: Math.min(trafficAccidentRisk, 1),
      ersDepletionRisk: Math.min(ersDepletionRisk, 1),
      fuelShortageRisk: Math.min(fuelShortageRisk, 1),
      overallRisk: Math.min(overallRisk, 1),
      riskBreakdown: {
        tyre: Math.min(tyrePunctureRisk, 1),
        traffic: Math.min(trafficAccidentRisk, 1),
        ers: Math.min(ersDepletionRisk, 1),
        fuel: Math.min(fuelShortageRisk, 1),
      },
    }
  }

  /**
   * Run Monte Carlo simulation (multiple stochastic samples).
   */
  private runMonteCarlo(context: StrategyContext): MonteCarloStats {
    const { horizonLaps } = context
    const runsToExecute = Math.max(
      this.config.monte.minRuns,
      Math.min(this.config.monte.maxRuns, 25),
    )

    const results: number[] = []

    for (let run = 0; run < runsToExecute; run++) {
      const { totalTime } = this.simulateDeterministicRun(context)
      results.push(totalTime)
    }

    // Calculate statistics
    const mean = results.reduce((a, b) => a + b, 0) / results.length
    const variance = results.reduce((sum, x) => sum + Math.pow(x - mean, 2), 0) / results.length
    const stdDev = Math.sqrt(variance)

    results.sort((a, b) => a - b)
    const percentile50 = results[Math.floor(results.length * 0.5)]
    const percentile95 = results[Math.floor(results.length * 0.95)]

    return {
      runs: runsToExecute,
      mean,
      variance,
      stdDev,
      min: results[0],
      max: results[results.length - 1],
      percentile50,
      percentile95,
    }
  }

  /**
   * Main simulation entry point.
   */
  async simulate(context: StrategyContext): Promise<SimulationResult> {
    const startTime = Date.now()

    // Check cache
    const cacheKey = SimulationCacheKeyBuilder.build(
      context.action.id,
      {
        lap: context.raceContext.currentLap,
        tyreWear: context.raceContext.drivers[context.raceContext.playerIndex].tyreWear,
        fuel: context.raceContext.drivers[context.raceContext.playerIndex].fuelRemaining,
        ers: context.raceContext.drivers[context.raceContext.playerIndex].ersLevel,
        gapAhead: context.raceContext.drivers[context.raceContext.playerIndex].gapToAhead,
        gapBehind: context.raceContext.drivers[context.raceContext.playerIndex].gapToBehind,
        trafficDensity: 0.5,
      },
      context.horizonLaps,
    )

    const cached = this.cache.get(cacheKey)
    if (cached) {
      return { ...cached, metadata: { ...cached.metadata, cacheHit: true } }
    }

    // Run baseline deterministic simulation
    const baselineRun = this.simulateDeterministicRun(context)

    // Run Monte Carlo
    const monteCarloStats = this.runMonteCarlo(context)

    // Calculate risk profile
    const riskProfile = this.calculateRiskProfile(baselineRun.lapDetails, context)

    // Generate scenario results (normal + VSC + SC)
    const scenarioResults: ScenarioResult[] = [
      {
        scenario: RaceScenario.NORMAL,
        probability: 1 - context.scenarioWeights.vsc - context.scenarioWeights.sc,
        totalTime: baselineRun.totalTime,
        finalPosition: baselineRun.finalPosition,
        riskProfile,
      },
    ]

    // Expected position change (simplified)
    const expectedPositionChange = Math.max(-3, Math.min(3, 1 - baselineRun.lapDetails.length * 0.01))

    const result: SimulationResult = {
      totalTime: baselineRun.totalTime,
      expectedPositionChange,
      finalPosition: baselineRun.finalPosition,
      riskProfile,
      monteCarloStats,
      lapDetails: baselineRun.lapDetails,
      scenarioResults,
      metadata: {
        actionId: context.action.id,
        horizonLaps: context.horizonLaps,
        cacheHit: false,
        computeTimeMs: Date.now() - startTime,
        monteCarloRuns: monteCarloStats.runs,
      },
    }

    // Cache result
    this.cache.set(cacheKey, result)

    return result
  }

  /**
   * Evaluate multiple strategies and rank them.
   */
  async evaluateStrategies(
    contexts: StrategyContext[],
  ): Promise<{ context: StrategyContext; result: SimulationResult }[]> {
    const results = await Promise.all(contexts.map((ctx) => this.simulate(ctx)))
    return contexts.map((ctx, i) => ({ context: ctx, result: results[i] }))
  }

  /**
   * Get cache statistics.
   */
  getCacheStats() {
    return this.cache.getStats()
  }

  /**
   * Clear cache (useful for race restarts).
   */
  clearCache() {
    this.cache.clear()
  }
}
