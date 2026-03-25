/**
 * Opponent Prediction Model
 *
 * Predicts opponent driver behavior based on:
 * - Tyre age and degradation rate
 * - Fuel consumption patterns
 * - Expected pit windows
 * - Lap time trends (getting faster/slower)
 *
 * Used to evaluate undercut/overcut risks and traffic evolution.
 */

import { DriverState, OpponentPrediction, TyreCompound } from '../types.js'

export interface OpponentContext {
  driver: DriverState
  recentLapTimes: number[] // Last 5-10 lap times
  trackBaseLapTime: number
  lapsTyreUsed: number
  pitWindowOpen: boolean
  pitWindowClosedLaps: number // How many laps until pit window closes
  currentLap: number
}

export class OpponentModel {
  /**
   * Predict next pit lap for opponent.
   * Considers: tyre age, lap time trend, fuel margin, typical pit strategies.
   */
  predictNextPitLap(context: OpponentContext): number | null {
    const { driver, lapsTyreUsed, pitWindowOpen, pitWindowClosedLaps, recentLapTimes } = context

    // If tyres are brand new, likely 20-30 laps before pit required
    if (lapsTyreUsed <= 3) {
      const expectedStintLength = 22
      return context.currentLap + expectedStintLength
    }

    // Tyres degrading: pit window likely open
    if (driver.tyreWear > 0.6 && pitWindowOpen) {
      return context.currentLap + 1 // Pit next lap likely
    }

    // Tyres worn: pit window closing
    if (driver.tyreWear > 0.8) {
      return context.currentLap + 2 // Pit within 2 laps
    }

    // Normal stint: estimate based on compound
    const estimatedStintLength =
      driver.currentCompound === TyreCompound.SOFT
        ? 18
        : driver.currentCompound === TyreCompound.MEDIUM
          ? 22
          : 25

    return lapsTyreUsed + estimatedStintLength
  }

  /**
   * Predict which tyre compound opponent will choose next.
   * Simple heuristic: follow track-typical strategy.
   */
  predictNextCompound(driver: DriverState): TyreCompound {
    // In real implementation, would consider:
    // - Track characteristics
    // - Weather changes
    // - Race position (leaders use softs, tail-enders use hards)
    // - Historical pit strategy trends

    // Simplified: softer compounds for attacking positions
    if (driver.position <= 3) {
      return TyreCompound.SOFT
    }
    if (driver.position <= 10) {
      return TyreCompound.MEDIUM
    }
    return TyreCompound.HARD
  }

  /**
   * Calculate opponent's tyre degradation rate.
   * Based on compound and observed lap time trend.
   */
  calculateTyreDegradationRate(context: OpponentContext): number {
    const { recentLapTimes, trackBaseLapTime } = context

    if (recentLapTimes.length < 2) {
      return 0.03 // Default estimate
    }

    // Simple trend: (latest - earliest) / laps
    const timeTrend = recentLapTimes[recentLapTimes.length - 1] - recentLapTimes[0]
    const lapCount = recentLapTimes.length
    const avgDegradation = timeTrend / lapCount

    // Convert to wear delta per lap
    // Rough mapping: 0.1s slope = 0.03 wear per lap
    return Math.max(0.01, Math.abs(avgDegradation) * 0.3)
  }

  /**
   * Calculate opponent's fuel consumption rate.
   * Based on tyre mode, recent lap times, and typical burn rates.
   */
  calculateFuelConsumptionRate(driver: DriverState): number {
    // Base burn: 1.65 kg/lap
    // Varies by driving mode: PUSH (+0%), SAVE (-16%), etc.
    // Simplified: estimate from position (leaders push more)

    const baseBurn = 1.65
    if (driver.position <= 3) {
      return baseBurn * 1.05 // Pushing for position
    }
    if (driver.position >= 15) {
      return baseBurn * 0.9 // Fuel-saving mode
    }
    return baseBurn
  }

  /**
   * Predict opponent's expected lap time for next stint.
   */
  predictExpectedLapTime(context: OpponentContext): number {
    if (context.recentLapTimes.length === 0) {
      return context.trackBaseLapTime + 1.0 // Add buffer for consistency
    }

    // Average recent laps
    const avgRecentTime =
      context.recentLapTimes.reduce((a, b) => a + b, 0) / context.recentLapTimes.length

    return avgRecentTime
  }

  /**
   * Evaluate undercut risk: if we pit now, can opponent undercut us?
   * High risk if: opponent's next pit is 3+ laps away AND we have gap.
   */
  calculateUndercutRisk(
    playerLap: number,
    opponentContext: OpponentContext,
    gapBetweenCars: number,
  ): number {
    const nextPitLap = this.predictNextPitLap(opponentContext)
    if (nextPitLap === null) return 0

    const lapsUntilOpponentPits = nextPitLap - playerLap

    // Undercut feasible if they can pit within ~3 laps and close gap
    if (lapsUntilOpponentPits <= 3 && gapBetweenCars < 1.5) {
      return 0.7 // High risk
    }

    if (lapsUntilOpponentPits <= 5) {
      return 0.4
    }

    return 0.1
  }

  /**
   * Evaluate overcut risk: if we wait to pit, can opponent gain advantage?
   * High risk if: we're on old tyres AND opponent just pitted (has fresh tyres).
   */
  calculateOvertcutRisk(
    playerTyreAge: number,
    opponentTyreAge: number,
    playerRearGap: number,
  ): number {
    // Opponent recently pitted (tyre age ~0)?
    if (opponentTyreAge <= 2 && playerTyreAge >= 15) {
      // Fresh vs. old: opponent likely faster
      // Gap must be small for them to close it
      if (playerRearGap < 2) {
        return 0.8 // High risk of being overtaken
      }
      return 0.5
    }

    return 0.1
  }

  /**
   * Generate full opponent prediction.
   */
  predictNextMoves(
    driver: DriverState,
    context: OpponentContext,
    gapAhead: number,
    gapBehind: number,
  ): OpponentPrediction {
    return {
      driverId: driver.driverId,
      predictedNextPitLap: this.predictNextPitLap(context),
      predictedCompound: this.predictNextCompound(driver),
      tyreDegradationRate: this.calculateTyreDegradationRate(context),
      fuelConsumptionRate: this.calculateFuelConsumptionRate(driver),
      expectedLapTime: this.predictExpectedLapTime(context),
      undercutRisk: this.calculateUndercutRisk(driver.position, context, gapAhead),
      overcutRisk: this.calculateOvertcutRisk(context.lapsTyreUsed, driver.tyreLaps, gapBehind),
    }
  }
}
