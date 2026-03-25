/**
 * Advanced Tyre Physics Model
 * Implements realistic F1 tyre degradation with non-linear curves, temperature effects,
 * and compound-specific behavior.
 */

import {
  TyreCompound,
  LapState,
  TyrePhysicsSnapshot,
  SimulationConfig,
  CompoundPhysics,
} from '../types.js'
import { getCompoundPhysics } from '../config/SimulationConfig.js'

export interface TyreModelContext {
  compound: TyreCompound
  wear: number
  temp: number
  fuelLoad: number
  drivingMode: string
  trackId: string
  isWarmupLap: boolean
}

export interface TyreLapResult {
  lapTime: number
  wearDelta: number
  tempChange: number
  grainingLevel: number
  blisteringLevel: number
  lapTimePenalty: number
}

/**
 * High-fidelity tyre physics engine.
 */
export class TyrePhysicsModel {
  constructor(private config: SimulationConfig) {}

  /**
   * Calculate lap time penalty from tyre wear using piecewise degradation curve.
   * Reflects real F1 behavior: gradual wear early, exponential degradation late.
   */
  private calculateDegradationPenalty(wear: number, compoundPhysics: CompoundPhysics): number {
    if (wear < 0.01) return 0

    const curve = compoundPhysics.degradationCurve
    let penalty = 0

    if (wear <= curve.phase1.wearThreshold) {
      // Phase 1: Fresh tyres, minimal degradation
      penalty = curve.phase1.factor * wear
    } else if (wear <= curve.phase2.wearThreshold) {
      // Phase 2: Peak performance zone starting to erode
      const phase1Penalty = curve.phase1.factor * curve.phase1.wearThreshold
      const phase2Wear = wear - curve.phase1.wearThreshold
      const phase2Fraction =
        phase2Wear / (curve.phase2.wearThreshold - curve.phase1.wearThreshold)
      penalty = phase1Penalty + curve.phase2.factor * phase2Wear
    } else {
      // Phase 3: Critical degradation - exponential fall-off
      const phase1Penalty = curve.phase1.factor * curve.phase1.wearThreshold
      const phase2Penalty =
        curve.phase2.factor * (curve.phase2.wearThreshold - curve.phase1.wearThreshold)
      const phase3Wear = wear - curve.phase2.wearThreshold
      // Exponential: factor^(wear^2) for catastrophic late-race degradation
      penalty = phase1Penalty + phase2Penalty + curve.phase3.factor * Math.pow(phase3Wear, 1.8)
    }

    return Math.min(penalty * 8.5, 15) // Cap at ~15s penalty to avoid negative infinity
  }

  /**
   * Calculate tyre temperature effects.
   * Overheating reduces grip; underheating in early laps penalizes performance.
   */
  private calculateTempPenalty(temp: number, wear: number): number {
    const optimalTemp = 92
    const deadband = 8 // ±8°C acceptable range

    if (Math.abs(temp - optimalTemp) <= deadband) {
      return 0
    }

    if (temp < optimalTemp - deadband) {
      // Underheated: exponential penalty
      const deficit = optimalTemp - deadband - temp
      return Math.pow(deficit / 20, 1.5) * 0.8
    } else {
      // Overheated: scales with wear
      const excess = temp - (optimalTemp + deadband)
      const overheatFactor = 1 + wear * 0.5 // Worn tyres overheat more
      return Math.pow(excess / 25, 1.3) * 0.6 * overheatFactor
    }
  }

  /**
   * Calculate graining probability and lap time penalty.
   * Tyres grain under high lateral loads + high speed + certain fuel loads.
   */
  private calculateGraining(
    wear: number,
    temp: number,
    fuelLoad: number,
    compound: CompoundPhysics,
  ): { level: number; lapTimePenalty: number } {
    // Graining primarily triggered by: wear > 0.5, temp < 85, high fuel load
    const wearFactor = wear > 0.5 ? (wear - 0.5) * 2 : 0
    const tempFactor = temp < 85 ? (85 - temp) / 20 : 0
    const fuelFactor = fuelLoad > 35 ? (fuelLoad - 35) / 60 : 0

    const grainingTendency =
      (wearFactor * 0.4 + tempFactor * 0.35 + fuelFactor * 0.25) *
      compound.grainingSusceptibility

    const grainLevel = Math.min(grainingTendency, 1)
    const penalty = grainLevel * 1.2 // Up to 1.2s if tyres fully grain

    return { level: grainLevel, lapTimePenalty: penalty }
  }

  /**
   * Calculate blistering probability and lap time impact.
   * Tyres blister under sustained high temperatures + load + high speeds.
   */
  private calculateBlistering(
    wear: number,
    temp: number,
    fuelLoad: number,
    compound: CompoundPhysics,
  ): { level: number; lapTimePenalty: number } {
    // Blistering: wear > 0.6, temp > 105, stress from high fuel
    const wearFactor = wear > 0.6 ? (wear - 0.6) * 2.5 : 0
    const tempFactor = temp > 105 ? (temp - 105) / 20 : 0
    const fuelFactor = fuelLoad > 40 ? (fuelLoad - 40) / 50 : 0

    const blisteringTendency =
      (wearFactor * 0.45 + tempFactor * 0.4 + fuelFactor * 0.15) *
      compound.blisteringSusceptibility

    const blisterLevel = Math.min(blisteringTendency, 1)
    const penalty = blisterLevel * 2.0 // Up to 2s if tyres fully blister

    return { level: blisterLevel, lapTimePenalty: penalty }
  }

  /**
   * Calculate wear delta for next lap.
   * Wear increases based on compound, lap conditions, fuel load, and vehicle state.
   */
  private calculateWearDelta(
    currentWear: number,
    temp: number,
    fuelLoad: number,
    compound: CompoundPhysics,
  ): number {
    // Base wear from compound
    let wearDelta = compound.wearRate

    // Scaling by current wear (more loaded at higher wear states)
    const wearScaling = 1 + Math.pow(currentWear, 2) * 1.8
    wearDelta *= wearScaling

    // Temperature effects: overheating increases wear
    if (temp > 95) {
      const tempExcess = (temp - 95) / 20
      wearDelta *= 1 + tempExcess * 0.8
    }

    // Fuel load increases tyre stress
    const fuelLoadFactor = 1 + (fuelLoad / 60) * 0.25
    wearDelta *= fuelLoadFactor

    return Math.min(wearDelta, 0.15) // Cap wear delta per lap
  }

  /**
   * Calculate temperature change per lap.
   * Tyres heat up due to friction; cool down based on track conditions.
   */
  private calculateTempChange(
    currentTemp: number,
    wear: number,
    drivingMode: string,
  ): number {
    const baseHeatGeneration = 1.5
    const drivingModeHeat = drivingMode === 'PUSH' ? 2.0 : drivingMode === 'SAVE' ? 0.5 : 1.0

    const heatGenerated = baseHeatGeneration * drivingModeHeat * (1 + wear * 0.3)
    const coolingRate = 0.85 // Per lap natural cooling

    return heatGenerated - coolingRate
  }

  /**
   * Simulate a single lap of tyre performance.
   * Returns comprehensive tyre state changes and lap time component.
   */
  simulateLap(context: TyreModelContext): TyreLapResult {
    const compound = getCompoundPhysics(this.config, context.compound)

    // Warmup lap penalty (tyres gradually reach operating temp)
    const warmupPenalty = context.isWarmupLap
      ? 0.45 * (1 - Math.min(context.temp / 92, 1))
      : 0

    // Degradation penalty
    const degradationPenalty = this.calculateDegradationPenalty(context.wear, compound)

    // Temperature penalty
    const tempPenalty = this.calculateTempPenalty(context.temp, context.wear)

    // Graining
    const { level: grainingLevel, lapTimePenalty: grainingPenalty } = this.calculateGraining(
      context.wear,
      context.temp,
      context.fuelLoad,
      compound,
    )

    // Blistering
    const { level: blisteringLevel, lapTimePenalty: blisteringPenalty } = this.calculateBlistering(
      context.wear,
      context.temp,
      context.fuelLoad,
      compound,
    )

    const totalTyrePenalty = degradationPenalty + tempPenalty + grainingPenalty + blisteringPenalty

    // Wear delta for next lap
    const wearDelta = this.calculateWearDelta(
      context.wear,
      context.temp,
      context.fuelLoad,
      compound,
    )

    // Temp change
    const tempChange = this.calculateTempChange(context.temp, context.wear, context.drivingMode)

    return {
      lapTime: warmupPenalty + totalTyrePenalty,
      wearDelta,
      tempChange,
      grainingLevel,
      blisteringLevel,
      lapTimePenalty: totalTyrePenalty,
    }
  }

  /**
   * Get current tyre physics snapshot.
   */
  getSnapshot(
    compound: TyreCompound,
    wear: number,
    temp: number,
  ): TyrePhysicsSnapshot {
    return { compound, wear, temp, graining: 0, blistering: 0 }
  }
}
