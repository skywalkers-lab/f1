/**
 * Public API and re-exports for the Strategy Engine.
 * Simplified interface for integration with existing codebase.
 */

// Types
export * from './types.js'

// Configuration
export { DEFAULT_SIMULATION_CONFIG, createSimulationConfig, getTrackPhysics, getCompoundPhysics } from './config/SimulationConfig.js'
export type { SimulationConfig } from './types.js'

// Cache
export { LRUCache, SimulationCacheKeyBuilder } from './cache/LRUCache.js'

// Models
export { TyrePhysicsModel } from './models/TyrePhysicsModel.js'
export { FuelConsumptionModel } from './models/FuelConsumptionModel.js'
export { ERSModel } from './models/ERSModel.js'
export { TrafficModel } from './models/TrafficModel.js'
export { PitStopModel } from './models/PitStopModel.js'
export { RaceEvolutionModel } from './models/RaceEvolutionModel.js'
export { computeTyreDegradation, getDegradationProfile, projectTyreDegradation } from './models/EnhancedTyreModel.js'
export { analyzeTraffic, projectTrafficForScenario } from './models/SpatialTrafficModel.js'
export { buildRivalStrategyTrees, projectRival } from './models/RivalStrategyModel.js'

// Engines
export { LapSimulator } from './engines/LapSimulator.js'
export { RaceSimulator } from './engines/RaceSimulator.js'
export { OpponentModel } from './engines/OpponentModel.js'
export { EnhancedRaceSimulator } from './engines/EnhancedRaceSimulator.js'
export {
  computeObjectives,
  scoreObjectives,
  applyInertia,
  createInertiaState,
  buildExecutionPlan,
  generateEngineerBriefing,
} from './engines/DecisionEngine.js'

/**
 * Simplified factory function for creating a pre-configured strategy engine.
 */
export async function createStrategyEngine() {
  const { DEFAULT_SIMULATION_CONFIG } = await import('./config/SimulationConfig.js')
  const { RaceSimulator } = await import('./engines/RaceSimulator.js')

  return new RaceSimulator(DEFAULT_SIMULATION_CONFIG)
}

/**
 * Factory for the enhanced multi-layer strategy engine.
 */
export async function createEnhancedStrategyEngine() {
  const { DEFAULT_SIMULATION_CONFIG } = await import('./config/SimulationConfig.js')
  const { EnhancedRaceSimulator } = await import('./engines/EnhancedRaceSimulator.js')

  return new EnhancedRaceSimulator(DEFAULT_SIMULATION_CONFIG)
}
