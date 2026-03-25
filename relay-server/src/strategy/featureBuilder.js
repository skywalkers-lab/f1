import { clamp, num } from './utils.js'

export class FeatureBuilder {
  constructor() {
    this.prevByStream = new Map()
    this.featureNames = [
      'bias',
      'lapNorm',
      'positionNorm',
      'fuelNorm',
      'ersNorm',
      'tyreWearNorm',
      'trafficNorm',
      'gapAheadNorm',
      'gapBehindNorm',
      'pitWindowOpen',
      'scProbability',
      'vscProbability',
      'gapAheadDelta',
      'gapBehindDelta',
      'tyreWearRate',
      'lapTimeTrend',
      'sector1Trend',
      'sector2Trend',
      'sector3Trend',
      'fuelBurnRateNorm',
      'ersDeltaNorm',
      'degradationSlope',
    ]
  }

  _dynamicScale(context) {
    const totalLaps = Math.max(1, num(context.totalLaps, 58))
    const fuelBurnPerLap = Math.max(0.01, num(context.fuelBurnPerLap, 1.6))
    const lapsRemaining = Math.max(0, num(context.lapsRemaining, totalLaps - num(context.lap, 1)))
    const maxFuel = Math.max(num(context.maxFuel, 0), num(context.fuel, 0) + fuelBurnPerLap * lapsRemaining)
    const maxErs = Math.max(1_000_000, num(context.maxErs, 4_000_000))
    return { totalLaps, maxFuel, maxErs }
  }

  _streamKey(context) {
    return String(context.streamKey || context.sessionUid || 'default')
  }

  _delta(now, prev, lapStep = 1) {
    return (num(now, 0) - num(prev, 0)) / Math.max(1, lapStep)
  }

  build(context = {}) {
    const key = this._streamKey(context)
    const prev = this.prevByStream.get(key)

    const scale = this._dynamicScale(context)

    const lap = Math.max(1, num(context.lap, 1))
    const lapStep = prev ? Math.max(1, lap - num(prev.lap, lap - 1)) : 1

    const lapNorm = clamp(lap / scale.totalLaps, 0, 1)
    const positionNorm = clamp(num(context.playerPosition, 22) / 22, 0, 1)
    const fuelNorm = clamp(num(context.fuel, 0) / scale.maxFuel, 0, 1)
    const ersNorm = clamp(num(context.ers, 0) / scale.maxErs, 0, 1)
    const tyreWearNorm = clamp(num(context.tyreWear, 0), 0, 1)
    const trafficNorm = clamp(num(context.trafficDensity, 0), 0, 1)
    const gapAheadNorm = clamp(num(context.gapAhead, 5) / 10, 0, 1)
    const gapBehindNorm = clamp(num(context.gapBehind, 5) / 10, 0, 1)

    const pitWindowOpen = context.pitWindowOpen ? 1 : 0
    const scProbability = clamp(num(context.scProbability, 0.05), 0, 1)
    const vscProbability = clamp(num(context.vscProbability, 0.08), 0, 1)

    const gapAheadDelta = clamp(this._delta(context.gapAhead, prev?.gapAhead, lapStep) / 3, -1, 1)
    const gapBehindDelta = clamp(this._delta(context.gapBehind, prev?.gapBehind, lapStep) / 3, -1, 1)
    const tyreWearRate = clamp(this._delta(context.tyreWear, prev?.tyreWear, lapStep), -1, 1)

    const lapTimeTrend = clamp(this._delta(context.lastLapTime, prev?.lastLapTime, lapStep) / 3.5, -1, 1)
    const sector1Trend = clamp(this._delta(context.sector1Time, prev?.sector1Time, lapStep) / 2.2, -1, 1)
    const sector2Trend = clamp(this._delta(context.sector2Time, prev?.sector2Time, lapStep) / 2.2, -1, 1)
    const sector3Trend = clamp(this._delta(context.sector3Time, prev?.sector3Time, lapStep) / 2.2, -1, 1)

    const fuelBurnRateNorm = clamp(num(context.fuelBurnPerLap, 1.6) / Math.max(0.5, scale.maxFuel / scale.totalLaps), 0, 2)
    const ersDeltaNorm = clamp(this._delta(context.ers, prev?.ers, lapStep) / scale.maxErs, -1, 1)

    const degradationSlope = clamp(
      num(context.degradationSlope, num(context.tyreTemp, 90) > 105 ? 0.06 : 0.03),
      0,
      0.25,
    )

    const vector = [
      1,
      lapNorm,
      positionNorm,
      fuelNorm,
      ersNorm,
      tyreWearNorm,
      trafficNorm,
      gapAheadNorm,
      gapBehindNorm,
      pitWindowOpen,
      scProbability,
      vscProbability,
      gapAheadDelta,
      gapBehindDelta,
      tyreWearRate,
      lapTimeTrend,
      sector1Trend,
      sector2Trend,
      sector3Trend,
      fuelBurnRateNorm,
      ersDeltaNorm,
      degradationSlope,
    ]

    const outContext = {
      ...context,
      lap,
      totalLaps: scale.totalLaps,
      maxFuel: scale.maxFuel,
      maxErs: scale.maxErs,
      lapsRemaining: Math.max(0, scale.totalLaps - lap),
      temporal: {
        gapAheadDelta,
        gapBehindDelta,
        tyreWearRate,
        lapTimeTrend,
        sector1Trend,
        sector2Trend,
        sector3Trend,
        ersDeltaNorm,
      },
    }

    this.prevByStream.set(key, {
      lap,
      gapAhead: num(context.gapAhead, 0),
      gapBehind: num(context.gapBehind, 0),
      tyreWear: num(context.tyreWear, 0),
      lastLapTime: num(context.lastLapTime, 0),
      sector1Time: num(context.sector1Time, 0),
      sector2Time: num(context.sector2Time, 0),
      sector3Time: num(context.sector3Time, 0),
      ers: num(context.ers, 0),
    })

    return { featureNames: this.featureNames, vector, context: outContext }
  }
}
