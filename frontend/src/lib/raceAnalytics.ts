// #20 — Race-control timeline lane on minimap
// #21 — Sector micro-deltas with color persistence
// #29 — Race incident clustering and severity ranking
// #32 — ERS deployment archetype detection
// #33 — Driver battle risk score (overtake probability + tyre cost)
// #34 — Fastest sector ghost line overlay

import type { AppState } from '../lib/types'

// ═══════════════════════════════════════════════════════════════
// #20: Race-control timeline events
// ═══════════════════════════════════════════════════════════════

export type RaceControlEvent = {
  lap: number
  timestamp: number
  type: 'SC' | 'VSC' | 'RED_FLAG' | 'GREEN' | 'PENALTY' | 'INCIDENT'
  detail: string
}

const _raceControlLog: RaceControlEvent[] = []
let _lastRaceControlState = ''

export function updateRaceControlTimeline(state: AppState): RaceControlEvent[] {
  if (!state) return _raceControlLog
  const current = state.race_control_state
  if (current !== _lastRaceControlState && _lastRaceControlState) {
    _raceControlLog.push({
      lap: state.player.lap,
      timestamp: Date.now(),
      type: current === 'SC_OR_VSC' ? 'SC' : current === 'RED' ? 'RED_FLAG' : 'GREEN',
      detail: `${_lastRaceControlState} → ${current}`,
    })
    if (_raceControlLog.length > 100) _raceControlLog.shift()
  }
  _lastRaceControlState = current
  return _raceControlLog
}

export function getRaceControlTimeline(): RaceControlEvent[] {
  return _raceControlLog
}

// ═══════════════════════════════════════════════════════════════
// #21: Sector micro-deltas with color persistence
// ═══════════════════════════════════════════════════════════════

export type SectorDelta = {
  sector: 1 | 2 | 3
  deltaMs: number
  color: 'purple' | 'green' | 'yellow' | 'red'
  persistUntil: number
}

const COLOR_PERSIST_MS = 5000
let _bestSectors = [Infinity, Infinity, Infinity]
let _lastSectorDeltas: SectorDelta[] = []

export function computeSectorDeltas(
  currentSectors: Array<number | undefined>,
  personalBestSectors: Array<number | undefined>,
): SectorDelta[] {
  const now = Date.now()
  const deltas: SectorDelta[] = []

  for (let i = 0; i < 3; i++) {
    const cur = currentSectors[i]
    const pb = personalBestSectors[i]
    if (cur == null || cur <= 0) continue

    if (cur < _bestSectors[i]) {
      _bestSectors[i] = cur
    }

    let color: SectorDelta['color'] = 'yellow'
    let deltaMs = 0

    if (pb != null && pb > 0) {
      deltaMs = cur - pb
      if (cur <= _bestSectors[i]) color = 'purple'
      else if (deltaMs < 0) color = 'green'
      else if (deltaMs > 500) color = 'red'
      else color = 'yellow'
    }

    deltas.push({
      sector: (i + 1) as 1 | 2 | 3,
      deltaMs,
      color,
      persistUntil: now + COLOR_PERSIST_MS,
    })
  }

  _lastSectorDeltas = deltas
  return deltas
}

export function getPersistedSectorDeltas(): SectorDelta[] {
  const now = Date.now()
  return _lastSectorDeltas.filter(d => d.persistUntil > now)
}

// ═══════════════════════════════════════════════════════════════
// #29: Race incident clustering and severity ranking
// ═══════════════════════════════════════════════════════════════

export type Incident = {
  lap: number
  timestamp: number
  carIndices: number[]
  severity: 'minor' | 'moderate' | 'major'
  type: 'collision' | 'spin' | 'penalty' | 'mechanical'
}

export type IncidentCluster = {
  startLap: number
  endLap: number
  incidents: Incident[]
  hotSpotRatio?: number
  averageSeverity: number
}

const _incidents: Incident[] = []
let _prevPenalties: Map<number, number> = new Map()

export function detectIncidents(state: AppState): Incident[] {
  if (!state) return _incidents
  const currentPenalties = new Map<number, number>()

  for (const row of state.leaderboard) {
    const prevPen = _prevPenalties.get(row.car_index) ?? 0
    const curPen = (row as Record<string, unknown>).penalties as number ?? 0
    currentPenalties.set(row.car_index, curPen)

    if (curPen > prevPen) {
      _incidents.push({
        lap: state.player.lap,
        timestamp: Date.now(),
        carIndices: [row.car_index],
        severity: curPen - prevPen >= 10 ? 'major' : curPen - prevPen >= 5 ? 'moderate' : 'minor',
        type: 'penalty',
      })
    }
  }

  _prevPenalties = currentPenalties
  if (_incidents.length > 200) _incidents.splice(0, _incidents.length - 200)
  return _incidents
}

export function clusterIncidents(incidents: Incident[], lapWindow = 3): IncidentCluster[] {
  if (incidents.length === 0) return []

  const sorted = [...incidents].sort((a, b) => a.lap - b.lap)
  const clusters: IncidentCluster[] = []
  let current: Incident[] = [sorted[0]]

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].lap - sorted[i - 1].lap <= lapWindow) {
      current.push(sorted[i])
    } else {
      clusters.push(buildCluster(current))
      current = [sorted[i]]
    }
  }
  clusters.push(buildCluster(current))

  return clusters.sort((a, b) => b.averageSeverity - a.averageSeverity)
}

function buildCluster(incidents: Incident[]): IncidentCluster {
  const sevMap = { minor: 1, moderate: 2, major: 3 }
  const avgSev = incidents.reduce((s, i) => s + sevMap[i.severity], 0) / incidents.length
  return {
    startLap: incidents[0].lap,
    endLap: incidents[incidents.length - 1].lap,
    incidents,
    averageSeverity: Math.round(avgSev * 100) / 100,
  }
}

// ═══════════════════════════════════════════════════════════════
// #32: ERS deployment archetype detection
// ═══════════════════════════════════════════════════════════════

export type ErsArchetype = 'aggressive' | 'balanced' | 'conservative' | 'harvesting' | 'unknown'

const _ersHistory: Array<{ lap: number; ers: number; deltaPerLap: number }> = []

export function detectErsArchetype(state: AppState): ErsArchetype {
  if (!state) return 'unknown'

  const ers = state.player.ers ?? 0
  const lap = state.player.lap

  if (_ersHistory.length > 0) {
    const last = _ersHistory[_ersHistory.length - 1]
    if (lap !== last.lap) {
      const delta = ers - last.ers
      _ersHistory.push({ lap, ers, deltaPerLap: delta })
      if (_ersHistory.length > 20) _ersHistory.shift()
    }
  } else {
    _ersHistory.push({ lap, ers, deltaPerLap: 0 })
  }

  if (_ersHistory.length < 3) return 'unknown'

  const recentDeltas = _ersHistory.slice(-5).map(h => h.deltaPerLap)
  const avgDelta = recentDeltas.reduce((a, b) => a + b, 0) / recentDeltas.length

  if (avgDelta < -300000) return 'aggressive'
  if (avgDelta < -100000) return 'balanced'
  if (avgDelta > 100000) return 'harvesting'
  return 'conservative'
}

// ═══════════════════════════════════════════════════════════════
// #33: Driver battle risk score (overtake probability + tyre cost)
// ═══════════════════════════════════════════════════════════════

export type BattleRisk = {
  opponentIndex: number
  opponentCode: string
  gapMs: number
  overtakeProbability: number
  tyreCostFactor: number
  riskScore: number
  recommendation: 'ATTACK' | 'DEFEND' | 'HOLD'
}

export function computeBattleRisks(state: AppState): BattleRisk[] {
  if (!state) return []

  const playerPos = state.player.position
  const playerWear = (state.leaderboard.find(r => r.car_index === state.player_car_index)?.tyre_wear_pct ?? 30) / 100
  const battles: BattleRisk[] = []

  for (const row of state.leaderboard) {
    if (row.car_index === state.player_car_index) continue

    const posDiff = Math.abs(row.position - playerPos)
    if (posDiff > 2) continue

    const gapMs = Math.abs(row.gap_to_player_s * 1000)
    if (gapMs > 3000) continue

    const rivalWear = (row.tyre_wear_pct ?? 30) / 100
    const wearAdvantage = rivalWear - playerWear

    // Overtake probability based on gap and tyre delta
    let overProb = 0
    if (gapMs < 1000) overProb = 0.6 + wearAdvantage * 0.3
    else if (gapMs < 1500) overProb = 0.35 + wearAdvantage * 0.2
    else if (gapMs < 2500) overProb = 0.15 + wearAdvantage * 0.1
    else overProb = 0.05
    overProb = Math.max(0.01, Math.min(0.95, overProb))

    // Tyre cost: how much extra wear from battle
    const tyreCost = playerWear > 0.7 ? 0.8 : playerWear > 0.5 ? 0.5 : 0.2

    const riskScore = overProb * (1 - tyreCost)

    let recommendation: BattleRisk['recommendation'] = 'HOLD'
    if (row.position < playerPos) {
      recommendation = riskScore > 0.4 ? 'ATTACK' : 'HOLD'
    } else {
      recommendation = overProb > 0.5 ? 'DEFEND' : 'HOLD'
    }

    battles.push({
      opponentIndex: row.car_index,
      opponentCode: row.driver_code,
      gapMs,
      overtakeProbability: Math.round(overProb * 100) / 100,
      tyreCostFactor: Math.round(tyreCost * 100) / 100,
      riskScore: Math.round(riskScore * 100) / 100,
      recommendation,
    })
  }

  return battles.sort((a, b) => b.riskScore - a.riskScore)
}

// ═══════════════════════════════════════════════════════════════
// #34: Fastest sector ghost line overlay
// ═══════════════════════════════════════════════════════════════

export type SectorGhostEntry = {
  lap: number
  sector: 1 | 2 | 3
  timeMs: number
}

const _sectorGhosts: SectorGhostEntry[] = []
let _bestSectorTimes = [Infinity, Infinity, Infinity]

export function updateSectorGhost(lap: number, sector: 1 | 2 | 3, timeMs: number): void {
  _sectorGhosts.push({ lap, sector, timeMs })
  if (_sectorGhosts.length > 300) _sectorGhosts.shift()

  const idx = sector - 1
  if (timeMs < _bestSectorTimes[idx]) {
    _bestSectorTimes[idx] = timeMs
  }
}

export function getFastestSectorLap(): { sector1Lap: number | null; sector2Lap: number | null; sector3Lap: number | null } {
  const result: { sector1Lap: number | null; sector2Lap: number | null; sector3Lap: number | null } = {
    sector1Lap: null,
    sector2Lap: null,
    sector3Lap: null,
  }

  for (const entry of _sectorGhosts) {
    if (entry.sector === 1 && entry.timeMs === _bestSectorTimes[0]) result.sector1Lap = entry.lap
    if (entry.sector === 2 && entry.timeMs === _bestSectorTimes[1]) result.sector2Lap = entry.lap
    if (entry.sector === 3 && entry.timeMs === _bestSectorTimes[2]) result.sector3Lap = entry.lap
  }

  return result
}

export function getBestSectorTimes(): [number, number, number] {
  return [..._bestSectorTimes] as [number, number, number]
}
