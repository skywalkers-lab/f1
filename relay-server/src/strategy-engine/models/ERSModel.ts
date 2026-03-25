/**
 * ERS (Energy Recovery System) Model
 * Simulates F1 hybrid ERS: battery charging/discharging, lap time effects,
 * deployment strategy, and overtaking capability.
 */

import { DrivingMode, SimulationConfig } from '../types.js'

export interface ERSModelContext {
  currentLevel: number // Joules
  drivingMode: DrivingMode
  trackId: string
  isHighDownforceLap: boolean // VSC/SC laps = high harvesting potential
}

export interface ERSLapResult {
  deltaEnergy: number // Positive = charging, negative = discharging
  nextLevel: number
  lapTimeDelta: number
  overtakeProbabilityBoost: number
}

export class ERSModel {
  constructor(private config: SimulationConfig) {}

  /**
   * Calculate energy recovery per lap.
   * Baseline recovery from kinetic + thermal energy.
   * Can be enhanced by HARVEST mode or in high-speed corners.
   * VSC/SC laps allow full battery recharge due to lower speeds.
   */
  private calculateRecovery(
    drivingMode: DrivingMode,
    isHighDownforceLap: boolean,
  ): number {
    const base = this.config.physics.ers.chargeRatePerLap
    const modeMultiplier =
      drivingMode === DrivingMode.HARVEST ? 1.3 : drivingMode === DrivingMode.SAVE ? 1.1 : 1

    // VSC/SC: full recovery + additional brake energy
    const scModeBoost = isHighDownforceLap ? 2.5 : 1

    return base * modeMultiplier * scModeBoost
  }

  /**
   * Calculate energy deployment per lap.
   * PUSH: aggressive deployment for lap time gain
   * BALANCED: tactical deployment
   * HARVEST/SAVE: minimal/no deployment
   */
  private calculateDeployment(drivingMode: DrivingMode): number {
    return drivingMode === DrivingMode.PUSH
      ? this.config.physics.ers.pushModeDrain
      : drivingMode === DrivingMode.BALANCED
        ? this.config.physics.ers.pushModeDrain * 0.5
        : 0
  }

  /**
   * Calculate lap time effect from ERS usage.
   * PUSH: -0.18s (speed boost on straights)
   * BALANCED: -0.09s (partial deployment)
   * HARVEST/SAVE: 0s
   *
   * In practice, ERS is often deployed in final sector or specific corners.
   */
  private calculateLapTimeGain(drivingMode: DrivingMode, ersLevel: number): number {
    const maxCapacity = this.config.physics.ers.maxCapacity

    if (drivingMode === DrivingMode.PUSH) {
      // Gain diminishes if ERS is depleted (can't activate PUSH safely)
      const chargeRatio = Math.min(ersLevel / maxCapacity, 1)
      return -this.config.physics.ers.pushModeGain * Math.sqrt(chargeRatio)
    }

    if (drivingMode === DrivingMode.BALANCED) {
      const chargeRatio = Math.min(ersLevel / maxCapacity, 1)
      return -this.config.physics.ers.pushModeGain * 0.5 * chargeRatio
    }

    return 0
  }

  /**
   * Calculate overtaking probability boost from ERS deployment.
   * Fresh ERS → +30% overtake probability
   * Depleted ERS → no boost
   */
  private calculateOvertakeProbabilityBoost(
    drivingMode: DrivingMode,
    ersLevel: number,
  ): number {
    if (drivingMode !== DrivingMode.PUSH) return 0

    const maxCapacity = this.config.physics.ers.maxCapacity
    const chargeRatio = Math.min(ersLevel / maxCapacity, 1)

    return 0.3 * chargeRatio * (ersLevel > maxCapacity * 0.1 ? 1 : 0.5)
  }

  /**
   * Simulate single lap ERS dynamics.
   */
  simulateLap(context: ERSModelContext): ERSLapResult {
    const recovery = this.calculateRecovery(context.drivingMode, context.isHighDownforceLap)
    const deployment = this.calculateDeployment(context.drivingMode)

    const deltaEnergy = recovery - deployment
    const nextLevel = Math.max(0, Math.min(context.currentLevel + deltaEnergy, this.config.physics.ers.maxCapacity))

    const lapTimeDelta = this.calculateLapTimeGain(context.drivingMode, context.currentLevel)
    const overtakeProbabilityBoost = this.calculateOvertakeProbabilityBoost(
      context.drivingMode,
      context.currentLevel,
    )

    return {
      deltaEnergy,
      nextLevel,
      lapTimeDelta,
      overtakeProbabilityBoost,
    }
  }

  /**
   * Check if PUSH mode is sustainable (enough charge for desired usage).
   */
  canPush(currentLevel: number, lapsRemaining: number): boolean {
    const pushDeployment = this.config.physics.ers.pushModeDrain
    const minChargeForPush = pushDeployment * 0.5 // 50% of deployment capacity
    return currentLevel >= minChargeForPush
  }

  /**
   * Get ERS configuration for external planning.
   */
  getConfig() {
    return {
      maxCapacity: this.config.physics.ers.maxCapacity,
      chargeRatePerLap: this.config.physics.ers.chargeRatePerLap,
      pushModeDrain: this.config.physics.ers.pushModeDrain,
      harvestModeRecharge: this.config.physics.ers.harvestModeRecharge,
      pushModeGain: this.config.physics.ers.pushModeGain,
      harvestModeGain: this.config.physics.ers.harvestModeGain,
    }
  }
}
