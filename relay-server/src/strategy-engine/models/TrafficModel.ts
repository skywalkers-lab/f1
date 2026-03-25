/**
 * Traffic Model
 * Simulates realistic F1 traffic: dirty air effects, DRS, overtaking probabilities,
 * and gap-based performance loss.
 */

import { SimulationConfig } from '../types.js'

export interface TrafficModelContext {
  gapAhead: number // Seconds
  gapBehind: number // Seconds
  carAheadBaseLapTime: number
  drsDistance: number // Optimal DRS range
  trafficDensity: number // 0-1 scale
  onWetTrack: boolean
}

export interface TrafficLapResult {
  dirtyAirPenalty: number
  drsEnabled: boolean
  drsActivated: boolean
  overtakeProbability: number
  overtakeSuccessful: boolean
  lapTimeLoss: number
}

export class TrafficModel {
  constructor(private config: SimulationConfig) {}

  /**
   * Calculate dirty air penalty from leading car.
   *
   * Gap < 1.0s: full dirty air penalty (-1.8s typical)
   * Gap 1.0-2.0s: decreasing penalty (aerodynamic wake extends ~1.5s)
   * Gap > 2.0s: no meaningful penalty
   *
   * Effect is non-linear and track-dependent.
   */
  private calculateDirtyAirPenalty(gapAhead: number, onWetTrack: boolean): number {
    const maxPenalty = 1.8
    const effectiveRange = this.config.physics.aerodynamics.dirtyAirStartGap // 1.2s

    if (gapAhead >= effectiveRange * 2) {
      return 0
    }

    if (gapAhead <= 0) {
      return maxPenalty * (onWetTrack ? 0.6 : 1) // Reduced in wet
    }

    // Linear decay from max penalty to zero
    const normalizedGap = gapAhead / (effectiveRange * 2)
    const penalty = maxPenalty * (1 - normalizedGap)

    return onWetTrack ? penalty * 0.7 : penalty
  }

  /**
   * Determine if DRS is enabled.
   * DRS requires: gap ≤ 1.0s AND not raining significantly.
   */
  private isDRSEnabled(gapAhead: number, onWetTrack: boolean): boolean {
    return gapAhead <= 1.0 && !onWetTrack
  }

  /**
   * Calculate overtaking probability curve.
   * Depends on:
   * - Gap to car ahead (closer = more overlap, higher overtake chance)
   * - Relative pace (are we faster?)
   * - DRS availability
   * - Track layout (not explicitly modeled, use track-specific tuning)
   */
  private calculateOvertakeProbability(
    gapAhead: number,
    relativePace: number,
    drsActivated: boolean,
  ): number {
    if (gapAhead > 3) {
      return 0 // Too far back
    }

    let baseProbability = 0

    if (gapAhead <= 1) {
      // Close combat
      baseProbability = 0.45
    } else if (gapAhead <= 2) {
      baseProbability = 0.25
    } else {
      baseProbability = 0.08
    }

    // Boost from being faster (relative pace > 0 = we're faster)
    const paceBoost = Math.max(0, relativePace * 0.5)

    // DRS advantage
    const drsMultiplier = drsActivated ? 1.5 : 1

    return Math.min(baseProbability + paceBoost, 0.95) * drsMultiplier
  }

  /**
   * Model overtaking outcome stochastically.
   * Generates random outcome based on probability.
   */
  private simulateOvertake(
    probability: number,
    random: () => number = Math.random,
  ): boolean {
    return random() < probability
  }

  /**
   * Calculate lap time loss from traffic.
   *
   * Components:
   * 1. Dirty air penalty (if trailing)
   * 2. Loss from failed overtake attempt (if attempted and failed)
   * 3. General traffic congestion (if density > 0.7)
   */
  private calculateLapTimeLoss(
    dirtyAirPenalty: number,
    overtakeAttempted: boolean,
    overtakeSuccessful: boolean,
    trafficDensity: number,
  ): number {
    let loss = dirtyAirPenalty

    // Failed overtake: additional penalty from defensive driving
    if (overtakeAttempted && !overtakeSuccessful) {
      loss += 0.3 // 0.3s for defensive line, traffic navigation
    }

    // General congestion slowdown
    if (trafficDensity > 0.7) {
      loss += (trafficDensity - 0.7) * 0.8 // Up to 0.24s additional in heavy traffic
    }

    return loss
  }

  /**
   * Simulate single lap traffic interaction.
   */
  simulateLap(
    context: TrafficModelContext,
    random: () => number = Math.random,
  ): TrafficLapResult {
    const dirtyAirPenalty = this.calculateDirtyAirPenalty(context.gapAhead, context.onWetTrack)
    const drsEnabled = this.isDRSEnabled(context.gapAhead, context.onWetTrack)

    // Simplified relative pace: assume we match the car ahead's base time
    // In reality, would need explicit faster/slower determination
    const relativePace = 0

    const overtakeProbability = this.calculateOvertakeProbability(
      context.gapAhead,
      relativePace,
      drsEnabled,
    )

    // Should we attempt overtake? (simplified heuristic)
    const shouldAttempt = overtakeProbability > 0.25 && context.gapAhead <= 2
    const overtakeSuccessful = shouldAttempt ? this.simulateOvertake(overtakeProbability, random) : false

    const lapTimeLoss = this.calculateLapTimeLoss(
      dirtyAirPenalty,
      shouldAttempt,
      overtakeSuccessful,
      context.trafficDensity,
    )

    return {
      dirtyAirPenalty,
      drsEnabled,
      drsActivated: drsEnabled && shouldAttempt,
      overtakeProbability: shouldAttempt ? overtakeProbability : 0,
      overtakeSuccessful,
      lapTimeLoss,
    }
  }

  /**
   * Estimate gap evolution after overtake.
   * If successful: we move ahead (new car in front is tracked).
   * If failed: gap may increase slightly (defensive driving).
   */
  estimateGapAfterOvertake(
    currentGap: number,
    overtakeSuccessful: boolean,
  ): number {
    if (overtakeSuccessful) {
      // We're now ahead; new gap to next car ahead (assumed 2-3s initially)
      return 0.5
    } else {
      // Failed overtake: we fall back slightly
      return currentGap + 0.2
    }
  }

  /**
   * Get traffic configuration for external planning.
   */
  getConfig() {
    return {
      dirtyAirStartGap: this.config.physics.aerodynamics.dirtyAirStartGap,
      dirtyAirMaxPenalty: this.config.physics.aerodynamics.dirtyAirMaxPenalty,
      drsOptimalSpeed: this.config.physics.aerodynamics.drsOptimalSpeed,
    }
  }
}
