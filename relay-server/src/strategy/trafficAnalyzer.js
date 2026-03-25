import { clamp, num } from './utils.js'

export class TrafficAnalyzer {
  analyze(context = {}) {
    const around = Array.isArray(context.nearbyGaps)
      ? context.nearbyGaps.map((g) => num(g, 99)).filter((g) => Number.isFinite(g)).sort((a, b) => a - b)
      : []

    const threshold = clamp(num(context.clusterGapThreshold, 1.65), 1.1, 3)

    const clusters = []
    let current = []

    for (const gap of around) {
      if (current.length === 0) {
        current.push(gap)
        continue
      }
      if (Math.abs(gap - current[current.length - 1]) <= threshold) {
        current.push(gap)
      } else {
        clusters.push(current)
        current = [gap]
      }
    }
    if (current.length > 0) clusters.push(current)

    const nearestCluster = clusters.find((c) => c.length >= 2) || []
    const nearestGap = nearestCluster.length ? nearestCluster.reduce((a, b) => a + b, 0) / nearestCluster.length : 8

    const clusterDensity = clamp((nearestCluster.length || 0) / 6, 0, 1)
    const baseJoin = 1 - clamp(nearestGap / 10, 0, 1)
    const trafficDensity = clamp(
      num(context.trafficDensity, 0) * 0.55 + clusterDensity * 0.45,
      0,
      1,
    )

    const pitRejoinGap = num(context.predictedPitRejoinGap, nearestGap)
    const joinProbability = clamp(
      baseJoin * 0.55 + (1 - clamp(Math.abs(pitRejoinGap) / 7, 0, 1)) * 0.45,
      0,
      1,
    )

    return {
      clusters,
      nearestGap,
      clusterDensity,
      trafficDensity,
      joinProbability,
    }
  }
}
