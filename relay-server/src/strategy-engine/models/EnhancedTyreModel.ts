/**
 * Enhanced Tyre Degradation Model
 * ================================
 * Replaces linear slope + cliff threshold with compound-specific
 * degradation curves featuring three distinct phases:
 *
 *   1. Thermal Phase — early-lap warmup penalty that decays
 *   2. Stable Phase  — linear degradation (optimal window)
 *   3. Cliff Phase   — exponential performance drop
 *
 * Additional factors:
 *   - Track evolution (rubbering in)
 *   - Fuel load effects on lap time and tyre wear
 *   - Dirty air penalties (within DRS / sub-1.2s gaps)
 *   - Graining and blistering compound-specific thresholds
 *
 * All functions are pure — no side effects, no mutation.
 */

import {
  TyreCompound,
  CompoundDegradationProfile,
  SimulationConfig,
} from '../types.js'

// ════════════════════════════════════════════════════════════════
// COMPOUND DEGRADATION PROFILES
// ════════════════════════════════════════════════════════════════

const DEGRADATION_PROFILES: Record<TyreCompound, CompoundDegradationProfile> = {
  [TyreCompound.SOFT]: {
    compound: TyreCompound.SOFT,
    thermalPhase: {
      durationLaps: 2,
      initialPenaltyMs: 450,  // ~0.45s first lap warmup loss
      decayRate: 0.55,        // rapid warmup
    },
    stablePhase: {
      penaltyPerLapMs: 55,    // ~0.055s per lap in stable window
      wearRatePerLap: 0.044,  // 4.4% per lap
    },
    cliffPhase: {
      wearThreshold: 0.62,    // Cliff starts at 62% wear
      exponent: 2.2,          // Steep cliff
      baseMultiplier: 3500,   // Large penalty multiplier
    },
    trackEvolutionSensitivity: 0.85,
    fuelLoadSensitivity: 0.35,
    dirtyAirWearMultiplier: 1.22,
  },
  [TyreCompound.MEDIUM]: {
    compound: TyreCompound.MEDIUM,
    thermalPhase: {
      durationLaps: 3,
      initialPenaltyMs: 600,
      decayRate: 0.42,
    },
    stablePhase: {
      penaltyPerLapMs: 38,
      wearRatePerLap: 0.032,
    },
    cliffPhase: {
      wearThreshold: 0.72,
      exponent: 1.9,
      baseMultiplier: 3000,
    },
    trackEvolutionSensitivity: 0.70,
    fuelLoadSensitivity: 0.28,
    dirtyAirWearMultiplier: 1.18,
  },
  [TyreCompound.HARD]: {
    compound: TyreCompound.HARD,
    thermalPhase: {
      durationLaps: 5,
      initialPenaltyMs: 850,
      decayRate: 0.30,
    },
    stablePhase: {
      penaltyPerLapMs: 25,
      wearRatePerLap: 0.024,
    },
    cliffPhase: {
      wearThreshold: 0.80,
      exponent: 1.7,
      baseMultiplier: 2500,
    },
    trackEvolutionSensitivity: 0.55,
    fuelLoadSensitivity: 0.22,
    dirtyAirWearMultiplier: 1.14,
  },
}

export function getDegradationProfile(compound: TyreCompound): CompoundDegradationProfile {
  return DEGRADATION_PROFILES[compound] ?? DEGRADATION_PROFILES[TyreCompound.MEDIUM]
}

// ════════════════════════════════════════════════════════════════
// CONTEXT TYPE
// ════════════════════════════════════════════════════════════════

export interface TyreDegradationContext {
  compound: TyreCompound
  currentWear: number       // 0-1
  stintLap: number          // laps since last pit stop
  fuelKg: number            // remaining fuel load
  gapToCarAheadS: number    // seconds; <1.2 = dirty air
  raceLap: number           // for track evolution
  totalRaceLaps: number     // for track evolution
  tyreTemp: number          // °C
}

// ════════════════════════════════════════════════════════════════
// CORE DEGRADATION COMPUTATION
// ════════════════════════════════════════════════════════════════

export interface TyreDegradationResult {
  /** Total lap time penalty from tyre degradation (ms) */
  totalPenaltyMs: number
  /** Breakdown by phase */
  thermalPenaltyMs: number
  stablePenaltyMs: number
  cliffPenaltyMs: number
  /** Additional factors */
  fuelLoadPenaltyMs: number
  dirtyAirPenaltyMs: number
  trackEvolutionBenefitMs: number
  /** Graining/blistering components */
  grainingPenaltyMs: number
  blisteringPenaltyMs: number
  /** Wear advancement for this lap */
  wearDelta: number
  /** New wear after this lap */
  newWear: number
  /** Whether tyre is in cliff zone */
  inCliffZone: boolean
  /** Estimated laps until cliff */
  lapsToCliff: number
}

/**
 * Compute the full degradation result for a single lap.
 */
export function computeTyreDegradation(ctx: TyreDegradationContext): TyreDegradationResult {
  const profile = getDegradationProfile(ctx.compound)

  // ── Phase 1: Thermal penalty (warmup) ──
  let thermalPenalty = 0
  if (ctx.stintLap < profile.thermalPhase.durationLaps) {
    const remaining = profile.thermalPhase.durationLaps - ctx.stintLap
    const fraction = remaining / profile.thermalPhase.durationLaps
    thermalPenalty = profile.thermalPhase.initialPenaltyMs *
      Math.pow(fraction, 1 / (1 + profile.thermalPhase.decayRate))
  }

  // ── Phase 2: Stable degradation ──
  let stablePenalty = 0
  const inCliffZone = ctx.currentWear >= profile.cliffPhase.wearThreshold
  if (!inCliffZone) {
    // Linear degradation proportional to wear
    stablePenalty = ctx.currentWear * profile.stablePhase.penaltyPerLapMs * 10
  }

  // ── Phase 3: Cliff degradation ──
  let cliffPenalty = 0
  if (inCliffZone) {
    const depth = ctx.currentWear - profile.cliffPhase.wearThreshold
    const maxDepth = 1.0 - profile.cliffPhase.wearThreshold
    const normalizedDepth = Math.min(1, depth / maxDepth)
    cliffPenalty = profile.cliffPhase.baseMultiplier *
      Math.pow(normalizedDepth, profile.cliffPhase.exponent)
    // Also include the stable penalty up to the threshold
    stablePenalty = profile.cliffPhase.wearThreshold * profile.stablePhase.penaltyPerLapMs * 10
  }

  // ── Fuel load effect ──
  // Heavier car = more tyre stress, slower lap times
  const fuelFactor = Math.max(0, ctx.fuelKg - 20) / 60  // normalized
  const fuelLoadPenalty = fuelFactor * profile.fuelLoadSensitivity * 800  // up to ~280ms

  // ── Dirty air effect ──
  let dirtyAirPenalty = 0
  if (ctx.gapToCarAheadS > 0 && ctx.gapToCarAheadS < 2.0) {
    // Non-linear: closer gap = exponentially more dirty air
    const dirtiness = Math.pow(1 - ctx.gapToCarAheadS / 2.0, 1.5)
    dirtyAirPenalty = dirtiness * 1500  // up to 1.5s at zero gap
  }

  // ── Track evolution benefit ──
  const raceProgress = ctx.raceLap / Math.max(1, ctx.totalRaceLaps)
  const trackEvoBenefit = profile.trackEvolutionSensitivity *
    Math.min(150, Math.log(1 + raceProgress * 8) / Math.log(9) * 150)

  // ── Graining (low wear + low temp + high fuel = graining) ──
  let grainingPenalty = 0
  if (ctx.currentWear < 0.3 && ctx.stintLap > 2) {
    const wearFactor = (0.3 - ctx.currentWear) / 0.3
    const tempFactor = ctx.tyreTemp < 85 ? (85 - ctx.tyreTemp) / 20 : 0
    const fuelGrainFactor = ctx.fuelKg > 40 ? (ctx.fuelKg - 40) / 60 : 0
    const grainLevel = (wearFactor * 0.35 + tempFactor * 0.4 + fuelGrainFactor * 0.25)
    grainingPenalty = grainLevel * 800  // up to 0.8s
  }

  // ── Blistering (high wear + high temp = blistering) ──
  let blisteringPenalty = 0
  if (ctx.currentWear > 0.5 && ctx.tyreTemp > 100) {
    const wearFactor = (ctx.currentWear - 0.5) * 2
    const tempFactor = (ctx.tyreTemp - 100) / 20
    const blisterLevel = (wearFactor * 0.5 + tempFactor * 0.5)
    blisteringPenalty = blisterLevel * 1200  // up to 1.2s
  }

  // ── Total penalty ──
  const totalPenalty = thermalPenalty + stablePenalty + cliffPenalty +
    fuelLoadPenalty + dirtyAirPenalty - trackEvoBenefit +
    grainingPenalty + blisteringPenalty

  // ── Wear advancement ──
  let wearDelta = profile.stablePhase.wearRatePerLap
  // Fuel load accelerates wear
  wearDelta *= 1 + fuelFactor * profile.fuelLoadSensitivity
  // Dirty air accelerates wear
  if (ctx.gapToCarAheadS > 0 && ctx.gapToCarAheadS < 1.5) {
    wearDelta *= profile.dirtyAirWearMultiplier
  }
  // Cliff zone accelerates wear
  if (inCliffZone) {
    const depth = ctx.currentWear - profile.cliffPhase.wearThreshold
    wearDelta *= 1 + depth * 3.5
  }
  // Cap wear delta
  wearDelta = Math.min(0.12, wearDelta)

  const newWear = Math.min(1, ctx.currentWear + wearDelta)

  // ── Laps to cliff ──
  const lapsToCliff = inCliffZone ? 0 :
    Math.max(0, (profile.cliffPhase.wearThreshold - ctx.currentWear) / Math.max(0.001, wearDelta))

  return {
    totalPenaltyMs: Math.max(0, totalPenalty),
    thermalPenaltyMs: thermalPenalty,
    stablePenaltyMs: stablePenalty,
    cliffPenaltyMs: cliffPenalty,
    fuelLoadPenaltyMs: fuelLoadPenalty,
    dirtyAirPenaltyMs: dirtyAirPenalty,
    trackEvolutionBenefitMs: trackEvoBenefit,
    grainingPenaltyMs: grainingPenalty,
    blisteringPenaltyMs: blisteringPenalty,
    wearDelta,
    newWear,
    inCliffZone,
    lapsToCliff,
  }
}

/**
 * Project tyre state forward N laps (deterministic, for preview).
 */
export function projectTyreDegradation(
  ctx: TyreDegradationContext,
  horizonLaps: number,
  fuelBurnPerLap: number = 1.65,
): TyreDegradationResult[] {
  const results: TyreDegradationResult[] = []
  let wear = ctx.currentWear
  let fuel = ctx.fuelKg
  let stintLap = ctx.stintLap

  for (let i = 0; i < horizonLaps; i++) {
    const lapCtx: TyreDegradationContext = {
      ...ctx,
      currentWear: wear,
      stintLap: stintLap + i,
      fuelKg: fuel,
      raceLap: ctx.raceLap + i,
    }
    const result = computeTyreDegradation(lapCtx)
    results.push(result)
    wear = result.newWear
    fuel = Math.max(0, fuel - fuelBurnPerLap)
  }

  return results
}
