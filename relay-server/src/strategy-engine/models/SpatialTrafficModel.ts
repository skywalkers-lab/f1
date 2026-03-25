/**
 * Spatial-Temporal Traffic Model
 * ==============================
 * Replaces simple gap-based penalty with comprehensive traffic analysis:
 *
 *   - DRS train detection and cascade effects
 *   - Per-sector overtaking difficulty
 *   - Cluster-based rejoin position analysis
 *   - Multi-lap traffic time loss accumulation
 *   - Clean air score (0-100)
 *   - Expected traffic laps estimation
 *
 * All functions are pure and deterministic for a given input.
 */

import {
  SpatialTrafficState,
  DriverState,
  RaceContext,
  SimulationConfig,
} from '../types.js'

// ── Track-specific overtaking difficulty by sector ──
// 3 sectors per track, 0-1 scale (higher = harder to overtake)
const SECTOR_OVERTAKE_DIFFICULTY: Record<string, [number, number, number]> = {
  TRACK_0:  [0.35, 0.55, 0.45],  // Bahrain
  TRACK_1:  [0.40, 0.60, 0.50],  // Saudi Arabia
  TRACK_2:  [0.55, 0.70, 0.50],  // Australia
  TRACK_5:  [0.90, 0.95, 0.88],  // Monaco
  TRACK_10: [0.75, 0.85, 0.80],  // Hungary
  TRACK_13: [0.20, 0.30, 0.25],  // Monza
  TRACK_14: [0.70, 0.80, 0.75],  // Singapore
  TRACK_16: [0.45, 0.55, 0.40],  // Abu Dhabi
}

const DEFAULT_SECTOR_DIFFICULTY: [number, number, number] = [0.50, 0.55, 0.50]

// ── DRS effectiveness per track (number of zones → total DRS benefit in seconds) ──
const DRS_BENEFIT_PER_ZONE = 0.28  // ~0.28s per DRS zone activation

export interface TrafficAnalysisContext {
  player: DriverState
  rivals: DriverState[]
  track: RaceContext
}

/**
 * Analyze the full spatial-temporal traffic picture.
 */
export function analyzeTraffic(ctx: TrafficAnalysisContext): SpatialTrafficState {
  const { player, rivals, track } = ctx

  // Sort rivals by gap to leader for positional analysis
  const sortedRivals = [...rivals].sort((a, b) => a.gapToLeader - b.gapToLeader)

  // ── DRS train detection ──
  const drsTrain = detectDrsTrain(player, sortedRivals)

  // ── Sector overtaking difficulty ──
  const sectorDifficulty = SECTOR_OVERTAKE_DIFFICULTY[track.trackId] ?? DEFAULT_SECTOR_DIFFICULTY

  // ── Cluster analysis ──
  const clusterPos = computeClusterPosition(player, sortedRivals)

  // ── Cumulative traffic loss ──
  const cumulativeLoss = estimateCumulativeTrafficLoss(player, sortedRivals, sectorDifficulty)

  // ── Clean air score ──
  const cleanAir = computeCleanAirScore(player, sortedRivals)

  // ── Expected traffic laps ──
  const expectedTrafficLaps = estimateTrafficLaps(player, sortedRivals, sectorDifficulty)

  return {
    drsTrainLength: drsTrain.length,
    inDrsTrain: drsTrain.inTrain,
    sectorOvertakeDifficulty: [...sectorDifficulty],
    clusterPosition: clusterPos,
    cumulativeTrafficLoss: cumulativeLoss,
    cleanAirScore: cleanAir,
    expectedTrafficLaps,
  }
}

// ════════════════════════════════════════════════════════════════
// DRS TRAIN DETECTION
// ════════════════════════════════════════════════════════════════

interface DrsTrainResult {
  length: number
  inTrain: boolean
  trainFrontDriver: number | null
  trainRearDriver: number | null
}

function detectDrsTrain(player: DriverState, sortedRivals: DriverState[]): DrsTrainResult {
  // Build a list of all cars sorted by position
  type CarEntry = { id: number; position: number; gapToLeader: number; isPlayer: boolean }
  const allCars: CarEntry[] = [
    { id: player.driverId, position: player.position, gapToLeader: player.gapToLeader, isPlayer: true },
    ...sortedRivals.map(r => ({
      id: r.driverId,
      position: r.position,
      gapToLeader: r.gapToLeader,
      isPlayer: false,
    })),
  ]
  allCars.sort((a, b) => a.position - b.position)

  // Find consecutive chains where gap between adjacent cars is < 1.2s
  const DRS_THRESHOLD = 1.2
  let currentChain: CarEntry[] = []
  let bestChain: CarEntry[] = []
  let playerChain: CarEntry[] = []

  for (let i = 0; i < allCars.length; i++) {
    if (i === 0 || (allCars[i].gapToLeader - allCars[i - 1].gapToLeader) < DRS_THRESHOLD) {
      currentChain.push(allCars[i])
    } else {
      if (currentChain.length > bestChain.length) bestChain = currentChain
      if (currentChain.some(c => c.isPlayer)) playerChain = currentChain
      currentChain = [allCars[i]]
    }
  }
  // Final chain
  if (currentChain.length > bestChain.length) bestChain = currentChain
  if (currentChain.some(c => c.isPlayer)) playerChain = currentChain

  const inTrain = playerChain.length >= 3
  return {
    length: playerChain.length,
    inTrain,
    trainFrontDriver: playerChain.length > 0 ? playerChain[0].id : null,
    trainRearDriver: playerChain.length > 0 ? playerChain[playerChain.length - 1].id : null,
  }
}

// ════════════════════════════════════════════════════════════════
// CLUSTER ANALYSIS
// ════════════════════════════════════════════════════════════════

/**
 * Compute player's position within their traffic cluster.
 * Returns a value 0-1: 0 = front of cluster, 1 = back of cluster.
 */
function computeClusterPosition(player: DriverState, sortedRivals: DriverState[]): number {
  const CLUSTER_GAP = 3.0 // Cars within 3s are in a cluster

  // Find all cars in the player's cluster
  const clusterMembers: { position: number; gapToLeader: number }[] = [
    { position: player.position, gapToLeader: player.gapToLeader },
  ]

  for (const rival of sortedRivals) {
    if (Math.abs(rival.gapToLeader - player.gapToLeader) < CLUSTER_GAP) {
      clusterMembers.push({ position: rival.position, gapToLeader: rival.gapToLeader })
    }
  }

  if (clusterMembers.length <= 1) return 0 // Alone = front of "cluster"

  clusterMembers.sort((a, b) => a.position - b.position)
  const playerIndex = clusterMembers.findIndex(c => c.position === player.position)
  return playerIndex / (clusterMembers.length - 1)
}

// ════════════════════════════════════════════════════════════════
// CUMULATIVE TRAFFIC LOSS
// ════════════════════════════════════════════════════════════════

/**
 * Estimate cumulative traffic time loss for the current state.
 * Considers dirty air, inability to use optimal racing line,
 * and DRS train effects.
 */
function estimateCumulativeTrafficLoss(
  player: DriverState,
  sortedRivals: DriverState[],
  sectorDifficulty: [number, number, number],
): number {
  const gapAhead = player.gapToAhead
  if (gapAhead > 2.0) return 0 // Clean air

  // Base dirty air penalty (non-linear)
  const dirtyAirFactor = Math.pow(1 - Math.min(1, gapAhead / 2.0), 1.5)
  const basePenaltyMs = dirtyAirFactor * 1500

  // Sector-weighted difficulty (harder to follow in high-speed sectors)
  const avgSectorDiff = (sectorDifficulty[0] + sectorDifficulty[1] + sectorDifficulty[2]) / 3
  const sectorMultiplier = 0.7 + avgSectorDiff * 0.6

  // DRS train penalty: being 3rd+ in a DRS train means less DRS benefit
  let drsTrainPenalty = 0
  const carsAheadWithin1s = sortedRivals.filter(
    r => r.position < player.position && (player.gapToLeader - r.gapToLeader) < 1.2
  ).length
  if (carsAheadWithin1s >= 2) {
    drsTrainPenalty = (carsAheadWithin1s - 1) * 300 // 0.3s per extra car in DRS train
  }

  return (basePenaltyMs * sectorMultiplier + drsTrainPenalty)
}

// ════════════════════════════════════════════════════════════════
// CLEAN AIR SCORE
// ════════════════════════════════════════════════════════════════

/**
 * Compute a 0-100 clean air score.
 * 100 = completely clean air, no nearby cars
 * 0 = heavily traffic-affected
 */
function computeCleanAirScore(player: DriverState, sortedRivals: DriverState[]): number {
  let score = 100

  const gapAhead = player.gapToAhead
  const gapBehind = player.gapToBehind

  // Gap ahead penalty (most important)
  if (gapAhead < 3.0) {
    const penalty = (3.0 - gapAhead) / 3.0 * 50 // Up to -50 for zero gap
    score -= penalty
  }

  // Gap behind pressure (defending costs time)
  if (gapBehind < 1.5) {
    const penalty = (1.5 - gapBehind) / 1.5 * 20 // Up to -20
    score -= penalty
  }

  // Cars within 2s both sides = sandwich penalty
  const carsWithin2sAhead = sortedRivals.filter(
    r => r.position < player.position && (player.gapToLeader - r.gapToLeader) < 2.0
  ).length
  const carsWithin2sBehind = sortedRivals.filter(
    r => r.position > player.position && (r.gapToLeader - player.gapToLeader) < 2.0
  ).length
  const sandwichPenalty = Math.min(30, (carsWithin2sAhead + carsWithin2sBehind) * 5)
  score -= sandwichPenalty

  return Math.max(0, Math.min(100, score))
}

// ════════════════════════════════════════════════════════════════
// EXPECTED TRAFFIC LAPS
// ════════════════════════════════════════════════════════════════

/**
 * Estimate how many laps the player will spend stuck in traffic
 * at the current pace differential.
 */
function estimateTrafficLaps(
  player: DriverState,
  sortedRivals: DriverState[],
  sectorDifficulty: [number, number, number],
): number {
  const carAhead = sortedRivals.find(r => r.position === player.position - 1)
  if (!carAhead) return 0

  const gapAhead = player.gapToAhead
  if (gapAhead > 2.0) return 0

  // Pace delta (positive = we're faster)
  const paceDelta = carAhead.lastLapTime - player.lastLapTime
  if (paceDelta <= 0) return 15 // Can't overtake if slower

  // Average overtake difficulty
  const avgDifficulty = (sectorDifficulty[0] + sectorDifficulty[1] + sectorDifficulty[2]) / 3

  // Estimated laps to overtake = gap / (pace_delta * (1 - difficulty))
  const effectivePaceDelta = paceDelta * (1 - avgDifficulty * 0.5)
  if (effectivePaceDelta <= 0.001) return 15

  return Math.min(15, Math.round(gapAhead / effectivePaceDelta))
}

// ════════════════════════════════════════════════════════════════
// SCENARIO TRAFFIC PROJECTION
// ════════════════════════════════════════════════════════════════

export interface TrafficProjectionResult {
  /** Total traffic time loss over horizon (ms) */
  totalTrafficLossMs: number
  /** Clean air score after pit stop (if applicable) */
  postPitCleanAirScore: number
  /** Laps in traffic */
  lapsInTraffic: number
  /** Whether rejoin position hits a cluster */
  rejoinsIntoCluster: boolean
}

/**
 * Project traffic losses for a pit strategy over a horizon.
 */
export function projectTrafficForScenario(
  player: DriverState,
  rivals: DriverState[],
  pitLap: number | null,
  rejoinPosition: number,
  horizonLaps: number,
  trackId: string,
): TrafficProjectionResult {
  const sectorDiff = SECTOR_OVERTAKE_DIFFICULTY[trackId] ?? DEFAULT_SECTOR_DIFFICULTY

  let totalLoss = 0
  let lapsInTraffic = 0
  let postPitCleanAir = 100

  // Pre-pit laps: use current traffic state
  const prePitLaps = pitLap !== null ? pitLap : horizonLaps
  const currentTrafficPerLap = estimateCumulativeTrafficLoss(player, rivals, sectorDiff)

  for (let i = 0; i < Math.min(prePitLaps, horizonLaps); i++) {
    // Traffic loss diminishes as we assume some overtakes happen
    const decayFactor = Math.max(0.3, 1 - i * 0.1)
    const lapLoss = currentTrafficPerLap * decayFactor
    totalLoss += lapLoss
    if (lapLoss > 200) lapsInTraffic++
  }

  // Post-pit laps: new traffic based on rejoin position
  if (pitLap !== null && pitLap < horizonLaps) {
    const postPitLaps = horizonLaps - pitLap - 1 // -1 for pit in-lap
    const sortedRivals = [...rivals].sort((a, b) => a.position - b.position)

    // Find cars near rejoin position
    const nearbyRivals = sortedRivals.filter(
      r => Math.abs(r.position - rejoinPosition) <= 2
    )
    const rejoinsIntoCluster = nearbyRivals.length >= 2 &&
      nearbyRivals.some(r => Math.abs(r.gapToLeader - (nearbyRivals[0]?.gapToLeader ?? 0)) < 2.0)

    // Estimate gap to car ahead after rejoin
    const carAhead = sortedRivals.find(r => r.position === rejoinPosition - 1)
    const rejoinGap = carAhead ? 0.8 + Math.random() * 1.5 : 5.0

    // Create a synthetic driver state at rejoin
    const rejoinPlayer: DriverState = {
      ...player,
      position: rejoinPosition,
      gapToAhead: rejoinGap,
      gapToBehind: 0.5,
    }

    const postPitTraffic = estimateCumulativeTrafficLoss(rejoinPlayer, sortedRivals, sectorDiff)
    postPitCleanAir = computeCleanAirScore(rejoinPlayer, sortedRivals)

    for (let i = 0; i < postPitLaps; i++) {
      const decayFactor = Math.max(0.3, 1 - i * 0.08)
      const lapLoss = postPitTraffic * decayFactor
      totalLoss += lapLoss
      if (lapLoss > 200) lapsInTraffic++
    }

    return {
      totalTrafficLossMs: totalLoss,
      postPitCleanAirScore: postPitCleanAir,
      lapsInTraffic,
      rejoinsIntoCluster: rejoinsIntoCluster,
    }
  }

  return {
    totalTrafficLossMs: totalLoss,
    postPitCleanAirScore: postPitCleanAir,
    lapsInTraffic,
    rejoinsIntoCluster: false,
  }
}
