/**
 * Unified Monte Carlo Simulation Core
 * ====================================
 * Single integrated probabilistic strategy evaluation engine.
 *
 * Design principles:
 *   1. ALL strategy evaluation flows through this core — no separate systems
 *   2. Every simulation run creates an independent probabilistic world
 *   3. Rivals are modeled as stochastic agents, not fixed pace
 *   4. SC/VSC events are Poisson-hazard sampled inside each run
 *   5. Overtaking is probabilistic based on track/DRS/speed delta
 *   6. Results are distributions, not point estimates
 *   7. Risk-aware decision metric balances downside/upside
 *
 * Architecture:
 *   PRNG → per-run seed
 *   ├─ TyreSubModel      → wear, cliff, penalty per lap
 *   ├─ FuelSubModel       → burn, weight penalty
 *   ├─ TrafficSubModel    → dirty air, DRS opportunity
 *   ├─ OvertakeSubModel   → probabilistic position changes
 *   ├─ SafetyCarSubModel  → Poisson-hazard SC/VSC with clustering
 *   ├─ RivalSubModel      → per-rival strategy path sampling + lap sim
 *   └─ PitStopSubModel    → execution variance, warmup, compound switch
 *
 *   RunSimulation(scenario, seed) → RunResult
 *   EvaluateScenario(scenario, N runs) → ScenarioDistribution
 *   EvaluateAll(scenarios[]) → RankedDecision with risk metrics
 */

import type { AppState } from './types'
import type { TyreHistory, TyreWearPoint } from './tyreHistoryManager'
import {
  resolveCompound,
  getCompoundPhysics,
  estimateWearSlopeFromHistory,
  type CompoundPhysics,
} from './tyreDegradationModel'

// ════════════════════════════════════════════════════════════════════
// PRNG — Xorshift128 with gaussian & Poisson sampling
// ════════════════════════════════════════════════════════════════════

class PRNG {
  private s: Uint32Array

  constructor(seed: number) {
    this.s = new Uint32Array(4)
    this.s[0] = seed >>> 0
    this.s[1] = (seed * 2654435761) >>> 0
    this.s[2] = (seed * 2246822519) >>> 0
    this.s[3] = (seed * 3266489917) >>> 0
    for (let i = 0; i < 20; i++) this.next()
  }

  next(): number {
    const s = this.s
    let t = s[3]
    t ^= t << 11; t ^= t >>> 8
    s[3] = s[2]; s[2] = s[1]; s[1] = s[0]
    t ^= s[0]; t ^= s[0] >>> 19; s[0] = t
    return (t >>> 0) / 4294967296
  }

  gaussian(mean = 0, stddev = 1): number {
    const u1 = Math.max(1e-10, this.next())
    const u2 = this.next()
    return mean + Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2) * stddev
  }

  bernoulli(p: number): boolean { return this.next() < p }

  /** Poisson sample via inverse CDF */
  poisson(lambda: number): number {
    if (lambda <= 0) return 0
    const L = Math.exp(-lambda)
    let k = 0, p = 1
    do { k++; p *= this.next() } while (p > L)
    return k - 1
  }

  /** Pick index from weighted probability array */
  weightedChoice(weights: number[]): number {
    const total = weights.reduce((a, b) => a + b, 0)
    if (total <= 0) return 0
    let r = this.next() * total
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i]
      if (r <= 0) return i
    }
    return weights.length - 1
  }

  /** Uniform in [lo, hi) */
  uniform(lo: number, hi: number): number {
    return lo + this.next() * (hi - lo)
  }
}

// ════════════════════════════════════════════════════════════════════
// TYPES — Input, Output, Configuration
// ════════════════════════════════════════════════════════════════════

// ── Track characteristics ──
export type TrackProfile = {
  trackId: string
  baseSCRatePerLap: number
  overtakeDifficulty: number // 0-1, higher = harder
  drsZones: number           // number of DRS zones
  pitLossMs: number          // base pit lane time loss
  trackEvolutionFactor: number // rubber-in effect per lap
}

// ── Car state snapshot ──
export type CarState = {
  carIndex: number
  driverCode: string
  position: number
  gapToLeaderMs: number
  lastLapMs: number
  avgLapMs: number
  tyre: {
    compound: string
    wear: number       // 0-1
    stintLap: number
    wearSlope: number  // estimated per-lap wear rate
  }
  fuelKg: number
  isPitting: boolean
}

// ── Scenario definition ──
export type ScenarioSpec = {
  id: string
  label: string
  pitLap: number | null   // relative to current lap; null = stay out
  targetCompound: string
  secondPitLap?: number | null
  secondCompound?: string
}

// ── Simulation configuration ──
export type SimulationConfig = {
  minRuns: number
  maxRuns: number
  adaptiveTarget: number  // ms budget for total simulation time
  cacheTTLMs: number
  riskAversionFactor: number // 0-1, higher = more conservative
  seed: number
}

const DEFAULT_CONFIG: SimulationConfig = {
  minRuns: 40,
  maxRuns: 200,
  adaptiveTarget: 150, // 150ms compute budget
  cacheTTLMs: 2000,
  riskAversionFactor: 0.6,
  seed: 42,
}

// ── Per-run result ──
type RunResult = {
  totalTimeMs: number
  finalPosition: number
  expectedGainPositions: number
  scOccurred: boolean
  scLap: number | null
  vscOccurred: boolean
  pitLaps: number[]
  finalWear: number
  finalFuelKg: number
}

// ── Single scenario distribution output ──
export type DistributionStats = {
  mean: number
  median: number
  p10: number
  p90: number
  bestCase: number
  worstCase: number
  stddev: number
}

export type ScenarioOutcome = {
  scenarioId: string
  label: string
  runs: number
  totalTimeMs: DistributionStats
  position: DistributionStats
  expectedGain: DistributionStats // vs stay-out baseline
  podiumProbability: number
  positiveOutcomeProbability: number
  outcomeStability: number        // 0-1, derived from CV
  // Risk decomposition
  scDependency: number            // fraction of positive outcomes that depend on SC
  trafficRisk: number             // 0-1 exposure to traffic penalty
  tyreCriticalRisk: number        // probability of hitting cliff
  // Conditional analysis
  conditionalNoSC: DistributionStats  // expected gain given NO SC
  conditionalWithSC: DistributionStats // expected gain given SC occurs
  scProbabilityUsed: number
  // Raw data for histograms
  rawGains: number[]
  rawPositions: number[]
}

// ── Decision factor ──
export type DecisionFactor = {
  factor: string
  impact: number // -1 to +1
  description: string
}

// ── Execution checklist item ──
export type ExecutionStep = {
  step: number
  action: string
  timing: string
  details: string
  priority: 'critical' | 'high' | 'medium' | 'low'
}

// ── Final integrated output ──
export type UnifiedStrategyDecision = {
  recommended: ScenarioOutcome
  alternatives: ScenarioOutcome[]
  allScenarios: ScenarioOutcome[]
  // Decision quality
  confidenceScore: number         // 0-100
  separationScore: number         // gap between #1 and #2
  riskAdjustedScore: number       // the composite metric used for ranking
  // Decision log
  decisionFactors: DecisionFactor[]
  decisionRationale: string
  // Execution guidance
  executionChecklist: ExecutionStep[]
  // Metadata
  totalRuns: number
  computeTimeMs: number
  cacheHit: boolean
  timestamp: number
}

// ════════════════════════════════════════════════════════════════════
// TRACK DATABASE
// ════════════════════════════════════════════════════════════════════

const TRACK_PROFILES: Record<string, Partial<TrackProfile>> = {
  MONACO:       { baseSCRatePerLap: 0.028, overtakeDifficulty: 0.92, drsZones: 1, pitLossMs: 24500 },
  JEDDAH:       { baseSCRatePerLap: 0.025, overtakeDifficulty: 0.55, drsZones: 3, pitLossMs: 22800 },
  SINGAPORE:    { baseSCRatePerLap: 0.022, overtakeDifficulty: 0.80, drsZones: 3, pitLossMs: 24000 },
  BAKU:         { baseSCRatePerLap: 0.024, overtakeDifficulty: 0.40, drsZones: 2, pitLossMs: 24200 },
  MONZA:        { baseSCRatePerLap: 0.008, overtakeDifficulty: 0.25, drsZones: 2, pitLossMs: 21200 },
  SPA:          { baseSCRatePerLap: 0.012, overtakeDifficulty: 0.35, drsZones: 2, pitLossMs: 22500 },
  SUZUKA:       { baseSCRatePerLap: 0.010, overtakeDifficulty: 0.70, drsZones: 1, pitLossMs: 23000 },
  SILVERSTONE:  { baseSCRatePerLap: 0.009, overtakeDifficulty: 0.45, drsZones: 2, pitLossMs: 21800 },
  MELBOURNE:    { baseSCRatePerLap: 0.018, overtakeDifficulty: 0.65, drsZones: 4, pitLossMs: 22400 },
  INTERLAGOS:   { baseSCRatePerLap: 0.015, overtakeDifficulty: 0.35, drsZones: 2, pitLossMs: 21000 },
  HUNGARORING:  { baseSCRatePerLap: 0.007, overtakeDifficulty: 0.85, drsZones: 1, pitLossMs: 22600 },
  BARCELONA:    { baseSCRatePerLap: 0.006, overtakeDifficulty: 0.60, drsZones: 2, pitLossMs: 22000 },
  BAHRAIN:      { baseSCRatePerLap: 0.010, overtakeDifficulty: 0.35, drsZones: 3, pitLossMs: 21500 },
  LUSAIL:       { baseSCRatePerLap: 0.008, overtakeDifficulty: 0.40, drsZones: 2, pitLossMs: 21800 },
  SHANGHAI:     { baseSCRatePerLap: 0.011, overtakeDifficulty: 0.50, drsZones: 2, pitLossMs: 22000 },
  IMOLA:        { baseSCRatePerLap: 0.013, overtakeDifficulty: 0.72, drsZones: 1, pitLossMs: 22400 },
  ZANDVOORT:    { baseSCRatePerLap: 0.012, overtakeDifficulty: 0.78, drsZones: 1, pitLossMs: 22200 },
  VEGAS:        { baseSCRatePerLap: 0.020, overtakeDifficulty: 0.38, drsZones: 2, pitLossMs: 23500 },
  MIAMI:        { baseSCRatePerLap: 0.015, overtakeDifficulty: 0.42, drsZones: 3, pitLossMs: 22600 },
  RED_BULL_RING:{ baseSCRatePerLap: 0.009, overtakeDifficulty: 0.45, drsZones: 2, pitLossMs: 20800 },
  MONTREAL:     { baseSCRatePerLap: 0.018, overtakeDifficulty: 0.40, drsZones: 2, pitLossMs: 22000 },
  MEXICO:       { baseSCRatePerLap: 0.014, overtakeDifficulty: 0.50, drsZones: 3, pitLossMs: 22200 },
}

function resolveTrackProfile(trackId: string): TrackProfile {
  const key = Object.keys(TRACK_PROFILES).find(k => trackId.toUpperCase().includes(k)) ?? ''
  const partial = TRACK_PROFILES[key] ?? {}
  return {
    trackId: key || trackId,
    baseSCRatePerLap: partial.baseSCRatePerLap ?? 0.012,
    overtakeDifficulty: partial.overtakeDifficulty ?? 0.50,
    drsZones: partial.drsZones ?? 2,
    pitLossMs: partial.pitLossMs ?? 22000,
    trackEvolutionFactor: 0.002,
  }
}

// ════════════════════════════════════════════════════════════════════
// SUB-MODELS (all operate inside a single run)
// ════════════════════════════════════════════════════════════════════

// ── Tyre Sub-Model ──
function tyreLapPenaltyMs(
  wear: number,
  compound: string,
  stintLap: number,
  physics: CompoundPhysics,
): number {
  const wearClamped = Math.max(0, Math.min(1, wear))
  // Stable phase
  const stablePenalty = wearClamped * physics.stablePenaltyCoeff * physics.compoundBias
  // Cliff phase (exponential)
  let cliffPenalty = 0
  if (wearClamped > physics.cliffThreshold) {
    const depth = wearClamped - physics.cliffThreshold
    cliffPenalty = Math.pow(depth * 10, physics.cliffExponent) * 800
  }
  // Warmup (first N laps of stint)
  const warmupRemaining = Math.max(0, physics.warmupLaps - stintLap)
  const warmupPenalty = warmupRemaining > 0 ? physics.warmupPenaltyMs * (warmupRemaining / physics.warmupLaps) : 0
  return stablePenalty + cliffPenalty + warmupPenalty
}

function advanceWear(
  wear: number,
  baseSlope: number,
  fuelKg: number,
  dirtyAirGapMs: number,
  physics: CompoundPhysics,
  trackEvoLap: number, // laps into race for track evo
  rng: PRNG,
): number {
  // Fuel load multiplier: heavier = more wear
  const fuelFactor = 1 + (Math.max(0, fuelKg) / 60) * 0.25
  // Dirty air increases tyre wear
  const dirtyAirFactor = dirtyAirGapMs > 0 && dirtyAirGapMs < 2000
    ? 1 + (1 - dirtyAirGapMs / 2000) * 0.18
    : 1.0
  // Track evolution reduces wear slightly
  const trackEvo = Math.max(0.92, 1 - trackEvoLap * 0.0018)
  // Cliff acceleration
  const cliffAccel = wear > physics.cliffThreshold ? 1 + (wear - physics.cliffThreshold) * 3.5 : 1.0
  // Stochastic noise ±12%
  const noise = 1 + rng.gaussian(0, 0.06)

  const delta = baseSlope * fuelFactor * dirtyAirFactor * trackEvo * cliffAccel * noise
  return Math.min(1, wear + Math.max(0, delta))
}

// ── Fuel Sub-Model ──
function fuelWeightPenaltyMs(fuelKg: number): number {
  return Math.max(0, fuelKg - 25) * 33 // ~33ms per kg above 25kg
}

function advanceFuel(fuelKg: number, burnRatePerLap: number, rng: PRNG): number {
  const noise = rng.gaussian(1, 0.03)
  return Math.max(0, fuelKg - burnRatePerLap * noise)
}

// ── Traffic Sub-Model ──
function trafficPenaltyMs(
  gapAheadMs: number,
  trackProfile: TrackProfile,
  rng: PRNG,
): number {
  if (gapAheadMs <= 0 || gapAheadMs > 2000) return 0
  // Closer gap = more dirty air penalty
  const normalizedGap = gapAheadMs / 2000
  const basePenalty = (1 - normalizedGap) * 1200 * trackProfile.overtakeDifficulty
  // DRS benefit partially offsets
  const drsReduction = trackProfile.drsZones > 0 ? trackProfile.drsZones * 80 : 0
  return Math.max(0, basePenalty - drsReduction + rng.gaussian(0, 150))
}

// ── Overtake Sub-Model ──
function attemptOvertake(
  attackerPaceMs: number,
  defenderPaceMs: number,
  gapMs: number,
  trackProfile: TrackProfile,
  attackerTyreAge: number,
  defenderTyreAge: number,
  rng: PRNG,
): boolean {
  if (gapMs > 1500 || gapMs < 0) return false
  // Pace advantage factor
  const paceAdvantage = (defenderPaceMs - attackerPaceMs) / defenderPaceMs
  // Tyre freshness advantage
  const tyreAdvantage = Math.max(0, defenderTyreAge - attackerTyreAge) * 0.012
  // DRS opportunity
  const drsBoost = trackProfile.drsZones * 0.08
  // Track difficulty penalizes overtaking
  const difficulty = 1 - trackProfile.overtakeDifficulty
  // Composite probability
  const prob = Math.min(0.85, Math.max(0.02,
    (paceAdvantage * 15 + tyreAdvantage + drsBoost) * difficulty * 0.8
  ))
  return rng.bernoulli(prob)
}

// ── Safety Car Sub-Model — Poisson-Hazard with clustering ──
type SCEvent = { type: 'SC' | 'VSC'; startLap: number; durationLaps: number }

function sampleSCEvents(
  currentLap: number,
  horizonLaps: number,
  totalLaps: number,
  trackProfile: TrackProfile,
  weatherState: string,
  trafficDensity: number, // 0-1 how bunched up the field is
  avgWearPct: number,     // mean wear across grid
  rng: PRNG,
): SCEvent[] {
  const events: SCEvent[] = []
  const raceProg = currentLap / Math.max(1, totalLaps)

  // Phase multiplier
  let phaseMult = 1.0
  if (raceProg < 0.05) phaseMult = 2.5      // lap 1 chaos
  else if (raceProg > 0.85) phaseMult = 1.4  // late race
  else if (raceProg > 0.70) phaseMult = 1.2  // degradation phase

  // Weather multiplier
  const wetIdx = parseInt(weatherState.replace('WEATHER_', ''), 10) || 0
  const weatherMult = 1 + wetIdx * 0.35 // 0→1.0, 3→2.05, 5→2.75

  // Traffic density multiplier
  const trafficMult = 1 + trafficDensity * 0.4

  // Wear multiplier (worn tyres → more incidents)
  const wearMult = 1 + Math.max(0, avgWearPct - 0.5) * 0.4

  // Effective hazard rate per lap
  const baseRate = trackProfile.baseSCRatePerLap
  const effectiveRate = baseRate * phaseMult * weatherMult * trafficMult * wearMult

  // Sample using Poisson process across the horizon
  // Expected events in horizon
  const lambda = effectiveRate * horizonLaps
  const nEvents = rng.poisson(lambda)

  // Place events with non-uniform timing (early-biased by traffic)
  let lastEventEnd = -5 // cooldown tracking
  for (let i = 0; i < nEvents; i++) {
    // Random lap within horizon, with clustering
    let eventLap: number
    if (events.length > 0 && rng.bernoulli(0.25)) {
      // Clustering: 25% chance event occurs near previous event
      const prevEnd = events[events.length - 1].startLap + events[events.length - 1].durationLaps
      eventLap = prevEnd + Math.round(rng.uniform(1, 3))
    } else {
      eventLap = currentLap + Math.round(rng.uniform(0, horizonLaps - 1))
    }

    // Cooldown: no SC within 3 laps of previous event end
    if (eventLap < lastEventEnd + 3) continue
    if (eventLap >= currentLap + horizonLaps) continue

    // SC vs VSC: 60% SC, 40% VSC
    const isSC = rng.bernoulli(0.6)
    const duration = isSC
      ? Math.round(rng.uniform(3, 6))    // SC: 3-6 laps
      : Math.round(rng.uniform(2, 4))    // VSC: 2-4 laps

    events.push({
      type: isSC ? 'SC' : 'VSC',
      startLap: eventLap,
      durationLaps: duration,
    })
    lastEventEnd = eventLap + duration
  }

  return events.sort((a, b) => a.startLap - b.startLap)
}

/** Check if a given lap is under SC/VSC */
function scStatusAtLap(lap: number, events: SCEvent[]): 'NONE' | 'SC' | 'VSC' {
  for (const ev of events) {
    if (lap >= ev.startLap && lap < ev.startLap + ev.durationLaps) return ev.type
  }
  return 'NONE'
}

// ── Rival Strategy Sampling ──

type RivalStrategyPathDef = {
  id: string
  weight: number
  pitLapOffset: number | null // relative to current; null=no pit
  targetCompound: string
}

function sampleRivalStrategy(
  rival: CarState,
  currentLap: number,
  horizon: number,
  rng: PRNG,
): RivalStrategyPathDef {
  const compound = resolveCompound(rival.tyre.compound)
  const physics = getCompoundPhysics(compound)
  const wear = rival.tyre.wear
  const stintLap = rival.tyre.stintLap
  const lapsToCliff = Math.max(0, (physics.cliffThreshold - wear) / Math.max(0.005, rival.tyre.wearSlope))

  // Build weighted paths
  const paths: RivalStrategyPathDef[] = []

  // Aggressive undercut
  const undercutWeight = wear > 0.65 && lapsToCliff < 3 ? 4.5
    : wear > 0.55 ? 3.0
    : stintLap > 15 ? 2.5
    : 1.5
  const nextCompound = compound === 'SOFT' ? 'MEDIUM' : compound === 'MEDIUM' ? 'HARD' : 'MEDIUM'
  const undercutLap = Math.max(0, Math.round(lapsToCliff * 0.5))
  paths.push({
    id: 'aggressive_undercut',
    weight: undercutWeight,
    pitLapOffset: Math.min(undercutLap, horizon - 1),
    targetCompound: nextCompound,
  })

  // Defensive cover (pit 1-2 laps after expected leader pit)
  const coverWeight = 1.0
  paths.push({
    id: 'defensive_cover',
    weight: coverWeight,
    pitLapOffset: Math.min(undercutLap + 2, horizon - 1),
    targetCompound: nextCompound,
  })

  // Long stint
  const longWeight = compound === 'HARD' && wear < 0.5 ? 4.5
    : wear < 0.4 ? 3.5
    : lapsToCliff > 8 ? 3.0
    : 1.5
  paths.push({
    id: 'long_stint',
    weight: longWeight,
    pitLapOffset: lapsToCliff > horizon ? null : Math.min(Math.round(lapsToCliff * 0.85), horizon - 1),
    targetCompound: nextCompound,
  })

  // Status quo (no pit, run to end)
  const statusQuoWeight = horizon < 5 ? 4.0 : lapsToCliff > horizon ? 3.0 : 0.5
  paths.push({
    id: 'status_quo',
    weight: statusQuoWeight,
    pitLapOffset: null,
    targetCompound: compound,
  })

  const idx = rng.weightedChoice(paths.map(p => p.weight))
  return paths[idx]
}

// ── Pit Stop Sub-Model ──
function simulatePitStop(
  basePitLossMs: number,
  scStatus: 'NONE' | 'SC' | 'VSC',
  rng: PRNG,
): number {
  // Base variance ±800ms
  const variance = rng.gaussian(0, 800)
  let loss = basePitLossMs + variance
  // SC/VSC reduces effective pit cost (field bunched up)
  if (scStatus === 'SC') loss *= 0.42  // huge benefit
  if (scStatus === 'VSC') loss *= 0.65 // moderate benefit
  return Math.max(12000, loss)
}

// ════════════════════════════════════════════════════════════════════
// SINGLE RUN SIMULATION
// ════════════════════════════════════════════════════════════════════

type RunContext = {
  playerState: CarState
  rivals: CarState[]
  scenario: ScenarioSpec
  trackProfile: TrackProfile
  weatherState: string
  currentLap: number
  totalLaps: number
  horizon: number
  fuelBurnPerLap: number
}

function simulateRun(ctx: RunContext, rng: PRNG): RunResult {
  const { playerState, rivals, scenario, trackProfile, weatherState, currentLap, totalLaps, horizon, fuelBurnPerLap } = ctx

  // ── Sample SC/VSC events for this run ──
  const avgWear = rivals.reduce((s, r) => s + r.tyre.wear, playerState.tyre.wear) / (rivals.length + 1)
  const trafficDensity = computeTrafficDensity(playerState, rivals)
  const scEvents = sampleSCEvents(currentLap, horizon, totalLaps, trackProfile, weatherState, trafficDensity, avgWear, rng)

  // ── Sample rival strategies ──
  const rivalStrategies = rivals.map(r => ({
    ...r,
    strategy: sampleRivalStrategy(r, currentLap, horizon, rng),
    runningTimeMs: 0,
    runningWear: r.tyre.wear,
    runningFuel: r.fuelKg,
    runningCompound: r.tyre.compound,
    runningStintLap: r.tyre.stintLap,
    runningSlope: r.tyre.wearSlope,
  }))

  // ── Player state ──
  let playerTimeMs = 0
  let playerWear = playerState.tyre.wear
  let playerFuel = playerState.fuelKg
  let playerCompound = playerState.tyre.compound
  let playerStintLap = playerState.tyre.stintLap
  let playerSlope = playerState.tyre.wearSlope
  let playerPitLaps: number[] = []
  const playerPhysics = () => getCompoundPhysics(resolveCompound(playerCompound))
  let playerPosition = playerState.position

  let scOccurred = false
  let scLap: number | null = null
  let vscOccurred = false

  // ── Lap-by-lap simulation ──
  for (let lapIdx = 0; lapIdx < horizon; lapIdx++) {
    const raceLap = currentLap + lapIdx
    const scStatus = scStatusAtLap(raceLap, scEvents)

    if (scStatus === 'SC' && !scOccurred) { scOccurred = true; scLap = raceLap }
    if (scStatus === 'VSC') vscOccurred = true

    // ── Player pit stop ──
    const isPlayerPitLap = scenario.pitLap !== null && lapIdx === scenario.pitLap
    const isPlayerSecondPit = scenario.secondPitLap != null && lapIdx === scenario.secondPitLap

    if (isPlayerPitLap || isPlayerSecondPit) {
      const pitCost = simulatePitStop(trackProfile.pitLossMs, scStatus, rng)
      playerTimeMs += pitCost
      const newCompound = isPlayerSecondPit
        ? (scenario.secondCompound ?? 'HARD')
        : scenario.targetCompound
      playerCompound = newCompound
      playerWear = 0.06 + rng.gaussian(0, 0.01) // fresh tyres ±1%
      playerStintLap = 0
      playerSlope = getCompoundPhysics(resolveCompound(newCompound)).baseWearRate
      playerPitLaps.push(raceLap)
    }

    // ── Player lap time ──
    if (scStatus === 'SC') {
      playerTimeMs += playerState.avgLapMs * 1.28 + rng.gaussian(0, 200)
    } else if (scStatus === 'VSC') {
      playerTimeMs += playerState.avgLapMs * 1.15 + rng.gaussian(0, 300)
    } else {
      const phys = playerPhysics()
      const tyrePenalty = tyreLapPenaltyMs(playerWear, playerCompound, playerStintLap, phys)
      const fuelPenalty = fuelWeightPenaltyMs(playerFuel)

      // Find gap to car ahead for traffic
      const carAheadGap = findGapToCarAhead(playerPosition, rivalStrategies, playerTimeMs)
      const traffic = trafficPenaltyMs(carAheadGap, trackProfile, rng)

      const baseLap = playerState.avgLapMs + rng.gaussian(0, playerState.avgLapMs * 0.005)
      playerTimeMs += baseLap + tyrePenalty + fuelPenalty + traffic
    }

    // Advance player state
    if (scStatus === 'NONE') {
      const carAheadGap = findGapToCarAhead(playerPosition, rivalStrategies, playerTimeMs)
      playerWear = advanceWear(playerWear, playerSlope, playerFuel, carAheadGap, playerPhysics(), raceLap, rng)
      playerFuel = advanceFuel(playerFuel, fuelBurnPerLap, rng)
    }
    playerStintLap++

    // ── Simulate each rival ──
    for (const rival of rivalStrategies) {
      const rivalPhysics = getCompoundPhysics(resolveCompound(rival.runningCompound))

      // Rival pit stop
      if (rival.strategy.pitLapOffset !== null && lapIdx === rival.strategy.pitLapOffset) {
        const pitCost = simulatePitStop(trackProfile.pitLossMs, scStatus, rng)
        rival.runningTimeMs += pitCost
        rival.runningCompound = rival.strategy.targetCompound
        rival.runningWear = 0.06
        rival.runningStintLap = 0
        rival.runningSlope = getCompoundPhysics(resolveCompound(rival.strategy.targetCompound)).baseWearRate
      }

      // Rival lap time
      if (scStatus === 'SC') {
        rival.runningTimeMs += rival.avgLapMs * 1.28 + rng.gaussian(0, 200)
      } else if (scStatus === 'VSC') {
        rival.runningTimeMs += rival.avgLapMs * 1.15 + rng.gaussian(0, 300)
      } else {
        const tyrePen = tyreLapPenaltyMs(rival.runningWear, rival.runningCompound, rival.runningStintLap, rivalPhysics)
        const fuelPen = fuelWeightPenaltyMs(rival.runningFuel)
        const baseLap = rival.avgLapMs + rng.gaussian(0, rival.avgLapMs * 0.006)
        rival.runningTimeMs += baseLap + tyrePen + fuelPen
      }

      // Advance rival state
      if (scStatus === 'NONE') {
        rival.runningWear = advanceWear(rival.runningWear, rival.runningSlope, rival.runningFuel, 0, rivalPhysics, raceLap, rng)
        rival.runningFuel = advanceFuel(rival.runningFuel, fuelBurnPerLap * (0.95 + rng.gaussian(0, 0.03)), rng)
      }
      rival.runningStintLap++
    }

    // ── Resolve overtakes (non-SC laps) ──
    if (scStatus === 'NONE') {
      resolveOvertakes(playerPosition, playerTimeMs, playerStintLap, rivalStrategies, trackProfile, rng,
        (newPos) => { playerPosition = newPos })
    }

    // ── SC gap compression ──
    if (scStatus === 'SC') {
      // Compress all gaps toward leader
      for (const rival of rivalStrategies) {
        rival.runningTimeMs = rival.runningTimeMs * 0.97 + playerTimeMs * 0.03
      }
    }
  }

  // ── Final position calculation ──
  const finalPosition = computeFinalPosition(playerTimeMs, playerState.gapToLeaderMs, rivalStrategies)

  return {
    totalTimeMs: playerTimeMs,
    finalPosition,
    expectedGainPositions: playerState.position - finalPosition,
    scOccurred,
    scLap,
    vscOccurred,
    pitLaps: playerPitLaps,
    finalWear: playerWear,
    finalFuelKg: playerFuel,
  }
}

// ── Helper: compute traffic density ──
function computeTrafficDensity(player: CarState, rivals: CarState[]): number {
  const closeGaps = rivals.filter(r => Math.abs(r.gapToLeaderMs - player.gapToLeaderMs) < 2000).length
  return Math.min(1, closeGaps / Math.max(1, rivals.length))
}

// ── Helper: find gap to car ahead ──
function findGapToCarAhead(
  playerPos: number,
  rivals: Array<{ position: number; runningTimeMs: number }>,
  playerTimeMs: number,
): number {
  const carAhead = rivals.find(r => r.position === playerPos - 1)
  if (!carAhead) return 5000 // clear air
  return Math.max(0, playerTimeMs - carAhead.runningTimeMs)
}

// ── Helper: resolve overtakes for a lap ──
function resolveOvertakes(
  playerPos: number,
  playerTimeMs: number,
  playerStintLap: number,
  rivals: Array<{
    position: number; runningTimeMs: number; runningStintLap: number;
    avgLapMs: number
  }>,
  trackProfile: TrackProfile,
  rng: PRNG,
  setPlayerPos: (pos: number) => void,
): void {
  // Check if player can overtake car ahead
  const carAhead = rivals.find(r => r.position === playerPos - 1)
  if (carAhead) {
    const gap = playerTimeMs - carAhead.runningTimeMs
    if (gap > 0 && gap < 1500) {
      const didOvertake = attemptOvertake(
        playerTimeMs / Math.max(1, playerStintLap),
        carAhead.runningTimeMs / Math.max(1, carAhead.runningStintLap),
        gap, trackProfile, playerStintLap, carAhead.runningStintLap, rng
      )
      if (didOvertake) {
        carAhead.position = playerPos
        setPlayerPos(playerPos - 1)
      }
    }
  }

  // Check if car behind can overtake player
  const carBehind = rivals.find(r => r.position === playerPos + 1)
  if (carBehind) {
    const gap = carBehind.runningTimeMs - playerTimeMs
    if (gap > 0 && gap < 1500) {
      const didOvertake = attemptOvertake(
        carBehind.runningTimeMs / Math.max(1, carBehind.runningStintLap),
        playerTimeMs / Math.max(1, playerStintLap),
        gap, trackProfile, carBehind.runningStintLap, playerStintLap, rng
      )
      if (didOvertake) {
        carBehind.position = playerPos
        setPlayerPos(playerPos + 1)
      }
    }
  }
}

// ── Helper: compute final position from time ──
function computeFinalPosition(
  playerTimeMs: number,
  playerGapToLeader: number,
  rivals: Array<{ position: number; runningTimeMs: number; gapToLeaderMs: number }>,
): number {
  // Build absolute race time estimates
  type Entry = { isPlayer: boolean; estimatedTotalMs: number; origPos: number }
  const entries: Entry[] = [
    { isPlayer: true, estimatedTotalMs: playerTimeMs + playerGapToLeader, origPos: 0 },
  ]
  for (const r of rivals) {
    entries.push({
      isPlayer: false,
      estimatedTotalMs: r.runningTimeMs + r.gapToLeaderMs,
      origPos: r.position,
    })
  }
  entries.sort((a, b) => a.estimatedTotalMs - b.estimatedTotalMs)
  const playerEntry = entries.findIndex(e => e.isPlayer)
  return playerEntry + 1
}

// ════════════════════════════════════════════════════════════════════
// DISTRIBUTION ANALYSIS
// ════════════════════════════════════════════════════════════════════

function computeDistribution(values: number[]): DistributionStats {
  if (values.length === 0) {
    return { mean: 0, median: 0, p10: 0, p90: 0, bestCase: 0, worstCase: 0, stddev: 0 }
  }
  const sorted = [...values].sort((a, b) => a - b)
  const n = sorted.length
  const mean = sorted.reduce((a, b) => a + b, 0) / n
  const median = n % 2 === 0 ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2 : sorted[Math.floor(n / 2)]
  const p10 = sorted[Math.max(0, Math.floor(n * 0.1))]
  const p90 = sorted[Math.min(n - 1, Math.floor(n * 0.9))]
  const variance = sorted.reduce((acc, v) => acc + (v - mean) ** 2, 0) / n
  return {
    mean: Math.round(mean),
    median: Math.round(median),
    p10: Math.round(p10),
    p90: Math.round(p90),
    bestCase: Math.round(sorted[0]),
    worstCase: Math.round(sorted[n - 1]),
    stddev: Math.round(Math.sqrt(variance)),
  }
}

// ── Risk-Aware Decision Metric ──
// Combines expected value with downside risk
function riskAdjustedScore(gains: number[], riskAversion: number): number {
  if (gains.length === 0) return -Infinity
  const sorted = [...gains].sort((a, b) => a - b)
  const n = sorted.length
  const mean = sorted.reduce((a, b) => a + b, 0) / n
  const p10 = sorted[Math.max(0, Math.floor(n * 0.1))]
  const p90 = sorted[Math.min(n - 1, Math.floor(n * 0.9))]
  // CVaR (Conditional Value at Risk) — average of worst 20% outcomes
  const worstN = Math.max(1, Math.floor(n * 0.2))
  const cvar = sorted.slice(0, worstN).reduce((a, b) => a + b, 0) / worstN
  // Upside potential — average of best 20% outcomes
  const bestN = Math.max(1, Math.floor(n * 0.2))
  const upside = sorted.slice(n - bestN).reduce((a, b) => a + b, 0) / bestN
  // Composite: mean + upside bonus - cvar penalty
  return mean * (1 - riskAversion) + cvar * riskAversion * 0.5 + upside * (1 - riskAversion) * 0.3
}

// ════════════════════════════════════════════════════════════════════
// SCENARIO EVALUATION
// ════════════════════════════════════════════════════════════════════

function evaluateScenario(
  scenario: ScenarioSpec,
  baselineGains: number[] | null, // gains from STAY_OUT for comparison
  ctx: RunContext,
  config: SimulationConfig,
): ScenarioOutcome {
  const startTime = performance.now()
  const runs: RunResult[] = []
  const gains: number[] = []
  const positions: number[] = []
  const times: number[] = []
  const scGains: number[] = []
  const noScGains: number[] = []

  // Adaptive run count: start with min, expand if time allows
  const runCtx = { ...ctx, scenario }
  let runCount = config.minRuns

  for (let i = 0; i < config.maxRuns; i++) {
    if (i >= config.minRuns && performance.now() - startTime > config.adaptiveTarget) break
    const rng = new PRNG(config.seed + i * 7919 + scenario.id.charCodeAt(0) * 31)
    const result = simulateRun(runCtx, rng)
    runs.push(result)
    times.push(result.totalTimeMs)
    positions.push(result.finalPosition)
    gains.push(result.expectedGainPositions)

    // Conditional split
    if (result.scOccurred || result.vscOccurred) {
      scGains.push(result.expectedGainPositions)
    } else {
      noScGains.push(result.expectedGainPositions)
    }

    runCount = i + 1
  }

  // Compute distributions
  const totalTimeDist = computeDistribution(times)
  const positionDist = computeDistribution(positions)
  const gainDist = computeDistribution(gains)
  const conditionalNoSC = computeDistribution(noScGains)
  const conditionalWithSC = computeDistribution(scGains)

  // Podium probability
  const podiumCount = positions.filter(p => p <= 3).length
  const podiumProbability = podiumCount / runCount

  // Positive outcome probability (gained positions)
  const positiveCount = gains.filter(g => g > 0).length
  const positiveOutcomeProbability = positiveCount / runCount

  // Outcome stability: 1 - normalized coefficient of variation
  const gainMean = gains.reduce((a, b) => a + b, 0) / runCount
  const gainVar = gains.reduce((acc, v) => acc + (v - gainMean) ** 2, 0) / runCount
  const cv = gainMean !== 0 ? Math.sqrt(gainVar) / Math.abs(gainMean) : 1
  const outcomeStability = Math.max(0, Math.min(1, 1 - cv * 0.3))

  // SC dependency: what fraction of gains disappear without SC?
  const scDependency = scGains.length > 0 && noScGains.length > 0
    ? Math.max(0, Math.min(1,
      (conditionalWithSC.mean - conditionalNoSC.mean) /
      (Math.abs(conditionalWithSC.mean) + Math.abs(conditionalNoSC.mean) + 0.01)
    ))
    : 0

  // Traffic risk: fraction of runs with negative gain AND no SC (pure traffic loss)
  const trafficRisk = noScGains.length > 0
    ? noScGains.filter(g => g < 0).length / noScGains.length
    : 0

  // Tyre critical risk: fraction of runs that ended with wear > cliff threshold
  const cliffThreshold = getCompoundPhysics(resolveCompound(scenario.targetCompound)).cliffThreshold
  const tyreCriticalRisk = runs.filter(r => r.finalWear > cliffThreshold).length / runCount

  // SC probability used across runs
  const scProbabilityUsed = runs.filter(r => r.scOccurred || r.vscOccurred).length / runCount

  return {
    scenarioId: scenario.id,
    label: scenario.label,
    runs: runCount,
    totalTimeMs: totalTimeDist,
    position: positionDist,
    expectedGain: gainDist,
    podiumProbability,
    positiveOutcomeProbability,
    outcomeStability,
    scDependency,
    trafficRisk,
    tyreCriticalRisk,
    conditionalNoSC,
    conditionalWithSC,
    scProbabilityUsed,
    rawGains: gains,
    rawPositions: positions,
  }
}

// ════════════════════════════════════════════════════════════════════
// SCENARIO GENERATION
// ════════════════════════════════════════════════════════════════════

function generateScenarios(
  playerState: CarState,
  horizon: number,
  currentLap: number,
  totalLaps: number,
): ScenarioSpec[] {
  const compound = resolveCompound(playerState.tyre.compound)
  const nextCompound = compound === 'SOFT' ? 'MEDIUM' : compound === 'MEDIUM' ? 'HARD' : 'MEDIUM'
  const aggressiveCompound = 'SOFT'

  const scenarios: ScenarioSpec[] = [
    // Always present: stay out and box now
    { id: 'STAY_OUT', label: 'STAY OUT', pitLap: null, targetCompound: compound },
    { id: 'BOX_THIS_LAP', label: 'BOX THIS LAP', pitLap: 0, targetCompound: nextCompound },
  ]

  // Conditional scenarios based on remaining laps
  if (horizon >= 4) {
    scenarios.push({ id: 'PIT_IN_2', label: 'PIT IN 2 LAPS', pitLap: 2, targetCompound: nextCompound })
  }
  if (horizon >= 6) {
    scenarios.push({ id: 'PIT_IN_4', label: 'PIT IN 4 LAPS', pitLap: 4, targetCompound: nextCompound })
  }
  if (horizon >= 8) {
    scenarios.push({ id: 'PIT_IN_6', label: 'PIT IN 6 LAPS', pitLap: 6, targetCompound: nextCompound })
  }

  // Aggressive box-onto-soft if early enough for two stops
  const lapsRemaining = totalLaps - currentLap
  if (lapsRemaining > 20 && compound !== 'SOFT') {
    scenarios.push({
      id: 'BOX_AGGRESSIVE',
      label: 'BOX AGGRESSIVE (SOFT)',
      pitLap: 0,
      targetCompound: aggressiveCompound,
      secondPitLap: Math.min(Math.round(horizon * 0.55), horizon - 3),
      secondCompound: 'MEDIUM',
    })
  }

  // Wait-for-SC scenario: extended stay-out hoping for SC
  if (horizon >= 8) {
    scenarios.push({
      id: 'WAIT_FOR_SC',
      label: 'WAIT FOR SC',
      pitLap: Math.min(Math.round(horizon * 0.6), horizon - 2),
      targetCompound: nextCompound,
    })
  }

  return scenarios
}

// ════════════════════════════════════════════════════════════════════
// DECISION FACTORS & EXECUTION CHECKLIST
// ════════════════════════════════════════════════════════════════════

function buildDecisionFactors(
  recommended: ScenarioOutcome,
  alternatives: ScenarioOutcome[],
  playerState: CarState,
  trackProfile: TrackProfile,
): DecisionFactor[] {
  const factors: DecisionFactor[] = []
  const physics = getCompoundPhysics(resolveCompound(playerState.tyre.compound))
  const wear = playerState.tyre.wear
  const lapsToCliff = (physics.cliffThreshold - wear) / Math.max(0.005, playerState.tyre.wearSlope)

  // Tyre cliff proximity
  if (lapsToCliff < 4) {
    factors.push({
      factor: 'TYRE_CLIFF',
      impact: Math.min(1, (4 - lapsToCliff) / 4),
      description: `타이어 클리프까지 약 ${Math.round(lapsToCliff)}랩 — ${wear > physics.cliffThreshold ? '이미 클리프 구간' : '임박'}`,
    })
  }

  // SC dependency
  if (recommended.scDependency > 0.3) {
    factors.push({
      factor: 'SC_DEPENDENCY',
      impact: -recommended.scDependency,
      description: `추천 전략이 SC/VSC 발생에 ${Math.round(recommended.scDependency * 100)}% 의존`,
    })
  }

  // SC probability itself
  if (recommended.scProbabilityUsed > 0.15) {
    factors.push({
      factor: 'SC_PROBABILITY',
      impact: 0.3,
      description: `시뮬레이션 중 ${Math.round(recommended.scProbabilityUsed * 100)}%에서 SC/VSC 발생`,
    })
  }

  // Traffic risk
  if (recommended.trafficRisk > 0.3) {
    factors.push({
      factor: 'TRAFFIC_RISK',
      impact: -recommended.trafficRisk * 0.8,
      description: `트래픽 손실 위험 ${Math.round(recommended.trafficRisk * 100)}%`,
    })
  }

  // Undercut window
  if (recommended.scenarioId.includes('BOX') || recommended.scenarioId.includes('PIT')) {
    const gainVsStayOut = alternatives.find(a => a.scenarioId === 'STAY_OUT')
    if (gainVsStayOut) {
      const undercutGain = recommended.expectedGain.mean - gainVsStayOut.expectedGain.mean
      if (undercutGain > 0) {
        factors.push({
          factor: 'UNDERCUT_WINDOW',
          impact: Math.min(0.8, undercutGain * 0.3),
          description: `언더컷으로 평균 ${undercutGain.toFixed(1)}포지션 이득 기대`,
        })
      }
    }
  }

  // Outcome stability comparison
  const bestAlt = alternatives[0]
  if (bestAlt && recommended.outcomeStability > bestAlt.outcomeStability + 0.1) {
    factors.push({
      factor: 'STABILITY_ADVANTAGE',
      impact: 0.4,
      description: `추천 전략이 대안 대비 결과 안정성 ${Math.round((recommended.outcomeStability - bestAlt.outcomeStability) * 100)}% 우위`,
    })
  }

  // Track overtaking difficulty
  if (trackProfile.overtakeDifficulty > 0.7 && recommended.scenarioId !== 'STAY_OUT') {
    factors.push({
      factor: 'TRACK_DIFFICULTY',
      impact: -0.3,
      description: `오버테이크 난이도 높은 트랙 — 포지션 회복 어려움`,
    })
  }

  return factors.sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact))
}

function buildExecutionChecklist(
  recommended: ScenarioOutcome,
  scenario: ScenarioSpec,
  playerState: CarState,
  trackProfile: TrackProfile,
  currentLap: number,
): ExecutionStep[] {
  const steps: ExecutionStep[] = []
  let stepNum = 1

  if (scenario.pitLap !== null) {
    const pitRaceLap = currentLap + scenario.pitLap
    steps.push({
      step: stepNum++,
      action: 'PIT ENTRY',
      timing: `LAP ${pitRaceLap}`,
      details: `${scenario.targetCompound} 타이어로 교체. 예상 피트로스: ${(trackProfile.pitLossMs / 1000).toFixed(1)}초`,
      priority: 'critical',
    })
    steps.push({
      step: stepNum++,
      action: 'IN-LAP MANAGEMENT',
      timing: `LAP ${pitRaceLap}`,
      details: '마지막 섹터에서 연료 절약 모드 사용 가능. 타이어 과도한 온도 상승 방지',
      priority: 'high',
    })
    steps.push({
      step: stepNum++,
      action: 'OUT-LAP',
      timing: `LAP ${pitRaceLap + 1}`,
      details: `새 ${scenario.targetCompound} 타이어 워밍업 필요. 처음 ${getCompoundPhysics(resolveCompound(scenario.targetCompound)).warmupLaps}랩은 그립 제한`,
      priority: 'high',
    })

    if (recommended.trafficRisk > 0.3) {
      steps.push({
        step: stepNum++,
        action: 'TRAFFIC AVOIDANCE',
        timing: `LAP ${pitRaceLap + 1}-${pitRaceLap + 3}`,
        details: `아웃랩 후 트래픽 예상. DRS 구간 ${trackProfile.drsZones}개 활용하여 오버테이크 시도`,
        priority: 'medium',
      })
    }

    if (scenario.secondPitLap != null) {
      const secondPitRaceLap = currentLap + scenario.secondPitLap
      steps.push({
        step: stepNum++,
        action: '2ND PIT ENTRY',
        timing: `LAP ${secondPitRaceLap}`,
        details: `${scenario.secondCompound ?? 'HARD'} 타이어로 교체 (2-스탑 전략)`,
        priority: 'critical',
      })
    }
  } else {
    // Stay out
    const physics = getCompoundPhysics(resolveCompound(playerState.tyre.compound))
    const lapsToCliff = Math.max(0, (physics.cliffThreshold - playerState.tyre.wear) / Math.max(0.005, playerState.tyre.wearSlope))
    steps.push({
      step: stepNum++,
      action: 'TYRE MANAGEMENT',
      timing: `LAP ${currentLap}-${currentLap + Math.round(lapsToCliff)}`,
      details: `현재 ${playerState.tyre.compound} 타이어 유지. 클리프까지 ~${Math.round(lapsToCliff)}랩. 연료 절약으로 타이어 보존`,
      priority: 'high',
    })
  }

  // SC contingency
  if (recommended.scProbabilityUsed > 0.1) {
    steps.push({
      step: stepNum++,
      action: 'SC/VSC CONTINGENCY',
      timing: 'REACTIVE',
      details: `SC 발생 확률 ${Math.round(recommended.scProbabilityUsed * 100)}%. SC 발생 시 즉시 피트 진입 검토 (피트로스 ${Math.round(trackProfile.pitLossMs * 0.42 / 1000)}초로 감소)`,
      priority: recommended.scDependency > 0.3 ? 'high' : 'medium',
    })
  }

  // Fuel management
  if (playerState.fuelKg < 15) {
    steps.push({
      step: stepNum++,
      action: 'FUEL SAVING',
      timing: 'IMMEDIATE',
      details: `잔여 연료 ${playerState.fuelKg.toFixed(1)}kg — 리프트 앤 코스트 필요`,
      priority: 'high',
    })
  }

  return steps
}

function buildDecisionRationale(
  recommended: ScenarioOutcome,
  alternatives: ScenarioOutcome[],
  factors: DecisionFactor[],
): string {
  const topFactors = factors.slice(0, 3).map(f => f.description).join('. ')
  const gainText = recommended.expectedGain.mean > 0
    ? `평균 ${recommended.expectedGain.mean.toFixed(1)}포지션 이득`
    : `평균 ${Math.abs(recommended.expectedGain.mean).toFixed(1)}포지션 손실`
  const stabilityText = recommended.outcomeStability > 0.7 ? '높은 안정성' : recommended.outcomeStability > 0.4 ? '보통 안정성' : '낮은 안정성'
  const scText = recommended.scDependency > 0.3 ? ` (SC 의존도 ${Math.round(recommended.scDependency * 100)}%)` : ''

  return `${recommended.label}: ${gainText}, ${stabilityText}${scText}. ${topFactors}`
}

// ════════════════════════════════════════════════════════════════════
// CACHING
// ════════════════════════════════════════════════════════════════════

type CacheEntry = {
  key: string
  result: UnifiedStrategyDecision
  timestamp: number
}

let _cache: CacheEntry | null = null

function buildCacheKey(state: AppState): string {
  const p = state.player
  const lb = state.leaderboard
  return `${state.session_uid}:${p.lap}:${p.position}:${p.tyre_compound}:${state.total_laps}:${state.race_control_state}:${Math.round(p.fuel ?? 0)}:${lb.length}:${lb[0]?.last_lap_ms ?? 0}:${lb[0]?.tyre_wear_pct ?? 0}`
}

// ════════════════════════════════════════════════════════════════════
// MAIN ENTRY POINT
// ════════════════════════════════════════════════════════════════════

export function evaluateStrategy(
  state: AppState,
  tyreHistory: TyreHistory | null,
  configOverride?: Partial<SimulationConfig>,
): UnifiedStrategyDecision {
  const config = { ...DEFAULT_CONFIG, ...configOverride }
  const overallStart = performance.now()

  // ── Cache check ──
  const cacheKey = buildCacheKey(state)
  if (_cache && _cache.key === cacheKey && (Date.now() - _cache.timestamp) < config.cacheTTLMs) {
    return { ..._cache.result, cacheHit: true }
  }

  // ── Extract context ──
  const trackProfile = resolveTrackProfile(state.track ?? '')
  const currentLap = state.player.lap ?? 1
  const totalLaps = state.total_laps ?? 58
  const horizon = Math.max(3, totalLaps - currentLap)
  const weatherState = state.weather_state ?? 'WEATHER_0'

  // ── Build player car state ──
  const playerRow = state.leaderboard.find(r => r.car_index === state.player_car_index)
  const playerCompound = resolveCompound(playerRow?.tyre_compound ?? state.player.tyre_compound ?? 'MEDIUM')
  const playerWearSlope = tyreHistory
    ? estimateWearSlopeFromHistory(tyreHistory[state.player_car_index ?? 0], playerCompound)
    : getCompoundPhysics(playerCompound).baseWearRate

  const playerState: CarState = {
    carIndex: state.player_car_index ?? 0,
    driverCode: playerRow?.driver_code ?? 'PLY',
    position: state.player.position ?? 1,
    gapToLeaderMs: playerRow?.gap_to_player_s != null ? playerRow.gap_to_player_s * 1000 : 0,
    lastLapMs: state.player.last_lap_ms ?? state.pace?.avg_lap_ms ?? 90000,
    avgLapMs: state.pace?.avg_lap_ms ?? 90000,
    tyre: {
      compound: playerCompound,
      wear: (playerRow?.tyre_wear_pct ?? 30) / 100,
      stintLap: playerRow?.stint_lap ?? currentLap,
      wearSlope: playerWearSlope,
    },
    fuelKg: state.player.fuel ?? 50,
    isPitting: false,
  }

  // ── Build rival car states ──
  const rivals: CarState[] = state.leaderboard
    .filter(r => r.car_index !== state.player_car_index)
    .map(r => {
      const rCompound = resolveCompound(r.tyre_compound)
      return {
        carIndex: r.car_index,
        driverCode: r.driver_code,
        position: r.position,
        gapToLeaderMs: (r.gap_to_player_s ?? 0) * 1000,
        lastLapMs: r.last_lap_ms || state.pace?.avg_lap_ms || 90000,
        avgLapMs: r.last_lap_ms || state.pace?.avg_lap_ms || 90000,
        tyre: {
          compound: rCompound,
          wear: (r.tyre_wear_pct ?? 30) / 100,
          stintLap: r.stint_lap ?? 10,
          wearSlope: getCompoundPhysics(rCompound).baseWearRate,
        },
        fuelKg: 50, // estimated
        isPitting: r.is_pitting ?? false,
      }
    })

  // ── Estimate fuel burn rate ──
  const fuelBurnPerLap = 1.6 // default F1 burn rate

  // ── Generate scenarios ──
  const scenarios = generateScenarios(playerState, horizon, currentLap, totalLaps)

  // ── Evaluate all scenarios ──
  const runCtx: RunContext = {
    playerState,
    rivals,
    scenario: scenarios[0], // placeholder, overwritten per scenario
    trackProfile,
    weatherState,
    currentLap,
    totalLaps,
    horizon: Math.min(horizon, 30), // cap horizon for performance
    fuelBurnPerLap,
  }

  const outcomes: ScenarioOutcome[] = []
  // First evaluate STAY_OUT as baseline
  const stayOutSpec = scenarios.find(s => s.id === 'STAY_OUT')!
  const stayOutResult = evaluateScenario(stayOutSpec, null, { ...runCtx, scenario: stayOutSpec }, config)
  outcomes.push(stayOutResult)

  // Then evaluate others
  for (const sc of scenarios) {
    if (sc.id === 'STAY_OUT') continue
    const result = evaluateScenario(sc, stayOutResult.rawGains, { ...runCtx, scenario: sc }, config)
    outcomes.push(result)
  }

  // ── Rank by risk-adjusted score ──
  const scored = outcomes.map(o => ({
    outcome: o,
    score: riskAdjustedScore(o.rawGains, config.riskAversionFactor),
  }))
  scored.sort((a, b) => b.score - a.score)

  const recommended = scored[0].outcome
  const alternatives = scored.slice(1).map(s => s.outcome)

  // ── Separation score ──
  const sepScore = scored.length >= 2
    ? Math.abs(scored[0].score - scored[1].score)
    : 10

  // ── Confidence ──
  const confidenceScore = Math.min(100, Math.round(
    recommended.outcomeStability * 40 +
    Math.min(30, sepScore * 10) +
    (recommended.runs / config.maxRuns) * 20 +
    (1 - recommended.scDependency) * 10
  ))

  // ── Build decision factors ──
  const factors = buildDecisionFactors(recommended, alternatives, playerState, trackProfile)

  // ── Build execution checklist ──
  const checklist = buildExecutionChecklist(
    recommended,
    scenarios.find(s => s.id === recommended.scenarioId)!,
    playerState,
    trackProfile,
    currentLap,
  )

  // ── Build rationale ──
  const rationale = buildDecisionRationale(recommended, alternatives, factors)

  const totalRuns = outcomes.reduce((s, o) => s + o.runs, 0)
  const computeTimeMs = Math.round(performance.now() - overallStart)

  const result: UnifiedStrategyDecision = {
    recommended,
    alternatives,
    allScenarios: outcomes,
    confidenceScore,
    separationScore: sepScore,
    riskAdjustedScore: scored[0].score,
    decisionFactors: factors,
    decisionRationale: rationale,
    executionChecklist: checklist,
    totalRuns,
    computeTimeMs,
    cacheHit: false,
    timestamp: Date.now(),
  }

  // ── Cache result ──
  _cache = { key: cacheKey, result, timestamp: Date.now() }

  return result
}
