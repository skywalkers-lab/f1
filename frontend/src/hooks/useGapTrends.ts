import { useMemo, useRef } from 'react'
import { classifyGapTrend, GapTrend, GapTrendSeriesMap, pushGapSample } from '../lib/leaderboardTrend'

type GapSample = {
  carIndex: number
  gapS: number
}

const MAX_POINTS = 18

export function useGapTrends(samples: GapSample[]): Map<number, GapTrend> {
  const historyRef = useRef<GapTrendSeriesMap>(new Map())

  return useMemo(() => {
    const seen = new Set<number>()

    samples.forEach((sample) => {
      seen.add(sample.carIndex)
      pushGapSample(historyRef.current, sample.carIndex, sample.gapS, MAX_POINTS)
    })

    const trendMap = new Map<number, GapTrend>()
    historyRef.current.forEach((series, carIndex) => {
      if (!seen.has(carIndex)) return
      trendMap.set(carIndex, classifyGapTrend(series))
    })

    // Prune history for cars not present in the current viewport.
    Array.from(historyRef.current.keys()).forEach((carIndex) => {
      if (!seen.has(carIndex)) {
        historyRef.current.delete(carIndex)
      }
    })

    return trendMap
  }, [samples])
}
