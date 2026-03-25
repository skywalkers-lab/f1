import { TyreWearPoint } from './tyreHistoryManager'

export type WearPrediction = {
  carIndex: number
  slopePerLap: number
  cliffLap: number
  confidence: number
}

function regression(points: TyreWearPoint[]): { slope: number; intercept: number } | null {
  if (points.length < 2) return null
  const n = points.length
  let sumX = 0
  let sumY = 0
  let sumXY = 0
  let sumXX = 0
  for (const p of points) {
    sumX += p.lap
    sumY += p.wear
    sumXY += p.lap * p.wear
    sumXX += p.lap * p.lap
  }
  const denom = n * sumXX - sumX * sumX
  if (Math.abs(denom) < 1e-6) return null
  const slope = (n * sumXY - sumX * sumY) / denom
  const intercept = (sumY - slope * sumX) / n
  return { slope, intercept }
}

export function predictCliffLap(carIndex: number, history: TyreWearPoint[], cliffThreshold = 0.78, lookback = 10): WearPrediction | null {
  if (!history || history.length < 3) return null
  const points = history.slice(-lookback)
  const model = regression(points)
  if (!model) return null
  const slope = Math.max(0, model.slope)
  if (slope < 0.0008) return null

  const latestLap = points[points.length - 1].lap
  const latestWear = points[points.length - 1].wear
  const remaining = Math.max(0, cliffThreshold - latestWear)
  const lapsToCliff = remaining / slope
  const cliffLap = latestLap + lapsToCliff
  const confidence = Math.max(0.15, Math.min(0.98, points.length / lookback))
  return {
    carIndex,
    slopePerLap: slope,
    cliffLap,
    confidence,
  }
}
