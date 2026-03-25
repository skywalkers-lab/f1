/**
 * Race Evolution Model
 * ====================
 * Predicts external race events and evolving race conditions.
 *
 * Responsibilities:
 *   - Safety car probability based on historical frequency + traffic density
 *   - VSC likelihood under high cluster compression
 *   - Pit window compression during neutralized states
 *   - Dynamic pit loss recalculation based on evolving race control
 *   - Track evolution (rubber-in) modeling
 *   - Fuel-corrected lap time improvement
 *
 * Updates probabilities every lap and feeds into scenario weighting.
 */

import {
  RaceEvolutionState,
  RaceContext,
  SimulationConfig,
  TrackPhysics,
  DriverState,
} from '../types.js'
import { getTrackPhysics } from '../config/SimulationConfig.js'

// ── Historical SC/VSC rates per phase of race ──
const PHASE_SC_MULTIPLIER = {
  early: 2.2,   // Lap 1-5: incidents 2.2x baseline
  mid: 1.0,     // Lap 6-70%: baseline
  late: 1.35,   // Last 30%: fatigue/desperation
} as const

const PHASE_VSC_MULTIPLIER = {
  early: 1.6,
  mid: 1.0,
  late: 1.5,
} as const

// ── Weather multipliers for incident rates ──
const WEATHER_SC_MULTIPLIER: Record<string, number> = {
  WEATHER_0: 1.0,   // Clear
  WEATHER_1: 1.15,  // Light cloud
  WEATHER_2: 1.3,   // Overcast
  WEATHER_3: 1.8,   // Light rain
  WEATHER_4: 2.5,   // Heavy rain
  WEATHER_5: 3.2,   // Storm
}

export class RaceEvolutionModel {
  private config: SimulationConfig
  /** Rolling history of computed SC probabilities for trend analysis */
  private scProbabilityHistory: number[] = []
  private lastComputedLap: number = -1

  constructor(config: SimulationConfig) {
    this.config = config
  }

  /**
   * Compute the current race evolution state.
   * Should be called once per lap or whenever race conditions change.
   */
  evaluate(context: RaceContext): RaceEvolutionState {
    const track = getTrackPhysics(this.config, context.trackId)
    const phase = this.determineRacePhase(context)
    const clusterCompression = this.computeClusterCompression(context.drivers)
    const incidentDensity = this.computeIncidentDensity(context, clusterCompression)

    // SC probability per lap
    const baseScRate = this.config.models.scProbability
    const phaseMultSC = PHASE_SC_MULTIPLIER[phase]
    const weatherMult = WEATHER_SC_MULTIPLIER[context.weather === 'RAIN' ? 'WEATHER_4' : 'WEATHER_0'] ?? 1.0
    const trafficMult = 1 + clusterCompression * 0.45
    const wearMult = this.computeWearIncidentMultiplier(context.drivers)
    const scProbPerLap = Math.min(0.35, baseScRate * phaseMultSC * weatherMult * trafficMult * wearMult)

    // VSC probability per lap
    const baseVscRate = this.config.models.vscProbability
    const phaseMultVSC = PHASE_VSC_MULTIPLIER[phase]
    // High cluster compression specifically elevates VSC probability
    const clusterVscMult = clusterCompression > 0.6 ? 1 + (clusterCompression - 0.6) * 2.5 : 1.0
    const vscProbPerLap = Math.min(0.30, baseVscRate * phaseMultVSC * weatherMult * clusterVscMult)

    // Pit window compression during neutralized race
    const pitWindowCompression = this.computePitWindowCompression(context)

    // Dynamic pit loss
    const effectivePitLoss = this.computeEffectivePitLoss(track, context, scProbPerLap, vscProbPerLap)

    // Track evolution
    const trackEvoDelta = this.computeTrackEvolution(context.currentLap, context.lapsRemaining + context.currentLap)

    // Fuel correction
    const fuelCorrPerLap = this.computeFuelCorrection(context)

    // Track history
    if (context.currentLap !== this.lastComputedLap) {
      this.scProbabilityHistory.push(scProbPerLap)
      if (this.scProbabilityHistory.length > 30) this.scProbabilityHistory.shift()
      this.lastComputedLap = context.currentLap
    }

    return {
      scProbabilityPerLap: scProbPerLap,
      vscProbabilityPerLap: vscProbPerLap,
      pitWindowCompression,
      effectivePitLoss,
      trackEvolutionDelta: trackEvoDelta,
      fuelCorrectionPerLap: fuelCorrPerLap,
      racePhase: phase,
      incidentDensity,
      clusterCompression,
    }
  }

  /**
   * Determine race phase based on progress.
   */
  private determineRacePhase(ctx: RaceContext): 'early' | 'mid' | 'late' {
    const totalLaps = ctx.currentLap + ctx.lapsRemaining
    const progress = ctx.currentLap / Math.max(1, totalLaps)
    if (progress < 0.15) return 'early'
    if (progress > 0.70) return 'late'
    return 'mid'
  }

  /**
   * Compute field cluster compression (0-1).
   * Higher values mean cars are bunched up, increasing incident probability.
   */
  private computeClusterCompression(drivers: DriverState[]): number {
    if (drivers.length < 2) return 0

    // Count cars within 2 seconds of their nearest neighbor
    let closeCount = 0
    const sortedByGap = [...drivers].sort((a, b) => a.gapToLeader - b.gapToLeader)

    for (let i = 1; i < sortedByGap.length; i++) {
      const gap = sortedByGap[i].gapToLeader - sortedByGap[i - 1].gapToLeader
      if (gap < 2.0) closeCount++
    }

    return Math.min(1, closeCount / Math.max(1, drivers.length - 1))
  }

  /**
   * Compute incident density factor.
   */
  private computeIncidentDensity(ctx: RaceContext, clusterCompression: number): number {
    // Base density from cluster compression
    let density = clusterCompression * 0.6

    // Worn tyres increase incident risk
    const avgWear = ctx.drivers.reduce((s, d) => s + d.tyreWear, 0) / Math.max(1, ctx.drivers.length)
    if (avgWear > 0.6) density += (avgWear - 0.6) * 0.5

    // Late race urgency
    if (this.determineRacePhase(ctx) === 'late') density += 0.15

    return Math.min(1, density)
  }

  /**
   * Compute wear-based incident multiplier.
   * Worn tyres → more lockups, punctures, erratic behavior.
   */
  private computeWearIncidentMultiplier(drivers: DriverState[]): number {
    if (drivers.length === 0) return 1.0
    const avgWear = drivers.reduce((s, d) => s + d.tyreWear, 0) / drivers.length
    // Cars on cliff produce more incidents
    const cliffCount = drivers.filter(d => d.tyreWear > 0.75).length
    const cliffFraction = cliffCount / drivers.length
    return 1.0 + Math.max(0, avgWear - 0.4) * 0.6 + cliffFraction * 0.8
  }

  /**
   * Pit window compression: during SC/VSC, all cars pit for reduced cost.
   * This returns a compression factor (1.0 = normal, <1.0 = compressed).
   */
  private computePitWindowCompression(ctx: RaceContext): number {
    // Estimate how many cars are likely to pit in the current window
    const nearPitDrivers = ctx.drivers.filter(d => d.tyreWear > 0.55).length
    const pitWindowDensity = nearPitDrivers / Math.max(1, ctx.drivers.length)

    // If many cars need pitting, the window is compressed (everyone pits together)
    return Math.max(0.3, 1.0 - pitWindowDensity * 0.4)
  }

  /**
   * Compute effective pit loss accounting for SC/VSC probability.
   * If SC is likely, the expected pit loss is lower.
   */
  private computeEffectivePitLoss(
    track: TrackPhysics,
    ctx: RaceContext,
    scProb: number,
    vscProb: number,
  ): number {
    const normalPitLoss = track.pitLossMean
    const scPitLoss = normalPitLoss * 0.42  // ~58% reduction under SC
    const vscPitLoss = normalPitLoss * 0.65 // ~35% reduction under VSC

    // Expected pit loss = weighted average by probability
    const normalProb = Math.max(0, 1 - scProb - vscProb)
    return normalPitLoss * normalProb + scPitLoss * scProb + vscPitLoss * vscProb
  }

  /**
   * Track evolution: rubber-in effect that reduces lap times.
   * Returns improvement in seconds per lap.
   */
  private computeTrackEvolution(currentLap: number, totalLaps: number): number {
    // Track rubbers in logarithmically — fast early, diminishing returns
    const progress = currentLap / Math.max(1, totalLaps)
    // Peak improvement ~0.15s by mid-race, then stable
    const maxImprovement = 0.15
    return maxImprovement * Math.min(1, Math.log(1 + progress * 8) / Math.log(9))
  }

  /**
   * Fuel correction: lap time improvement as fuel burns off.
   * Returns improvement in seconds per lap for fuel weight reduction.
   */
  private computeFuelCorrection(ctx: RaceContext): number {
    const player = ctx.drivers[ctx.playerIndex]
    if (!player) return 0
    // ~0.033s per kg per lap improvement (F1 standard)
    const burnPerLap = this.config.physics.fuel.baseBurnPerLap
    return burnPerLap * this.config.physics.fuel.loadFactor
  }

  /**
   * Get the SC probability cumulative over N laps from now.
   */
  getCumulativeSCProbability(perLapProb: number, horizonLaps: number): number {
    // P(at least 1 SC in N laps) = 1 - (1-p)^N
    return 1 - Math.pow(1 - perLapProb, horizonLaps)
  }

  /**
   * Scenario conditional value: how much does this strategy benefit from SC?
   */
  computeSCConditionalValue(
    normalGain: number,
    scGain: number,
    scProb: number,
  ): number {
    return normalGain * (1 - scProb) + scGain * scProb
  }
}
