/**
 * Centralized simulation configuration.
 * All magic numbers are defined here for easy tuning and experimentation.
 */

import {
  SimulationConfig,
  TyreCompound,
  DrivingMode,
  TrackPhysics,
  CompoundPhysics,
} from '../types.js'

/**
 * Default F1 track parameters based on 2024 season characteristics.
 */
function createTrackPhysics(id: string, name: string, baseLapTime: number): TrackPhysics {
  return {
    id,
    name,
    baseLapTime,
    pitLossMean: 22.5,
    pitLossStdDev: 0.8,
    dirtyAirFactor: 0.92,
    drsGain: 0.95,
    lengthKm: 5.0,
  }
}

/**
 * Tyre compound physics.
 * Degradation curves are piecewise functions reflecting real F1 tyre behavior.
 */
function createCompoundPhysics(
  compound: TyreCompound,
  wearRate: number,
  grainingSusceptibility: number,
): CompoundPhysics {
  return {
    wearRate,
    degradationCurve: {
      phase1: { wearThreshold: 0.3, factor: 0.8 },
      phase2: { wearThreshold: 0.7, factor: 1.5 },
      phase3: { factor: 3.2 },
    },
    grainingSusceptibility,
    blisteringSusceptibility: grainingSusceptibility * 0.6,
    warmupLaps: compound === TyreCompound.HARD ? 5 : compound === TyreCompound.MEDIUM ? 3 : 2,
  }
}

export const DEFAULT_SIMULATION_CONFIG: SimulationConfig = {
  physics: {
    // Track-specific parameters (expanded example set)
    tracks: {
      TRACK_0: createTrackPhysics('TRACK_0', 'Bahrain', 89.5),
      TRACK_1: createTrackPhysics('TRACK_1', 'Saudi Arabia', 88.2),
      TRACK_2: createTrackPhysics('TRACK_2', 'Australia', 90.1),
      TRACK_5: createTrackPhysics('TRACK_5', 'Monaco', 78.3),
      TRACK_10: createTrackPhysics('TRACK_10', 'Hungary', 87.4),
      TRACK_13: createTrackPhysics('TRACK_13', 'Monza', 85.7),
      TRACK_14: createTrackPhysics('TRACK_14', 'Singapore', 98.2),
      TRACK_16: createTrackPhysics('TRACK_16', 'Abu Dhabi', 89.8),
    },

    // Tyre compound characteristics
    compounds: {
      [TyreCompound.SOFT]: createCompoundPhysics(TyreCompound.SOFT, 0.041, 0.75),
      [TyreCompound.MEDIUM]: createCompoundPhysics(TyreCompound.MEDIUM, 0.031, 0.55),
      [TyreCompound.HARD]: createCompoundPhysics(TyreCompound.HARD, 0.024, 0.35),
    },

    // Aerodynamics parameters
    aerodynamics: {
      drsOptimalSpeed: 320,
      dirtyAirStartGap: 1.2,
      dirtyAirMaxPenalty: 1.8,
    },

    // Fuel consumption model
    fuel: {
      baseBurnPerLap: 1.65,
      loadFactor: 0.0835, // Time increase per 10kg fuel
      saveModeReduction: 0.16, // Fuel consumption reduction in SAVE mode
      tyreDegradationMultiplier: 0.22, // Tyres wear faster with high fuel load
    },

    // ERS system parameters
    ers: {
      maxCapacity: 4_000_000, // Joules
      chargeRatePerLap: 1_500_000, // Baseline from kinetic + thermal recovery
      pushModeDrain: 2_100_000, // Drain per lap when pushing
      harvestModeRecharge: 1_800_000, // Additional recharge in harvest
      harvestModeGain: -0.22, // Lap time penalty when harvesting
      pushModeGain: -0.18, // Lap time gain when pushing
    },
  },

  models: {
    // Lap time variability (driver error, weather micro-changes, etc.)
    noiseStdDev: 0.3,

    // Traffic density scaling
    trafficDensityFactor: 1.0,

    // Safety car probabilities (tuned to realistic F1 values)
    scProbability: 0.06,
    vscProbability: 0.12,
  },

  monte: {
    minRuns: 20,
    maxRuns: 50,
    // Coefficient of variation threshold for adaptive stopping
    adaptiveThreshold: 0.05,
    // Optional seed for deterministic testing
    randomSeed: undefined,
  },

  cache: {
    // LRU cache size (approx. 2048 entries × ~2KB per entry = 4MB)
    maxSize: 2048,
    // Cache TTL: 30 seconds
    ttlMs: 30_000,
    enabled: true,
  },

  tuning: {
    // Undercut effectiveness (0-1 scale)
    undercutEffectiveness: 0.85,

    // Overcut stability (0-1 scale)
    overcutStability: 0.72,

    // Risk scaling factors
    riskTyrePuncture: 0.12,
    riskTrafficAccident: 0.18,
    riskERSDepletion: 0.08,
    riskFuelShortage: 0.15,

    // Pit stop reliability factors
    pitLostLapsMultiplier: 1.0,
    crewErrorProbability: 0.02,
    mechanicalFailureProbability: 0.01,

    // Traffic model parameters
    overtakeProbabilityGap3: 0.45,
    overtakeProbabilityGap2: 0.65,
    overtakeProbabilityGap1: 0.85,

    // DRS effectiveness
    drsMultiplier: 0.75,

    // Pit rejoin gap modeling
    pitRejoinGapBase: 1.5,
    pitRejoinGapVariance: 0.3,
  },
}

/**
 * Create a simulation config with custom overrides.
 * All undefined values fall back to defaults.
 */
export function createSimulationConfig(
  overrides?: Partial<SimulationConfig>,
): SimulationConfig {
  return {
    physics: {
      ...DEFAULT_SIMULATION_CONFIG.physics,
      ...overrides?.physics,
    },
    models: {
      ...DEFAULT_SIMULATION_CONFIG.models,
      ...overrides?.models,
    },
    monte: {
      ...DEFAULT_SIMULATION_CONFIG.monte,
      ...overrides?.monte,
    },
    cache: {
      ...DEFAULT_SIMULATION_CONFIG.cache,
      ...overrides?.cache,
    },
    tuning: {
      ...DEFAULT_SIMULATION_CONFIG.tuning,
      ...overrides?.tuning,
    },
  }
}

/**
 * Get track physics by track ID with fallback to default.
 */
export function getTrackPhysics(
  config: SimulationConfig,
  trackId: string,
): TrackPhysics {
  return (
    config.physics.tracks[trackId] ||
    config.physics.tracks.TRACK_10 || // Default fallback
    DEFAULT_SIMULATION_CONFIG.physics.tracks.TRACK_10!
  )
}

/**
 * Get compound physics by compound type.
 */
export function getCompoundPhysics(
  config: SimulationConfig,
  compound: TyreCompound,
): CompoundPhysics {
  return (
    config.physics.compounds[compound] ||
    config.physics.compounds[TyreCompound.MEDIUM] ||
    DEFAULT_SIMULATION_CONFIG.physics.compounds[TyreCompound.MEDIUM]!
  )
}
