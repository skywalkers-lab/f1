/**
 * Adapter Layer: Legacy PitStrategySimulator → New Advanced Engine
 *
 * Provides backward compatibility with existing code while using the new
 * advanced simulation engine under the hood.
 *
 * Usage:
 *   const adapter = new LegacyStrategyAdapter(config)
 *   const result = adapter.simulate(action, context, horizonLaps)
 *   // Returns result compatible with old PitStrategySimulator interface
 */

import {
  SimulationConfig,
  StrategyContext,
  SimulationResult,
  RaceContext,
  TyreCompound,
  DrivingMode,
} from './types.js'
import { DEFAULT_SIMULATION_CONFIG, getTrackPhysics } from './config/SimulationConfig.js'
import { RaceSimulator } from './engines/RaceSimulator.js'

/**
 * Legacy interface for backward compatibility.
 */
export interface LegacySimulationResult {
  actionId: string
  horizonLaps: number
  totalTime: number
  expectedPositionGain: number
  undercutGain: number
  overcutGain: number
  pitCost: number
  warmupPenaltyTotal: number
  trafficJoinProbability: number
  clusterDensity: number
  risk: number
  details: {
    lapOffset: number
    lapTime: number
    tyreWear: number
    warmupPenalty: number
    trafficPenalty: number
  }[]
}

export interface LegacyStrategyAction {
  id: string
  type: 'PIT' | 'STAY'
  pitDelayLaps: number
  compound?: TyreCompound | 'KEEP'
  ersMode?: string
  fuelMode?: string
}

export interface LegacyContext {
  lap: number
  tyreWear: number
  fuel: number
  ers: number
  gapAhead: number
  gapBehind: number
  trafficDensity: number
  currentCompound?: TyreCompound
  baseLapTime: number
  trackId: string
  scProbability?: number
  vscProbability?: number
  tyreTemp?: number
  fuelBurnPerLap?: number
  maxErs?: number
  nearbyGaps?: number[]
  clusterGapThreshold?: number
  predictedPitRejoinGap?: number
}

/**
 * Adapter class for legacy interface.
 */
export class LegacyStrategyAdapter {
  private engine: RaceSimulator
  private config: SimulationConfig

  constructor(config: SimulationConfig = DEFAULT_SIMULATION_CONFIG) {
    this.config = config
    this.engine = new RaceSimulator(config)
  }

  /**
   * Convert legacy action to new format.
   */
  private convertAction(action: LegacyStrategyAction, context: LegacyContext) {
    const targetLap = context.lap + (action.pitDelayLaps || 0)
    const targetCompound =
      action.compound === 'KEEP'
        ? (context.currentCompound || TyreCompound.MEDIUM)
        : (action.compound as TyreCompound) || TyreCompound.MEDIUM

    return {
      id: action.id,
      type: action.type as 'PIT' | 'STAY',
      targetLap,
      targetCompound,
      fuelMode: (action.fuelMode as DrivingMode) || DrivingMode.BALANCED,
      ersMode: (action.ersMode as DrivingMode) || DrivingMode.BALANCED,
    }
  }

  /**
   * Convert legacy context to new format.
   */
  private convertContext(action: LegacyStrategyAction, context: LegacyContext): RaceContext {
    const track = getTrackPhysics(this.config, context.trackId)

    return {
      currentLap: context.lap,
      position: 8, // Placeholder; would need to come from context
      trackId: context.trackId,
      drivers: [
        {
          driverId: 0,
          position: 8,
          tyreLaps: Math.floor((1 - context.tyreWear) * 25),
          currentCompound: context.currentCompound || TyreCompound.MEDIUM,
          tyreWear: context.tyreWear,
          tyreTemp: context.tyreTemp || 92,
          fuelRemaining: context.fuel,
          ersLevel: context.ers,
          baseLapTime: context.baseLapTime,
          gapToLeader: context.gapAhead * 2,
          gapToAhead: context.gapAhead,
          gapToBehind: context.gapBehind,
          lastLapTime: context.baseLapTime + 1.0,
        },
      ],
      playerIndex: 0,
      lapsRemaining: 52,
      weather: 'DRY',
      trackTemp: 30,
      raceTime: Date.now(),
    }
  }

  /**
   * Simulate using legacy interface (maintains backward compatibility).
   */
  async simulate(
    action: LegacyStrategyAction,
    context: LegacyContext,
    horizonLaps: number = 8,
  ): Promise<LegacySimulationResult> {
    const convertedAction = this.convertAction(action, context)
    const convertedContext = this.convertContext(action, context)

    const strategyContext: StrategyContext = {
      action: convertedAction,
      raceContext: convertedContext,
      horizonLaps: Math.max(3, Math.min(10, horizonLaps)),
      scenarioWeights: {
        normal: 1 - (context.scProbability || 0.05) - (context.vscProbability || 0.08),
        vsc: context.vscProbability || 0.08,
        sc: context.scProbability || 0.05,
      },
    }

    const result = await this.engine.simulate(strategyContext)

    // Convert back to legacy format
    return this.convertResult(result, action)
  }

  /**
   * Convert new SimulationResult back to legacy format.
   */
  private convertResult(result: SimulationResult, action: LegacyStrategyAction): LegacySimulationResult {
    // Calculate undercut/overcut gains from lap details
    let undercutGain = 0
    let overcutGain = 0
    let warmupPenaltyTotal = 0
    let pitCostLocal = 0

    for (const lap of result.lapDetails) {
      if (lap.isPitLap) {
        pitCostLocal = lap.lapTime
        warmupPenaltyTotal += Math.max(0, lap.lapTime - 90) * 0.5 // Approximate
      }
    }

    // Simplified undercut/overcut calculation
    if (action.type === 'PIT' && action.pitDelayLaps === 0) {
      undercutGain = Math.max(0, 1.5 - pitCostLocal / 30)
    } else if (action.type === 'STAY') {
      overcutGain = Math.max(0, 1.0 - result.riskProfile.overallRisk * 2)
    }

    return {
      actionId: action.id,
      horizonLaps: result.lapDetails.length,
      totalTime: result.totalTime,
      expectedPositionGain: result.expectedPositionChange,
      undercutGain,
      overcutGain,
      pitCost: pitCostLocal,
      warmupPenaltyTotal,
      trafficJoinProbability: 0.5, // Placeholder
      clusterDensity: 0.3, // Placeholder
      risk: result.riskProfile.overallRisk,
      details: result.lapDetails.map((lap, i) => ({
        lapOffset: i,
        lapTime: lap.lapTime,
        tyreWear: lap.tyreWear,
        warmupPenalty: i === 0 ? 0.5 : 0,
        trafficPenalty: lap.trafficState.dirtyAirPenalty,
      })),
    }
  }

  /**
   * Get internal engine for advanced usage.
   */
  getEngine(): RaceSimulator {
    return this.engine
  }

  /**
   * Get cache statistics.
   */
  getCacheStats() {
    return this.engine.getCacheStats()
  }

  /**
   * Clear cache.
   */
  clearCache() {
    this.engine.clearCache()
  }
}

/**
 * Export pre-configured adapter for drop-in replacement.
 */
export const legacyStrategyAdapter = new LegacyStrategyAdapter(DEFAULT_SIMULATION_CONFIG)
