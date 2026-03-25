import { clamp, num } from './utils.js'

const TRACK_PIT_LOSS = {
  TRACK_0: 20.8,
  TRACK_1: 22.4,
  TRACK_2: 24.1,
  TRACK_5: 23.2,
  TRACK_10: 18.9,
  TRACK_13: 19.4,
  TRACK_14: 22.2,
  TRACK_16: 25.3,
}

function pitLoss(trackId) {
  return TRACK_PIT_LOSS[trackId] || 22.5
}

function ersDelta(ersMode) {
  if (ersMode === 'PUSH') return 0.18
  if (ersMode === 'HARVEST') return -0.22
  return -0.03
}

function fuelBurnDelta(fuelMode) {
  return fuelMode === 'SAVE' ? -0.16 : 0.0
}

export class PitStrategySimulator {
  constructor({ tyreModel, trafficAnalyzer }) {
    this.tyreModel = tyreModel
    this.trafficAnalyzer = trafficAnalyzer
    this.cache = new Map()
  }

  _cacheKey(action, context, horizonLaps) {
    return [
      action.id,
      num(context.lap, 0),
      num(context.tyreWear, 0).toFixed(3),
      num(context.fuel, 0).toFixed(2),
      num(context.ers, 0).toFixed(0),
      num(context.gapAhead, 0).toFixed(3),
      num(context.gapBehind, 0).toFixed(3),
      num(context.trafficDensity, 0).toFixed(3),
      horizonLaps,
    ].join('|')
  }

  simulate(action, context, horizonLaps = 8) {
    const key = this._cacheKey(action, context, horizonLaps)
    const hit = this.cache.get(key)
    if (hit) return hit

    const laps = Math.max(3, Math.min(10, horizonLaps))
    const scProb = clamp(num(context.scProbability, 0.05), 0, 0.8)
    const vscProb = clamp(num(context.vscProbability, 0.08), 0, 0.8)

    const effectivePitLoss = pitLoss(context.trackId) - scProb * 7.5 - vscProb * 4.2

    const pitAt = action.type === 'PIT' ? Math.max(0, action.pitDelayLaps) : -1
    const postPitCompound = action.compound === 'KEEP' ? (context.currentCompound || 'MEDIUM') : action.compound

    let wear = clamp(num(context.tyreWear, 0.25), 0, 1)
    let fuel = Math.max(0, num(context.fuel, 0))
    let ers = Math.max(0, num(context.ers, 0))

    const details = []
    let totalTime = 0
    let pitCost = 0
    let warmupPenaltyTotal = 0

    const traffic = this.trafficAnalyzer.analyze(context)

    for (let lapOffset = 0; lapOffset < laps; lapOffset += 1) {
      const didPit = pitAt === lapOffset
      const onNewTyre = didPit || (pitAt >= 0 && lapOffset > pitAt)

      if (didPit) {
        totalTime += effectivePitLoss
        pitCost += effectivePitLoss
        wear = 0.04
      }

      const tyreProjection = this.tyreModel.project({
        compound: onNewTyre ? postPitCompound : (context.currentCompound || 'MEDIUM'),
        laps: 1,
        currentWear: wear,
        tyreTemp: num(context.tyreTemp, 92),
        baseLapTime: num(context.baseLapTime, 90),
        trackId: context.trackId,
      })

      const tyreLap = tyreProjection.curve[0]
      const warmupPenalty = onNewTyre && lapOffset - pitAt <= 1 ? 0.55 - 0.22 * (lapOffset - pitAt) : 0

      const trafficPenalty = traffic.joinProbability > 0.58 && onNewTyre ? 0.42 + traffic.clusterDensity * 0.85 : 0.18 * traffic.trafficDensity
      const ersPenalty = action.ersMode === 'PUSH' ? -0.22 : action.ersMode === 'HARVEST' ? 0.18 : 0.03
      const fuelPenalty = action.fuelMode === 'SAVE' ? 0.07 : -0.01

      const lapTime = tyreLap.lapTime + warmupPenalty + trafficPenalty + ersPenalty + fuelPenalty
      totalTime += lapTime
      warmupPenaltyTotal += warmupPenalty

      details.push({
        lapOffset,
        lapTime,
        tyreWear: wear,
        warmupPenalty,
        trafficPenalty,
      })

      wear = tyreProjection.finalWear
      fuel = Math.max(0, fuel - (num(context.fuelBurnPerLap, 1.65) + fuelBurnDelta(action.fuelMode)))
      ers = Math.max(0, ers + ersDelta(action.ersMode) * num(context.maxErs, 4_000_000))
    }

    // Undercut / overcut heuristic against stay baseline proxy.
    const undercutGain = pitAt === 0 ? clamp(0.9 - pitCost / 30 + (1 - traffic.joinProbability) * 0.4, -2, 2) : 0
    const overcutGain = pitAt > 0 ? clamp(0.55 - wear * 1.4 + traffic.joinProbability * 0.25, -2, 2) : 0

    const expectedPositionGain = clamp(
      undercutGain * 0.6 + overcutGain * 0.45 + (action.ersMode === 'PUSH' ? 0.25 : 0) - traffic.trafficDensity * 0.8,
      -4,
      4,
    )

    const risk = clamp(
      wear * 0.45 + traffic.joinProbability * 0.25 + (action.fuelMode === 'SAVE' ? -0.06 : 0.04),
      0,
      1,
    )

    const result = {
      actionId: action.id,
      horizonLaps: laps,
      totalTime,
      expectedPositionGain,
      undercutGain,
      overcutGain,
      pitCost,
      warmupPenaltyTotal,
      trafficJoinProbability: traffic.joinProbability,
      clusterDensity: traffic.clusterDensity,
      risk,
      details,
    }

    this.cache.set(key, result)
    if (this.cache.size > 512) {
      const first = this.cache.keys().next().value
      this.cache.delete(first)
    }

    return result
  }
}
