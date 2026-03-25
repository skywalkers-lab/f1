/**
 * Rival Strategy Tree Model
 * =========================
 * Instead of assuming static rival behavior, models each rival
 * with 2-3 probable strategy paths:
 *
 *   1. Aggressive Undercut — pit early, try to jump ahead
 *   2. Defensive Cover — pit shortly after rival to maintain position
 *   3. Long Stint Extension — stretch stint for track position or SC gamble
 *
 * Each rival has weighted probabilities based on:
 *   - Current tyre state (wear, compound, cliff proximity)
 *   - Race position and competitive pressure
 *   - Historical stint patterns
 *   - Gap dynamics
 *
 * Projections consider these branching outcomes rather than
 * a single deterministic rival trajectory.
 */

import {
  RivalStrategyTree,
  RivalStrategyPath,
  DriverState,
  TyreCompound,
  RaceContext,
} from '../types.js'
import { getDegradationProfile } from './EnhancedTyreModel.js'

// ── Strategy archetypes ──
const STRATEGY_ARCHETYPES = {
  AGGRESSIVE_UNDERCUT: 'aggressive_undercut',
  DEFENSIVE_COVER: 'defensive_cover',
  LONG_STINT: 'long_stint_extension',
} as const

/**
 * Build strategy trees for all rivals.
 */
export function buildRivalStrategyTrees(
  context: RaceContext,
  playerPredictedPitLap: number | null,
): RivalStrategyTree[] {
  const totalLaps = context.currentLap + context.lapsRemaining
  const trees: RivalStrategyTree[] = []

  for (const driver of context.drivers) {
    if (driver.driverId === context.drivers[context.playerIndex]?.driverId) continue

    const tree = buildSingleRivalTree(
      driver,
      context.currentLap,
      context.lapsRemaining,
      playerPredictedPitLap,
      totalLaps,
    )
    trees.push(tree)
  }

  return trees
}

/**
 * Build strategy tree for a single rival.
 */
function buildSingleRivalTree(
  driver: DriverState,
  currentLap: number,
  lapsRemaining: number,
  playerExpectedPitLap: number | null,
  totalLaps: number,
): RivalStrategyTree {
  const compound = driver.currentCompound
  const profile = getDegradationProfile(compound)
  const wearRate = Math.max(0.005, profile.stablePhase.wearRatePerLap)
  const lapsToCliff = Math.max(0,
    (profile.cliffPhase.wearThreshold - driver.tyreWear) / wearRate
  )

  const paths: RivalStrategyPath[] = []

  // ── Path 1: Aggressive Undercut ──
  const undercutWeight = computeUndercutWeight(driver, lapsToCliff, lapsRemaining)
  const undercutLap = computeUndercutLap(currentLap, lapsToCliff, lapsRemaining)
  const nextCompound = selectNextCompound(compound, lapsRemaining)

  paths.push({
    id: STRATEGY_ARCHETYPES.AGGRESSIVE_UNDERCUT,
    label: `Aggressive Undercut (Lap ${undercutLap})`,
    probability: 0,  // normalized later
    pitLap: undercutLap,
    targetCompound: nextCompound,
  })

  // ── Path 2: Defensive Cover ──
  const coverWeight = computeCoverWeight(driver, playerExpectedPitLap, currentLap)
  const coverLap = computeCoverLap(
    currentLap,
    playerExpectedPitLap,
    undercutLap,
    lapsRemaining,
  )

  paths.push({
    id: STRATEGY_ARCHETYPES.DEFENSIVE_COVER,
    label: `Defensive Cover (Lap ${coverLap})`,
    probability: 0,
    pitLap: coverLap,
    targetCompound: nextCompound,
  })

  // ── Path 3: Long Stint Extension ──
  const longWeight = computeLongStintWeight(driver, lapsToCliff, lapsRemaining, compound)
  const longLap = computeLongStintLap(currentLap, lapsToCliff, lapsRemaining)

  paths.push({
    id: STRATEGY_ARCHETYPES.LONG_STINT,
    label: longLap !== null ? `Long Stint (Lap ${longLap})` : 'Run to End',
    probability: 0,
    pitLap: longLap,
    targetCompound: longLap !== null ? nextCompound : compound,
  })

  // ── Normalize weights to probabilities ──
  const weights = [undercutWeight, coverWeight, longWeight]
  const totalWeight = weights.reduce((s, w) => s + w, 0)
  if (totalWeight > 0) {
    paths[0].probability = weights[0] / totalWeight
    paths[1].probability = weights[1] / totalWeight
    paths[2].probability = weights[2] / totalWeight
  } else {
    paths.forEach(p => p.probability = 1 / 3)
  }

  // Sort by probability descending
  paths.sort((a, b) => b.probability - a.probability)

  // Expected pit window
  const pitLaps = paths
    .filter(p => p.pitLap !== null)
    .map(p => p.pitLap as number)
  const expectedPitWindow: [number, number] = pitLaps.length > 0
    ? [Math.min(...pitLaps), Math.max(...pitLaps)]
    : [currentLap + lapsRemaining, currentLap + lapsRemaining]

  return {
    driverId: driver.driverId,
    driverCode: `D${driver.driverId}`,
    position: driver.position,
    paths,
    primaryPath: paths[0],
    expectedPitWindow,
  }
}

// ════════════════════════════════════════════════════════════════
// WEIGHT COMPUTATION
// ════════════════════════════════════════════════════════════════

function computeUndercutWeight(
  driver: DriverState,
  lapsToCliff: number,
  lapsRemaining: number,
): number {
  let weight = 1.0

  // High wear or near cliff → strong undercut likelihood
  if (driver.tyreWear > 0.65 && lapsToCliff < 3) weight = 4.5
  else if (driver.tyreWear > 0.55) weight = 3.0
  else if (driver.tyreLaps > 15) weight = 2.5
  else weight = 1.5

  // Early race: less likely to pit unless truly necessary
  const raceProgress = 1 - (lapsRemaining / Math.max(1, lapsRemaining + 20))
  if (raceProgress < 0.15) weight *= 0.5

  // Very late race: no point pitting
  if (lapsRemaining < 5) weight *= 0.2

  // Competitive pressure from behind
  if (driver.gapToBehind < 1.5) weight *= 1.3

  return Math.max(0.1, weight)
}

function computeCoverWeight(
  driver: DriverState,
  playerExpectedPitLap: number | null,
  currentLap: number,
): number {
  let weight = 1.0

  // If we know when player might pit, cover weight increases
  if (playerExpectedPitLap !== null) {
    const lapsUntilPlayerPits = playerExpectedPitLap - currentLap
    if (lapsUntilPlayerPits >= 0 && lapsUntilPlayerPits < 5) weight = 3.5
    else if (lapsUntilPlayerPits >= 5 && lapsUntilPlayerPits < 10) weight = 2.0
    else weight = 1.0
  }

  // Defensive drivers in top 5 more likely to cover
  if (driver.position <= 5) weight *= 1.3

  // Behind the player: less motivation to defensively cover
  if (driver.gapToAhead > 3.0) weight *= 0.6

  return Math.max(0.1, weight)
}

function computeLongStintWeight(
  driver: DriverState,
  lapsToCliff: number,
  lapsRemaining: number,
  compound: TyreCompound,
): number {
  let weight = 1.0

  // Hard tyres with low wear: very likely to extend
  if (compound === TyreCompound.HARD && driver.tyreWear < 0.5) weight = 4.5
  else if (driver.tyreWear < 0.4) weight = 3.5
  else if (lapsToCliff > 8) weight = 3.0
  else weight = 1.5

  // Can run to end without cliff: high probability of staying out
  if (lapsToCliff >= lapsRemaining) weight = 5.0

  // Few laps remaining: almost certainly stay out
  if (lapsRemaining < 5) weight = 6.0

  // Position to gain from SC gamble
  if (driver.position > 10) weight *= 1.2

  return Math.max(0.1, weight)
}

// ════════════════════════════════════════════════════════════════
// LAP COMPUTATION
// ════════════════════════════════════════════════════════════════

function computeUndercutLap(
  currentLap: number,
  lapsToCliff: number,
  lapsRemaining: number,
): number {
  // Undercut: pit before cliff, typically 50% of way to cliff
  const pitIn = Math.max(1, Math.round(lapsToCliff * 0.5))
  return Math.min(currentLap + pitIn, currentLap + lapsRemaining - 2)
}

function computeCoverLap(
  currentLap: number,
  playerExpectedPitLap: number | null,
  undercutLap: number,
  lapsRemaining: number,
): number {
  // Cover: pit 1-2 laps after the expected trigger (player's pit or undercut)
  const reference = playerExpectedPitLap ?? undercutLap
  const coverLap = reference + 1 + Math.round(Math.random()) // 1-2 laps after
  return Math.min(coverLap, currentLap + lapsRemaining - 2)
}

function computeLongStintLap(
  currentLap: number,
  lapsToCliff: number,
  lapsRemaining: number,
): number | null {
  // Long stint: either run to near-cliff or to the end
  if (lapsToCliff >= lapsRemaining) return null // Run to end

  const pitLap = currentLap + Math.round(lapsToCliff * 0.85)
  return Math.min(pitLap, currentLap + lapsRemaining - 2)
}

function selectNextCompound(current: TyreCompound, lapsRemaining: number): TyreCompound {
  // Standard strategy: step up in hardness
  if (current === TyreCompound.SOFT) return TyreCompound.MEDIUM
  if (current === TyreCompound.MEDIUM) {
    return lapsRemaining > 15 ? TyreCompound.HARD : TyreCompound.MEDIUM
  }
  return TyreCompound.MEDIUM // Hard → Medium
}

// ════════════════════════════════════════════════════════════════
// UTILITY: Probability-weighted lap time projection for a rival
// ════════════════════════════════════════════════════════════════

export interface RivalProjection {
  driverId: number
  /** Expected lap time based on weighted paths */
  weightedExpectedLapTime: number
  /** Expected pit lap (weighted) */
  weightedPitLap: number | null
  /** Probability of pitting within N laps */
  pitProbabilityWithin: (laps: number) => number
}

/**
 * Create a projection for a rival based on their strategy tree.
 */
export function projectRival(
  tree: RivalStrategyTree,
  baseLapTime: number,
  currentLap: number,
): RivalProjection {
  // Weighted expected pit lap
  const pitLaps = tree.paths
    .filter(p => p.pitLap !== null)
    .map(p => ({ lap: p.pitLap as number, prob: p.probability }))

  const weightedPitLap = pitLaps.length > 0
    ? pitLaps.reduce((s, p) => s + p.lap * p.prob, 0) / pitLaps.reduce((s, p) => s + p.prob, 0)
    : null

  return {
    driverId: tree.driverId,
    weightedExpectedLapTime: baseLapTime, // Enhanced by caller
    weightedPitLap: weightedPitLap !== null ? Math.round(weightedPitLap) : null,
    pitProbabilityWithin: (laps: number) => {
      return tree.paths
        .filter(p => p.pitLap !== null && (p.pitLap as number) <= currentLap + laps)
        .reduce((s, p) => s + p.probability, 0)
    },
  }
}
