/**
 * INTEGRATION GUIDE: Replacing Legacy PitStrategySimulator
 *
 * This guide shows how to migrate from the old PitStrategySimulator
 * to the new advanced F1 strategy engine.
 *
 * File: /workspaces/f1/relay-server/src/strategy/StrategyEngineIntegration.ts
 */

/**
 * ============================================================================
 * STEP 1: BEFORE (Legacy Usage)
 * ============================================================================
 *
 * Old code in strategy trainer or main simulation loop:
 *
 * ```typescript
 * import { PitStrategySimulator } from './pitStrategySimulator.js'
 *
 * const oldSimulator = new PitStrategySimulator()
 * const result = oldSimulator.simulate({
 *   action: { id: 'pit', type: 'PIT', delay: 0 },
 *   state: {
 *     lap: 15,
 *     tyreWear: 0.65,
 *     fuel: 35,
 *     gap: 1.2,
 *     trackId: 'SILVERSTONE'
 *   },
 *   horizonLaps: 8
 * })
 *
 * console.log(result.totalTime)  // Old format: ~220s
 * ```
 */

import { LegacyStrategyAdapter } from '../strategy-engine/LegacyAdapter.js'
import { legacyStrategyAdapter } from '../strategy-engine/LegacyAdapter.js'

/**
 * ============================================================================
 * STEP 2: MIGRATION PATHS
 * ============================================================================
 */

// PATH A: Drop-in Replacement (Minimal Code Changes)
// ─────────────────────────────────────────────────────
export class StrategySimulatorV2 {
  private adapter: LegacyStrategyAdapter

  constructor() {
    this.adapter = legacyStrategyAdapter
  }

  simulate(action: any, state: any, horizonLaps: number = 8) {
    // Create legacy context from old state format
    const context = {
      lap: state.lap,
      tyreWear: state.tyreWear,
      fuel: state.fuel,
      ers: state.ers || 0,
      gapAhead: state.gap,
      gapBehind: state.gapBehind || 1.5,
      trafficDensity: 0.3,
      currentCompound: state.currentCompound || 'MEDIUM',
      baseLapTime: state.baseLapTime || 88.5,
      trackId: state.trackId,
      scProbability: state.scProbability || 0.05,
      vscProbability: state.vscProbability || 0.08,
    }

    // Create legacy action from old format
    const legacyAction = {
      id: action.id || 'action',
      type: action.type || 'STAY',
      pitDelayLaps: action.delay || 0,
      compound: action.compound || 'KEEP',
    }

    return this.adapter.simulate(legacyAction, context, horizonLaps)
  }

  getCacheStats() {
    return this.adapter.getCacheStats()
  }
}

/**
 * ============================================================================
 * STEP 3: AFTER (New Advanced Usage)
 * ============================================================================
 *
 * New code using full capabilities:
 *
 * ```typescript
 * import { RaceSimulator } from './strategy-engine/engines/RaceSimulator.js'
 * import { DEFAULT_SIMULATION_CONFIG } from './strategy-engine/config/SimulationConfig.js'
 *
 * const advancedEngine = new RaceSimulator(DEFAULT_SIMULATION_CONFIG)
 *
 * const result = await advancedEngine.simulate({
 *   action: {
 *     id: 'pit-soft',
 *     type: 'PIT',
 *     targetLap: 15,
 *     targetCompound: TyreCompound.SOFT,
 *     fuelMode: DrivingMode.SAVE,
 *     ersMode: DrivingMode.HARVEST
 *   },
 *   raceContext: {
 *     currentLap: 14,
 *     position: 8,
 *     trackId: 'SILVERSTONE',
 *     drivers: [{...}],
 *     playerIndex: 0,
 *     lapsRemaining: 53,
 *     weather: 'DRY'
 *   },
 *   horizonLaps: 10,
 *   scenarioWeights: { normal: 0.87, vsc: 0.08, sc: 0.05 }
 * })
 *
 * // New result format with full breakdown:
 * console.log(result.monteCarloStats.mean)        // 224.5s (Monte Carlo mean)
 * console.log(result.monteCarloStats.stdDev)      // 3.2s (Standard deviation)
 * console.log(result.monteCarloStats.percentile95) // 230.1s (95th percentile)
 * console.log(result.riskProfile)                 // {tyrePuncture: 0.02, traffic: 0.05, ...}
 * ```
 */

/**
 * ============================================================================
 * STEP 4: CONFIGURATION TUNING
 * ============================================================================
 */

import { DEFAULT_SIMULATION_CONFIG, getTrackPhysics } from '../strategy-engine/config/SimulationConfig.js'

export class ConfigurationTuner {
  /**
   * Adjust tyre degradation model for more aggressive driving
   */
  static createAggressiveConfig() {
    const config = { ...DEFAULT_SIMULATION_CONFIG }
    config.tuning.tyreDegradationFactor = 1.2 // +20% more wear
    config.tuning.riskTyrePuncture = 0.18 // +50% puncture risk
    return config
  }

  /**
   * Adjust for conservative race management
   */
  static createConservativeConfig() {
    const config = { ...DEFAULT_SIMULATION_CONFIG }
    config.tuning.tyreDegradationFactor = 0.85 // -15% wear
    config.tuning.riskTyrePuncture = 0.05 // -60% puncture risk
    config.tuning.undercutEffectiveness = 0.7 // Less effective undercut
    return config
  }

  /**
   * Get track-specific configuration
   */
  static getTrackConfig(trackId: string) {
    return getTrackPhysics(DEFAULT_SIMULATION_CONFIG, trackId)
  }
}

/**
 * ============================================================================
 * STEP 5: BATCH EVALUATION EXAMPLE
 * ============================================================================
 */

export async function evaluateStrategyAlternatives(raceContext: any) {
  const engine = new RaceSimulator(DEFAULT_SIMULATION_CONFIG)

  const actions = [
    { id: 'pit-now', type: 'PIT' as const, targetLap: raceContext.currentLap + 1, targetCompound: 'SOFT' },
    { id: 'pit-lap-2', type: 'PIT' as const, targetLap: raceContext.currentLap + 2, targetCompound: 'MEDIUM' },
    { id: 'stay', type: 'STAY' as const, targetLap: raceContext.currentLap + 3, targetCompound: 'SOFT' },
  ]

  const contexts = actions.map((action) => ({
    action,
    raceContext,
    horizonLaps: 8,
    scenarioWeights: { normal: 0.87, vsc: 0.08, sc: 0.05 },
  }))

  // Batch evaluate (runs in parallel if pooled)
  const results = await engine.evaluateStrategies(contexts)

  // Rank by expected value
  const ranked = results
    .map((result, i) => ({
      actionId: actions[i].id,
      totalTime: result.monteCarloStats.mean,
      riskScore: result.riskProfile.overallRisk,
      rank: 0,
    }))
    .sort((a, b) => {
      // Minimize time + penalize risk
      const scoreA = a.totalTime + a.riskScore * 10
      const scoreB = b.totalTime + b.riskScore * 10
      return scoreA - scoreB
    })
    .map((item, idx) => ({ ...item, rank: idx + 1 }))

  return ranked
}

/**
 * ============================================================================
 * STEP 6: MIGRATION CHECKLIST
 * ============================================================================
 *
 * 1. Update imports in `strategyTrainer.js`:
 *    BEFORE: import { PitStrategySimulator } from './pitStrategySimulator.js'
 *    AFTER:  import { StrategySimulatorV2 } from './strategy/StrategyEngineIntegration.ts'
 *
 * 2. Update instantiation:
 *    BEFORE: const sim = new PitStrategySimulator()
 *    AFTER:  const sim = new StrategySimulatorV2()
 *
 * 3. Update calls (existing code works unchanged):
 *    const result = sim.simulate(action, state, 8)
 *    console.log(result.totalTime)  // Works with both old & new
 *
 * 4. Gradually adopt advanced features:
 *    - Use MonteCarloStats for confidence intervals
 *    - Use RiskProfile for decision support
 *    - Use LRU cache stats for performance monitoring
 *    - Tune config for specific race conditions
 *
 * 5. Decommission old code when confident:
 *    - Delete /workspaces/f1/relay-server/src/strategy/pitStrategySimulator.js
 *    - Delete old type definitions
 *    - Remove legacy test cases
 *
 * ============================================================================
 */

/**
 * Example of gradually adopting new features
 */
export async function adaptiveStrategyDecision(context: any, aggressiveness: number) {
  const adapter = new LegacyStrategyAdapter()

  // Still compatible with old interface
  const legacyResult = await adapter.simulate(
    {
      id: 'test',
      type: 'PIT',
      pitDelayLaps: 1,
      compound: 'SOFT',
    },
    {
      lap: context.lap,
      tyreWear: context.tyreWear,
      fuel: context.fuel,
      ers: context.ers,
      gapAhead: context.gapAhead,
      gapBehind: context.gapBehind,
      trafficDensity: 0.3,
      currentCompound: 'MEDIUM',
      baseLapTime: 88.5,
      trackId: context.trackId,
    },
    8,
  )

  // But access new features via the engine
  const engine = adapter.getEngine()
  const cacheStats = adapter.getCacheStats()

  // Gradually adopt: use new Monte Carlo stats
  console.log(`Decision confidence: ${cacheStats}`)

  // Scale risk tolerance by aggressiveness
  let shouldPit = legacyResult.totalTime < 210
  if (aggressiveness > 0.7 && legacyResult.risk < 0.3) {
    shouldPit = true
  } else if (aggressiveness < 0.3 && legacyResult.risk > 0.5) {
    shouldPit = false
  }

  return {
    action: shouldPit ? 'PIT' : 'STAY',
    confidence: 1 - legacyResult.risk,
    reasoning: `${legacyResult.totalTime.toFixed(1)}s horizon time, ${(legacyResult.risk * 100).toFixed(0)}% risk`,
  }
}

/**
 * ============================================================================
 * STEP 7: MONITORING & DEBUGGING
 * ============================================================================
 */

export class StrategyEngineMonitor {
  private adapter: LegacyStrategyAdapter
  private decisions: any[] = []

  constructor() {
    this.adapter = legacyStrategyAdapter
  }

  /**
   * Log decision for analytics and debugging
   */
  async logDecision(action: any, context: any, decision: string) {
    const stats = this.adapter.getCacheStats()
    this.decisions.push({
      timestamp: Date.now(),
      action,
      context: { lap: context.lap, tyreWear: context.tyreWear, fuel: context.fuel },
      decision,
      cacheStats: stats,
    })
  }

  /**
   * Get cache efficiency report
   */
  getCacheEfficiency() {
    const stats = this.adapter.getCacheStats()
    const hits = (stats as any).hits || 0
    const total = hits + (stats as any).misses || 1
    return {
      hitRate: (hits / total) * 100,
      cacheSize: (stats as any).size,
      capacity: (stats as any).capacity,
      utilization: ((stats as any).size / (stats as any).capacity) * 100,
    }
  }

  /**
   * Export decision history for offline analysis
   */
  exportDecisionHistory() {
    return this.decisions
  }
}
