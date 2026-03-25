/**
 * Pit Stop Model with Scenario Branching
 * Implements realistic pit stop dynamics with three scenarios:
 * NORMAL (no cautions), VSC (Virtual Safety Car), SC (Safety Car).
 */

import { RaceScenario, SimulationConfig } from '../types.js'

export interface PitStopContext {
  trackId: string
  pitLap: number
  totalLaps: number
  gapToLeader: number
}

export interface PitStopScenario {
  scenario: RaceScenario
  probability: number
  pitInLapTime: number
  pitStopDuration: number // Pit stop location + crew work + exit
  pitOutLapTime: number
  totalPitCost: number
  undercutPotential: number
  overcutRisk: number
}

/**
 * Realistic pit stop simulation with scenario branching.
 */
export class PitStopModel {
  constructor(private config: SimulationConfig) {}

  /**
   * Get pit stop base time for a track.
   * Typically 20-26s depending on track layout and pit lane length.
   */
  private getPitStopBaseTime(trackId: string): number {
    // Track-specific pit stop times (lap loss + crew time + pit lane penalties)
    const pitTimes: Record<string, number> = {
      TRACK_0: 23.5,
      TRACK_1: 25.2,
      TRACK_2: 22.8,
      TRACK_5: 24.0, // Monaco: long pit lane
      TRACK_10: 21.5, // Hungary: shorter pit lane
      TRACK_13: 18.9, // Monza: short pit stop
      TRACK_14: 24.5, // Singapore: long pit lane
      TRACK_16: 23.8,
    }
    return pitTimes[trackId] || 22.5
  }

  /**
   * Get pit-in lap time (lap with pit stop entry).
   * Typically ~2-3 seconds loss from pit entry + pit lane.
   */
  private getPitInLapTime(): number {
    return 2.5 // Variable per track; can be refined
  }

  /**
   * Get pit-out lap time (exit to racing line, tyres cold).
   * New soft tyres are cold on exit; gradual warmup over first lap.
   * Typically 1-2 seconds slower than baseline.
   */
  private getPitOutLapTime(): number {
    return 1.8
  }

  /**
   * NORMAL scenario: standard pit stop with no cautions.
   * All laps proceed as normal; pit stop cost = in + stop + out.
   */
  private calculateNormalScenario(baseStopTime: number): PitStopScenario {
    const totalPitCost = this.getPitInLapTime() + baseStopTime + this.getPitOutLapTime()

    // Pit stop reliability
    const crewErrorProbability = this.config.tuning.crewErrorProbability || 0.02
    const mechanicalFailureProbability = this.config.tuning.mechanicalFailureProbability || 0.01
    const reliabilityFactor = 1 - (crewErrorProbability + mechanicalFailureProbability)

    return {
      scenario: RaceScenario.NORMAL,
      probability: 1 - this.config.models.scProbability - this.config.models.vscProbability,
      pitInLapTime: this.getPitInLapTime(),
      pitStopDuration: baseStopTime,
      pitOutLapTime: this.getPitOutLapTime(),
      totalPitCost: totalPitCost * reliabilityFactor,
      undercutPotential: 0.85 * (this.config.tuning.undercutEffectiveness || 0.85),
      overcutRisk: 0.15 * (1 - (this.config.tuning.overcutStability || 0.72)),
    }
  }

  /**
   * VSC scenario: Virtual Safety Car (no track caution, but pace car in effect).
   * - Pit entry: essentially normal (~2.5s)
   * - Pit stop: normal (~21-25s)
   * - Pit exit: slightly better (deployed cars run slower during VSC)
   * - Probability: moderate (10-15% per stint)
   */
  private calculateVSCScenario(baseStopTime: number): PitStopScenario {
    const pitInTime = this.getPitInLapTime() * 0.95 // Slightly clearer pit lane
    const pitStopTime = baseStopTime * 0.98 // Marginally faster crew
    const pitOutTime = this.getPitOutLapTime() * 0.92 // Easier exit due to pace car

    const totalPitCost = pitInTime + pitStopTime + pitOutTime

    return {
      scenario: RaceScenario.VIRTUAL_SAFETY_CAR,
      probability: this.config.models.vscProbability,
      pitInLapTime: pitInTime,
      pitStopDuration: pitStopTime,
      pitOutLapTime: pitOutTime,
      totalPitCost,
      undercutPotential: 0.95 * (this.config.tuning.undercutEffectiveness || 0.85),
      overcutRisk: 0.08, // Lower risk in VSC
    }
  }

  /**
   * SC scenario: Safety Car (full track caution, slower pace).
   * - Pit entry: longer (~4-5s due to pit lane queue and congestion)
   * - Pit stop: compressed time due to field backing up (~19-22s)
   * - Pit exit: excellent (deployed cars are held back by pace car)
   * - Probability: lower (5-8% per stint)
   *
   * SC is strategically powerful: pit stop cost can be recouped by controlled exits.
   */
  private calculateSCScenario(baseStopTime: number): PitStopScenario {
    const pitInTime = this.getPitInLapTime() * 1.4 // Congested pit lane
    const pitStopTime = baseStopTime * 0.88 // Faster crew (compressed cycle)
    const pitOutTime = this.getPitOutLapTime() * 0.65 // Excellent speed advantage

    const totalPitCost = pitInTime + pitStopTime + pitOutTime

    return {
      scenario: RaceScenario.SAFETY_CAR,
      probability: this.config.models.scProbability,
      pitInLapTime: pitInTime,
      pitStopDuration: pitStopTime,
      pitOutLapTime: pitOutTime,
      totalPitCost,
      undercutPotential: 1.0 * (this.config.tuning.undercutEffectiveness || 0.85),
      overcutRisk: 0.02, // Minimal risk; SC is ideal for pitting
    }
  }

  /**
   * Calculate undercut potential: gap closed by pitting early.
   * Formula: gap_reduction = pit_savings × undercut_effectiveness
   */
  private calculateUndercutGain(
    gapToLeader: number,
    scenario: PitStopScenario,
  ): number {
    // Undercut works when: leader hasn't pitted yet, we pit fresh tyres
    // Effective gain: ~0.3-0.5s per lap difference × number of laps
    if (gapToLeader <= 0) return 0 // We're ahead, no undercut needed

    // Simplified: assume undercut recovers ~40-60% of gap over 3 laps
    const undercutRecoverable = gapToLeader * 0.5
    return Math.min(undercutRecoverable, 2.0) * scenario.undercutPotential
  }

  /**
   * Calculate overcut risk: gap lost by staying out longer.
   * Formula: gap_loss = additional_laps × (new_car_speed - old_tyre_speed)
   */
  private calculateOvertcutRisk(lapsGainedByWaiting: number, scenario: PitStopScenario): number {
    // Each additional lap on old tyres: ~0.2-0.4s lost vs fresh tyres
    // Example: 3 laps on worn Medium = -3 × 0.3 = -0.9s to leader
    const lapTimeLossPerLap = 0.3
    return lapsGainedByWaiting * lapTimeLossPerLap * scenario.overcutRisk
  }

  /**
   * Generate pit stop scenarios for a given pit stop decision.
   * Returns three branches (normal/VSC/SC) with probabilities.
   */
  generateScenarios(context: PitStopContext): PitStopScenario[] {
    const baseStopTime = this.getPitStopBaseTime(context.trackId)

    return [
      this.calculateNormalScenario(baseStopTime),
      this.calculateVSCScenario(baseStopTime),
      this.calculateSCScenario(baseStopTime),
    ]
  }

  /**
   * Calculate expected pit cost (probability-weighted average).
   */
  getExpectedPitCost(scenarios: PitStopScenario[]): number {
    return scenarios.reduce((sum, s) => sum + s.totalPitCost * s.probability, 0)
  }

  /**
   * Get pit stop configuration for external use.
   */
  getConfig() {
    return {
      scProbability: this.config.models.scProbability,
      vscProbability: this.config.models.vscProbability,
      undercutEffectiveness: this.config.tuning.undercutEffectiveness,
      overcutStability: this.config.tuning.overcutStability,
    }
  }
}
