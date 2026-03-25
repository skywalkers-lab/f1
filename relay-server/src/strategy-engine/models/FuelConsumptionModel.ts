/**
 * Fuel Consumption and Management Model
 * Integrates fuel dynamics with tyre degradation and lap time impact.
 */

import { DrivingMode, SimulationConfig } from '../types.js'

export interface FuelModelContext {
  currentFuel: number
  fuelRemaining: number // For race planning
  drivingMode: DrivingMode
  baseLapTime: number
  baseLapBurn: number
  trackId: string
}

export interface FuelLapResult {
  fuelConsumed: number
  lapTimePenalty: number
  tyreDegradationMultiplier: number
  nextFuel: number
}

export class FuelConsumptionModel {
  constructor(private config: SimulationConfig) {}

  /**
   * Calculate fuel consumption per lap based on driving mode.
   * PUSH: +0% (baseline)
   * BALANCED: 0% (baseline)
   * HARVEST: -16% (ERS harvesting efficiency)
   * SAVE: -16% (explicit fuel saving)
   */
  private calculateConsumptionRate(drivingMode: DrivingMode): number {
    const base = this.config.physics.fuel.baseBurnPerLap
    const modeMultiplier =
      drivingMode === DrivingMode.SAVE
        ? 1 - this.config.physics.fuel.saveModeReduction
        : drivingMode === DrivingMode.HARVEST
          ? 1 - this.config.physics.fuel.saveModeReduction * 0.95
          : 1

    return base * modeMultiplier
  }

  /**
   * Calculate lap time penalty from fuel load.
   * Heavy fuel = lower grip, higher tyre temps, slower acceleration.
   * Linear approximation: +0.00835s per 1kg of fuel load.
   */
  private calculateFuelTimePenalty(fuel: number): number {
    // Baseline ~40kg; penalty scales above/below
    const baseFuel = 40
    const excess = Math.max(0, fuel - baseFuel)
    return (excess / 10) * this.config.physics.fuel.loadFactor
  }

  /**
   * Calculate tyre degradation multiplier due to fuel load stress.
   * Heavier fuel → higher tyre degradation:
   * - Default (40kg): 1.0x
   * - High load (60kg): 1.2x
   * - Critical (80kg): 1.5x
   */
  private calculateTyreDegradationMultiplier(fuel: number): number {
    const baseFuel = 40
    const maxFuel = 120 // Safety margin

    if (fuel <= baseFuel) {
      return 1.0
    }

    const loadRatio = (fuel - baseFuel) / (maxFuel - baseFuel)
    // Accelerating function: wear increases faster at high load
    return 1 + Math.pow(loadRatio, 1.3) * this.config.physics.fuel.tyreDegradationMultiplier
  }

  /**
   * Calculate if fuel strategy is sustainable.
   * Checks: remaining laps × burn rate ≤ current fuel (with 2kg buffer)
   */
  isSustainable(
    currentFuel: number,
    remainingLaps: number,
    drivingMode: DrivingMode,
  ): boolean {
    const burnRate = this.calculateConsumptionRate(drivingMode)
    const projectedConsumption = remainingLaps * burnRate
    const fuelBuffer = 2 // 2kg safety margin

    return currentFuel >= projectedConsumption + fuelBuffer
  }

  /**
   * Predict fuel at end of remaining laps.
   */
  predictFuelAtFinish(
    currentFuel: number,
    remainingLaps: number,
    drivingMode: DrivingMode,
  ): number {
    const burnRate = this.calculateConsumptionRate(drivingMode)
    return Math.max(0, currentFuel - remainingLaps * burnRate)
  }

  /**
   * Simulate single lap fuel impact.
   */
  simulateLap(context: FuelModelContext): FuelLapResult {
    const consumedFuel = this.calculateConsumptionRate(context.drivingMode)
    const timePenalty = this.calculateFuelTimePenalty(context.currentFuel)
    const tyreDegradationMultiplier = this.calculateTyreDegradationMultiplier(
      context.currentFuel,
    )

    return {
      fuelConsumed: consumedFuel,
      lapTimePenalty: timePenalty,
      tyreDegradationMultiplier,
      nextFuel: Math.max(0, context.currentFuel - consumedFuel),
    }
  }

  /**
   * Export fuel config for external planning/optimization.
   */
  getConfig() {
    return {
      baseBurn: this.config.physics.fuel.baseBurnPerLap,
      saveModeReduction: this.config.physics.fuel.saveModeReduction,
      harvestModeReduction: this.config.physics.fuel.saveModeReduction * 0.95,
      loadFactor: this.config.physics.fuel.loadFactor,
      tyreDegradationMultiplier: this.config.physics.fuel.tyreDegradationMultiplier,
    }
  }
}
