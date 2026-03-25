/**
 * Core type definitions for the advanced strategy simulation engine.
 * All types follow immutability principles for functional purity.
 */

// ========== Enumerations ==========
export enum TyreCompound {
  SOFT = 'SOFT',
  MEDIUM = 'MEDIUM',
  HARD = 'HARD',
}

export enum DrivingMode {
  PUSH = 'PUSH',
  BALANCED = 'BALANCED',
  HARVEST = 'HARVEST',
  SAVE = 'SAVE',
}

export enum RaceScenario {
  NORMAL = 'NORMAL',
  VIRTUAL_SAFETY_CAR = 'VSC',
  SAFETY_CAR = 'SC',
}

// ========== RaceContext ==========
export interface RaceContext {
  // Current position
  currentLap: number
  position: number
  trackId: string

  // Vehicles
  drivers: DriverState[]
  playerIndex: number

  // Environment
  lapsRemaining: number
  weather: 'DRY' | 'RAIN' | 'MIXED'
  trackTemp: number
  raceTime: number
}

export interface DriverState {
  driverId: number
  position: number
  tyreLaps: number
  currentCompound: TyreCompound
  tyreWear: number
  tyreTemp: number
  fuelRemaining: number
  ersLevel: number
  baseLapTime: number
  gapToLeader: number
  gapToAhead: number
  gapToBehind: number
  lastLapTime: number
}

// ========== Lap-related Types ==========
export interface LapState {
  lapNumber: number
  compound: TyreCompound
  tyreWear: number
  tyreTemp: number
  fuel: number
  ersLevel: number
  fuelBurnRate: number
  fuelMode: DrivingMode
  ersMode: DrivingMode
  baseLapTime: number
}

export interface LapResult {
  lapNumber: number
  lapTime: number
  components: {
    baseline: number
    tyreWear: number
    tyreDegradation: number
    fuelPenalty: number
    ersPenalty: number
    trafficLoss: number
    warmupPenalty: number
    noiseDeviation: number
  }
  updatedState: LapState
  events: LapEvent[]
}

export interface LapEvent {
  type: 'TYRE_GRAINING' | 'TYRE_BLISTERING' | 'DRS_ENABLED' | 'DRS_DISABLED' | 'OVERTAKE' | 'OVERTAKEN'
  probability?: number
  impact?: number
}

// ========== Strategy-related Types ==========
export interface StrategyAction {
  id: string
  type: 'PIT' | 'STAY'
  targetLap: number
  targetCompound: TyreCompound
  fuelMode: DrivingMode
  ersMode: DrivingMode
}

export interface StrategyContext {
  action: StrategyAction
  raceContext: RaceContext
  horizonLaps: number
  scenarioWeights: {
    normal: number
    vsc: number
    sc: number
  }
}

// ========== Simulation Results ==========
export interface SimulationResult {
  totalTime: number
  expectedPositionChange: number
  finalPosition: number
  riskProfile: RiskProfile
  monteCarloStats: MonteCarloStats
  lapDetails: LapDetail[]
  scenarioResults: ScenarioResult[]
  metadata: SimulationMetadata
}

export interface RiskProfile {
  tyrePunctureRisk: number
  trafficAccidentRisk: number
  ersDepletionRisk: number
  fuelShortageRisk: number
  overallRisk: number
  riskBreakdown: Record<string, number>
}

export interface MonteCarloStats {
  runs: number
  mean: number
  variance: number
  stdDev: number
  min: number
  max: number
  percentile50: number
  percentile95: number
}

export interface LapDetail {
  lapNumber: number
  lapTime: number
  tyreWear: number
  fuel: number
  ersLevel: number
  position: number
  trafficState: TrafficState
  isPitLap: boolean
}

export interface ScenarioResult {
  scenario: RaceScenario
  probability: number
  totalTime: number
  finalPosition: number
  riskProfile: RiskProfile
}

export interface SimulationMetadata {
  actionId: string
  horizonLaps: number
  cacheHit: boolean
  computeTimeMs: number
  monteCarloRuns: number
}

// ========== Traffic-related Types ==========
export interface TrafficState {
  gapAhead: number
  gapBehind: number
  dirtyAirPenalty: number
  drsEnabled: boolean
  drsActivated: boolean
  drsTrain: boolean
  overtakeProbability: number
  overtakeSuccess: boolean
}

export interface OpponentPrediction {
  driverId: number
  predictedNextPitLap: number | null
  predictedCompound: TyreCompound | null
  tyreDegradationRate: number
  fuelConsumptionRate: number
  expectedLapTime: number
  undercutRisk: number
  overcutRisk: number
}

// ========== Pit Stop Types ==========
export interface PitStopScenario {
  type: RaceScenario
  lapTime: number
  pitInLapTime: number
  pitStopDuration: number
  pitOutLapTime: number
  fastRedeployLapTime: number
  isPitReliable: boolean
}

// ========== Physics Model Types ==========
export interface TyrePhysicsSnapshot {
  compound: TyreCompound
  wear: number
  temp: number
  graining: number
  blistering: number
}

export interface AerodynamicsSnapshot {
  dirtyAirFactor: number
  drsGain: number
  trackBalance: number
}

// ========== Configuration Types ==========
export interface SimulationConfig {
  physics: PhysicsConfig
  models: ModelsConfig
  monte: MonteCarloConfig
  cache: CacheConfig
  tuning: TuningConfig
}

export interface PhysicsConfig {
  tracks: Record<string, TrackPhysics>
  compounds: Record<TyreCompound, CompoundPhysics>
  aerodynamics: AerodynamicsConfig
  fuel: FuelConfig
  ers: ERSConfig
}

export interface TrackPhysics {
  id: string
  name: string
  baseLapTime: number
  pitLossMean: number
  pitLossStdDev: number
  dirtyAirFactor: number
  drsGain: number
  lengthKm: number
}

export interface CompoundPhysics {
  wearRate: number
  degradationCurve: {
    phase1: { wearThreshold: number; factor: number }
    phase2: { wearThreshold: number; factor: number }
    phase3: { factor: number }
  }
  grainingSusceptibility: number
  blisteringSusceptibility: number
  warmupLaps: number
}

export interface AerodynamicsConfig {
  drsOptimalSpeed: number
  dirtyAirStartGap: number
  dirtyAirMaxPenalty: number
}

export interface FuelConfig {
  baseBurnPerLap: number
  loadFactor: number
  saveModeReduction: number
  tyreDegradationMultiplier: number
}

export interface ERSConfig {
  maxCapacity: number
  chargeRatePerLap: number
  pushModeDrain: number
  harvestModeRecharge: number
  harvestModeGain: number
  pushModeGain: number
}

export interface ModelsConfig {
  noiseStdDev: number
  trafficDensityFactor: number
  scProbability: number
  vscProbability: number
}

export interface MonteCarloConfig {
  minRuns: number
  maxRuns: number
  adaptiveThreshold: number
  randomSeed?: number
}

export interface CacheConfig {
  maxSize: number
  ttlMs: number
  enabled: boolean
}

export interface TuningConfig {
  [key: string]: number
}

// ========== Enhanced Multi-Layer Architecture Types ==========

/**
 * Layer 1: Deterministic Simulation (existing logic)
 * Layer 2: Probabilistic Prediction (Monte Carlo with distributions)
 * Layer 3: Race Event Anticipation (SC/VSC/weather prediction)
 * Layer 4: Decision Scoring & Confidence Modeling
 */

// ── Distribution Output (replaces all scalar outputs) ──
export interface DistributionMetrics {
  mean: number
  median: number
  p10: number
  p90: number
  bestCase: number
  worstCase: number
  stddev: number
}

// ── Race Evolution Model ──
export interface RaceEvolutionState {
  /** Per-lap SC probability (dynamic) */
  scProbabilityPerLap: number
  /** Per-lap VSC probability (dynamic) */
  vscProbabilityPerLap: number
  /** Pit window compression during neutralized race */
  pitWindowCompression: number
  /** Dynamic pit loss based on race control state */
  effectivePitLoss: number
  /** Track evolution factor (rubber-in) */
  trackEvolutionDelta: number
  /** Fuel-corrected lap time improvement per lap */
  fuelCorrectionPerLap: number
  /** Race phase: 'early' | 'mid' | 'late' */
  racePhase: 'early' | 'mid' | 'late'
  /** Historical incident density at current lap range */
  incidentDensity: number
  /** Current traffic cluster compression */
  clusterCompression: number
}

// ── Enhanced Tyre Model (3-phase compound-specific) ──
export interface TyreDegradationPhase {
  /** Phase name for logging */
  name: 'thermal' | 'stable' | 'cliff'
  /** Lap range for this phase */
  startLap: number
  endLap: number
  /** Degradation characteristics */
  basePenaltyPerLap: number
  exponent: number
}

export interface CompoundDegradationProfile {
  compound: TyreCompound
  /** Thermal phase: early-lap warmup penalty decay */
  thermalPhase: {
    durationLaps: number
    initialPenaltyMs: number
    decayRate: number
  }
  /** Stable phase: linear degradation */
  stablePhase: {
    penaltyPerLapMs: number
    wearRatePerLap: number
  }
  /** Cliff phase: exponential performance drop */
  cliffPhase: {
    wearThreshold: number
    exponent: number
    baseMultiplier: number
  }
  /** Track evolution reduces degradation slightly */
  trackEvolutionSensitivity: number
  /** Fuel load effect on degradation */
  fuelLoadSensitivity: number
  /** Dirty air penalty on tyre wear */
  dirtyAirWearMultiplier: number
}

// ── Spatial-Temporal Traffic Model ──
export interface SpatialTrafficState {
  /** DRS train detection: consecutive cars within DRS range */
  drsTrainLength: number
  /** Is player part of a DRS train */
  inDrsTrain: boolean
  /** Sector-by-sector overtaking difficulty */
  sectorOvertakeDifficulty: number[]
  /** Rejoin position relative to clusters, not just individual cars */
  clusterPosition: number
  /** Multi-lap traffic time loss accumulation */
  cumulativeTrafficLoss: number
  /** Clean air score: 0-100 */
  cleanAirScore: number
  /** Expected laps stuck in traffic */
  expectedTrafficLaps: number
}

// ── Rival Strategy Tree ──
export interface RivalStrategyPath {
  id: string
  label: string
  probability: number
  pitLap: number | null
  targetCompound: TyreCompound
  secondPitLap?: number | null
  secondCompound?: TyreCompound
}

export interface RivalStrategyTree {
  driverId: number
  driverCode: string
  position: number
  paths: RivalStrategyPath[]
  /** Most likely strategy */
  primaryPath: RivalStrategyPath
  /** Expected pit window (lap range) */
  expectedPitWindow: [number, number]
}

// ── Multi-Objective Decision Scoring ──
export interface DecisionObjectives {
  /** Time gain/loss (primary, weight varies by phase) */
  timeGain: number
  /** Position gain/loss */
  positionGain: number
  /** Risk: variance of outcomes */
  riskExposure: number
  /** Traffic exposure score */
  trafficExposure: number
  /** Tyre longevity remaining after strategy */
  tyreLongevity: number
  /** Strategic flexibility: future optionality */
  strategicFlexibility: number
}

export interface DecisionWeights {
  timeGain: number
  positionGain: number
  riskExposure: number
  trafficExposure: number
  tyreLongevity: number
  strategicFlexibility: number
}

// ── Decision Inertia ──
export interface DecisionInertiaState {
  /** Previously recommended strategy ID */
  previousRecommendation: string | null
  /** Timestamp of last recommendation change */
  lastChangeTimestamp: number
  /** Number of consecutive laps with same recommendation */
  consecutiveLaps: number
  /** Minimum improvement threshold to switch (dynamic) */
  switchThreshold: number
}

// ── Strategy Execution Plan ──
export interface StrategyExecutionPlan {
  /** Lap-by-lap intent */
  lapIntents: LapIntent[]
  /** Critical triggers */
  triggers: StrategyTrigger[]
  /** Tyre management targets */
  tyreTargets: TyreManagementTarget[]
  /** SC/VSC contingency actions */
  contingencies: ContingencyAction[]
}

export interface LapIntent {
  lap: number
  intent: 'push' | 'manage' | 'box_window' | 'defend' | 'attack'
  targetDelta: number | null
  notes: string
}

export interface StrategyTrigger {
  id: string
  condition: string
  action: string
  priority: 'critical' | 'high' | 'medium'
  /** Human-readable description */
  engineerNote: string
}

export interface TyreManagementTarget {
  lapRange: [number, number]
  targetWearRate: number
  maxAcceptableWear: number
  compound: TyreCompound
}

export interface ContingencyAction {
  event: 'SC' | 'VSC' | 'RED_FLAG' | 'RAIN' | 'RIVAL_PIT'
  action: string
  conditions: string
  priority: 'critical' | 'high' | 'medium'
}

// ── Enhanced Simulation Result (backward compatible) ──
export interface EnhancedSimulationResult extends SimulationResult {
  /** Distribution metrics replacing single scalars */
  distributions: {
    totalTime: DistributionMetrics
    positionChange: DistributionMetrics
    finalPosition: DistributionMetrics
  }
  /** Probabilistic confidence (not static heuristic) */
  probabilisticConfidence: number
  /** Scenario variance indicators */
  scenarioVariance: {
    normalVsNeutralized: number
    bestVsWorst: number
    crossScenarioStability: number
  }
  /** Race engineer language notes */
  engineerNotes: string[]
  /** Race evolution state at evaluation time */
  raceEvolution: RaceEvolutionState
  /** Traffic analysis */
  trafficAnalysis: SpatialTrafficState
  /** Rival strategy trees */
  rivalStrategies: RivalStrategyTree[]
  /** Decision objectives breakdown */
  objectives: DecisionObjectives
  /** Execution plan */
  executionPlan: StrategyExecutionPlan
  /** Decision inertia state */
  inertia: DecisionInertiaState
}

// ── Enhanced Strategy Engine Output (full pipeline output) ──
export interface StrategyEngineOutput {
  /** The recommended strategy (highest ranked) */
  recommended: EnhancedSimulationResult
  /** All evaluated alternatives with full distributions */
  alternatives: EnhancedSimulationResult[]
  /** Global confidence score (0-100) */
  confidence: number
  /** Separation between #1 and #2 */
  separation: number
  /** Race evolution model state */
  raceEvolution: RaceEvolutionState
  /** Decision inertia state */
  inertia: DecisionInertiaState
  /** Human-readable summary in race engineer language */
  engineerBriefing: string
  /** Total compute time */
  computeTimeMs: number
  /** Total Monte Carlo runs across all scenarios */
  totalRuns: number
  /** Whether result was from cache */
  cacheHit: boolean
  /** Timestamp */
  timestamp: number
}
