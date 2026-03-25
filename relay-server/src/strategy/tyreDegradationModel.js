import { clamp, num } from './utils.js'

const TRACK_COEFF = {
  TRACK_0: 1.08,
  TRACK_1: 1.02,
  TRACK_2: 1.15,
  TRACK_5: 1.1,
  TRACK_10: 0.97,
  TRACK_13: 0.95,
  TRACK_14: 1.12,
  TRACK_16: 1.18,
}

const COMPOUND_BASE = {
  SOFT: { baseGrip: -0.65, wearGain: 0.041, nonlinear: 0.24 },
  MEDIUM: { baseGrip: -0.3, wearGain: 0.031, nonlinear: 0.18 },
  HARD: { baseGrip: 0, wearGain: 0.024, nonlinear: 0.14 },
}

export class TyreDegradationModel {
  project({
    compound = 'MEDIUM',
    laps = 6,
    currentWear = 0.28,
    tyreTemp = 92,
    baseLapTime = 90,
    trackId = 'TRACK_UNKNOWN',
    scActive = false,
  }) {
    const c = COMPOUND_BASE[compound] || COMPOUND_BASE.MEDIUM
    const trackCoeff = TRACK_COEFF[trackId] || 1
    const result = []

    let wear = clamp(currentWear, 0, 1)

    for (let i = 0; i < laps; i += 1) {
      const ageRatio = clamp(wear, 0, 1)

      // Nonlinear wear: 초기 완만 -> 중후반 급격
      const nonlinearDrop = c.nonlinear * Math.pow(ageRatio, 2.15)

      // Temp penalty accelerates overheat zones.
      const tempPenalty = Math.max(0, (num(tyreTemp, 92) - 98) * 0.0105)

      const lapPenalty = (c.wearGain * (1 + ageRatio * 1.25) + nonlinearDrop + tempPenalty) * trackCoeff
      const scMul = scActive ? 0.64 : 1

      const lapTime = baseLapTime + c.baseGrip + lapPenalty * 8.5 * scMul

      result.push({
        lapOffset: i,
        wear,
        lapTime,
      })

      const wearGrowth = (c.wearGain * (1 + ageRatio * 1.75) + tempPenalty * 0.45) * (scActive ? 0.7 : 1)
      wear = clamp(wear + wearGrowth, 0, 1)
    }

    return {
      curve: result,
      finalWear: wear,
      avgLapTime: result.reduce((a, b) => a + b.lapTime, 0) / Math.max(1, result.length),
    }
  }
}
