export type GapTrendDirection = 'closing' | 'dropping' | 'stable'

export type GapTrend = {
  direction: GapTrendDirection
  delta: number
}

export type GapTrendSeriesMap = Map<number, number[]>

function movingAverage(values: number[], windowSize: number): number[] {
  if (values.length === 0) return []
  const out: number[] = []
  for (let i = 0; i < values.length; i += 1) {
    const start = Math.max(0, i - windowSize + 1)
    const slice = values.slice(start, i + 1)
    const sum = slice.reduce((acc, cur) => acc + cur, 0)
    out.push(sum / slice.length)
  }
  return out
}

export function pushGapSample(seriesMap: GapTrendSeriesMap, carIndex: number, gapS: number, maxPoints: number): void {
  const prev = seriesMap.get(carIndex) ?? []
  const next = [...prev, gapS]
  if (next.length > maxPoints) {
    next.splice(0, next.length - maxPoints)
  }
  seriesMap.set(carIndex, next)
}

export function classifyGapTrend(samples: number[], smoothingWindow = 3): GapTrend {
  if (samples.length < 4) {
    return { direction: 'stable', delta: 0 }
  }

  const smooth = movingAverage(samples, smoothingWindow)
  const headSize = Math.max(2, Math.floor(smooth.length / 2))
  const tailSize = Math.max(2, Math.floor(smooth.length / 2))

  const head = smooth.slice(0, headSize)
  const tail = smooth.slice(smooth.length - tailSize)

  const headAvg = head.reduce((acc, cur) => acc + cur, 0) / head.length
  const tailAvg = tail.reduce((acc, cur) => acc + cur, 0) / tail.length
  const delta = tailAvg - headAvg

  if (Math.abs(delta) < 0.05) {
    return { direction: 'stable', delta }
  }

  return {
    direction: delta < 0 ? 'closing' : 'dropping',
    delta,
  }
}
