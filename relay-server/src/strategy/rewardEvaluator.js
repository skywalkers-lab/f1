import { clamp, num } from './utils.js'

export class RewardEvaluator {
  constructor({ gamma = 0.92, rolloutWeight = 0.62 }) {
    this.gamma = gamma
    this.rolloutWeight = rolloutWeight
  }

  normalizeReward(value) {
    return clamp(value, -1, 1)
  }

  evaluate(simResult, baselineResult) {
    const timeGainSec = num(baselineResult?.totalTime, simResult.totalTime) - simResult.totalTime
    const positionGain = num(simResult.expectedPositionGain, 0)
    const tyrePreservation = clamp((num(simResult.undercutGain, 0) + 0.45 * num(simResult.overcutGain, 0)) / 3, -1, 1)
    const riskPenalty = num(simResult.risk, 0)

    const composite =
      clamp(timeGainSec / 8, -1, 1) * 0.42 +
      clamp(positionGain / 3, -1, 1) * 0.3 +
      tyrePreservation * 0.18 -
      riskPenalty * 0.22

    const rolloutReturns = simResult.details.map((lap, idx) => {
      const lapGain = clamp((num(baselineResult?.details?.[idx]?.lapTime, lap.lapTime) - lap.lapTime) / 3, -1, 1)
      const lapRisk = clamp(lap.trafficPenalty / 2, 0, 1)
      return lapGain - lapRisk * 0.18
    })

    let nStep = 0
    for (let i = 0; i < rolloutReturns.length; i += 1) {
      nStep += Math.pow(this.gamma, i) * rolloutReturns[i]
    }

    const blended = (1 - this.rolloutWeight) * composite + this.rolloutWeight * clamp(nStep / 3.5, -1, 1)

    return {
      reward: this.normalizeReward(blended),
      components: {
        timeGainSec,
        positionGain,
        tyrePreservation,
        riskPenalty,
        nStep,
        composite,
      },
    }
  }
}
