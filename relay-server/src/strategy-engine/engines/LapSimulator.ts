/**
 * Lap Simulator - Core Physics Engine
 *
 * Simulates a single lap with complete physics integration:
 * - Tyre degradation (compound, wear, temperature)
 * - Fuel dynamics (consumption, weight penalty, tyre interaction)
 * - ERS system (charging, deployment, overtaking boost)
 * - Traffic effects (dirty air, DRS, overtaking)
 * - Pit stops (with scenario branching)
 * - Stochastic noise (realistic variability)
 *
 * All functions are pure (no side effects) and immutable.
 */

import { LapState, LapResult, LapEvent, TyreCompound, RaceScenario, SimulationConfig } from '../types.js'
import { getTrackPhysics } from '../config/SimulationConfig.js'
import { TyrePhysicsModel } from '../models/TyrePhysicsModel.js'
import { FuelConsumptionModel } from '../models/FuelConsumptionModel.js'
import { ERSModel } from '../models/ERSModel.js'
import { TrafficModel } from '../models/TrafficModel.js'
import { PitStopModel } from '../models/PitStopModel.js'

export interface LapSimulatorContext {
  lapNumber: number
  isPitLap: boolean
  pitStopScenario?: RaceScenario
  isPitOutLap: boolean
  trafficContext: {
    gapAhead: number
    gapBehind: number
    trafficDensity: number
    onWetTrack: boolean
  }
  randomSeed?: number
}

export class LapSimulator {
  private tyreModel: TyrePhysicsModel
  private fuelModel: FuelConsumptionModel
  private ersModel: ERSModel
  private trafficModel: TrafficModel
  private pitStopModel: PitStopModel
  private random: () => number

  constructor(private config: SimulationConfig) {
    this.tyreModel = new TyrePhysicsModel(config)
    this.fuelModel = new FuelConsumptionModel(config)
    this.ersModel = new ERSModel(config)
    this.trafficModel = new TrafficModel(config)
    this.pitStopModel = new PitStopModel(config)

    // Optional: seeded random for deterministic testing
    if (config.monte.randomSeed !== undefined) {
      const seed = config.monte.randomSeed
      this.random = this.seededRandom(seed)
    } else {
      this.random = Math.random
    }
  }

  /**
   * Simple seeded random number generator for reproducibility.
   */
  private seededRandom(seed: number): () => number {
    let value = seed
    return () => {
      value = (value * 9301 + 49297) % 233280
      return value / 233280
    }
  }

  /**
   * Add Gaussian noise to lap time (realistic driver variability).
   */
  private addNoise(baseTime: number, stdDev: number = this.config.models.noiseStdDev): number {
    // Box-Muller transform for Gaussian distribution
    const u1 = this.random()
    const u2 = this.random()
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
    return baseTime + z * stdDev
  }

  /**
   * Simulate a clean (non-pit) lap.
   */
  simulateCleanLap(state: LapState, context: LapSimulatorContext): LapResult {
    const track = getTrackPhysics(this.config, context.lapNumber.toString())

    // Tyre simulation
    const tyreResult = this.tyreModel.simulateLap({
      compound: state.compound,
      wear: state.tyreWear,
      temp: state.tyreTemp,
      fuelLoad: state.fuel,
      drivingMode: state.fuelMode,
      trackId: track.id,
      isWarmupLap: context.lapNumber <= 2,
    })

    // Fuel simulation
    const fuelResult = this.fuelModel.simulateLap({
      currentFuel: state.fuel,
      fuelRemaining: state.fuel,
      drivingMode: state.fuelMode,
      baseLapTime: state.baseLapTime,
      baseLapBurn: this.config.physics.fuel.baseBurnPerLap,
      trackId: track.id,
    })

    // ERS simulation
    const ersResult = this.ersModel.simulateLap({
      currentLevel: state.ersLevel,
      drivingMode: state.ersMode,
      trackId: track.id,
      isHighDownforceLap: false,
    })

    // Traffic simulation
    const trafficResult = this.trafficModel.simulateLap(
      {
        gapAhead: context.trafficContext.gapAhead,
        gapBehind: context.trafficContext.gapBehind,
        carAheadBaseLapTime: state.baseLapTime,
        drsDistance: 1.0,
        trafficDensity: context.trafficContext.trafficDensity,
        onWetTrack: context.trafficContext.onWetTrack,
      },
      this.random,
    )

    // Aggregate lap time components
    const aggregateLapTime =
      state.baseLapTime +
      tyreResult.lapTime +
      fuelResult.lapTimePenalty +
      ersResult.lapTimeDelta +
      trafficResult.lapTimeLoss

    // Add realistic noise
    const noisyLapTime = this.addNoise(aggregateLapTime)

    // Update state for next lap
    const updatedState: LapState = {
      ...state,
      tyreWear: Math.min(tyreResult.wearDelta, 1),
      tyreTemp: state.tyreTemp + tyreResult.tempChange,
      fuel: fuelResult.nextFuel,
      ersLevel: ersResult.nextLevel,
    }

    // Generate events (graining, blistering, etc.)
    const events: LapEvent[] = []
    if (tyreResult.grainingLevel > 0.5) {
      events.push({
        type: 'TYRE_GRAINING',
        probability: tyreResult.grainingLevel,
        impact: 0.5,
      })
    }
    if (tyreResult.blisteringLevel > 0.5) {
      events.push({
        type: 'TYRE_BLISTERING',
        probability: tyreResult.blisteringLevel,
        impact: 1.0,
      })
    }
    if (trafficResult.drsActivated) {
      events.push({
        type: 'DRS_ENABLED',
        probability: 1.0,
        impact: -0.5,
      })
    }
    if (trafficResult.overtakeSuccessful) {
      events.push({
        type: 'OVERTAKE',
        probability: trafficResult.overtakeProbability,
        impact: 1.0,
      })
    }

    return {
      lapNumber: context.lapNumber,
      lapTime: Math.max(noisyLapTime, state.baseLapTime * 0.85), // Sanity check
      components: {
        baseline: state.baseLapTime,
        tyreWear: tyreResult.lapTime,
        tyreDegradation: tyreResult.lapTimePenalty,
        fuelPenalty: fuelResult.lapTimePenalty,
        ersPenalty: -ersResult.lapTimeDelta, // Negative = gain
        trafficLoss: trafficResult.lapTimeLoss,
        warmupPenalty: 0, // Embedded in tyre penalty
        noiseDeviation: noisyLapTime - aggregateLapTime,
      },
      updatedState,
      events,
    }
  }

  /**
   * Simulate a pit lap (pit entry + stop + pit exit).
   * Branches based on SC/VSC/normal scenario.
   */
  simulatePitLap(
    state: LapState,
    context: LapSimulatorContext,
    newCompound: TyreCompound,
  ): LapResult {
    const track = getTrackPhysics(this.config, context.lapNumber.toString())

    // Generate pit stop scenarios
    const pitScenarios = this.pitStopModel.generateScenarios({
      trackId: track.id,
      pitLap: context.lapNumber,
      totalLaps: 58, // Default; would be from race context
      gapToLeader: context.trafficContext.gapAhead,
    })

    // Select scenario based on context
    const scenario =
      context.pitStopScenario === RaceScenario.SAFETY_CAR
        ? pitScenarios.find((s) => s.scenario === RaceScenario.SAFETY_CAR)!
        : context.pitStopScenario === RaceScenario.VIRTUAL_SAFETY_CAR
          ? pitScenarios.find((s) => s.scenario === RaceScenario.VIRTUAL_SAFETY_CAR)!
          : pitScenarios.find((s) => s.scenario === RaceScenario.NORMAL)!

    // Pit stop cost
    const totalPitCost = scenario.totalPitCost

    // New compound: tyres are fresh (low wear, warm temps from building)
    const updatedState: LapState = {
      ...state,
      compound: newCompound,
      tyreWear: 0.04, // Minimal wear building on pit lane
      tyreTemp: 89, // Fresh out of gun; warm but not peak
      fuel: 40, // Refilled  to approximately 40kg (strategy dependent)
      ersLevel: Math.min(state.ersLevel + 1_500_000, this.config.physics.ers.maxCapacity), // Pit recharge
    }

    return {
      lapNumber: context.lapNumber,
      lapTime: totalPitCost,
      components: {
        baseline: state.baseLapTime,
        tyreWear: 0,
        tyreDegradation: 0,
        fuelPenalty: 0,
        ersPenalty: 0,
        trafficLoss: 0,
        warmupPenalty: 0,
        noiseDeviation: 0,
      },
      updatedState,
      events: [
        {
          type: 'OVERTAKE',
          probability: scenario.undercutPotential,
          impact: scenario.undercutPotential,
        },
      ],
    }
  }

  /**
   * Simulate a complete lap sequence (clean or pit).
   */
  simulateLap(
    state: LapState,
    context: LapSimulatorContext,
    newCompound?: TyreCompound,
  ): LapResult {
    if (context.isPitLap) {
      return this.simulatePitLap(state, context, newCompound || state.compound)
    }
    return this.simulateCleanLap(state, context)
  }

  /**
   * Get simulator configuration for external diagnostics.
   */
  getConfig() {
    return {
      noiseStdDev: this.config.models.noiseStdDev,
      scProbability: this.config.models.scProbability,
      vscProbability: this.config.models.vscProbability,
    }
  }
}
