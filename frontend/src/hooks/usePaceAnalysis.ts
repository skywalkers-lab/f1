import { useMemo } from 'react'
import { AppState } from '../lib/types'

type PaceTrendDirection = 'improving' | 'worsening' | 'stable'
type PaceBand = 'very-stable' | 'stable' | 'unstable' | 'critical'
type ConsistencyBand = 'elite' | 'strong' | 'watch' | 'poor'

type PaceTrend = {
  direction: PaceTrendDirection
  slopeMsPerLap: number
  deltaMs: number
  label: string
}

type SpreadInterpretation = {
  spreadMs: number
  band: PaceBand
  label: string
  tone: 'ok' | 'watch' | 'critical'
}

type ConsistencyInterpretation = {
  value: number
  band: ConsistencyBand
  label: string
  tone: 'ok' | 'watch' | 'critical'
  meterPct: number
}

type PaceRow = {
  lap: number
  lapTimeMs: number
  lapTimeText: string
  deltaToRollingAvgMs: number | null
  deltaToRollingAvgText: string
  deltaTone: 'positive' | 'negative' | 'neutral'
  changeFromPreviousMs: number | null
  changeSymbol: 'UP' | 'DOWN' | 'FLAT' | '-'
  isBestRecent: boolean
  isOutlier: boolean
}

export type PaceAnalysisViewModel = {
  isReady: boolean
  bestLapText: string
  avgLapText: string
  currentLap: {
    lap: number
    text: string
    statusText: string
    isLive: boolean
  }
  bestRecent: {
    lap: number | null
    lapTimeText: string
  }
  rollingWindow: number
  rollingAverageMs: number | null
  rollingAverageText: string
  trend: PaceTrend
  spread: SpreadInterpretation
  consistency: ConsistencyInterpretation
  outlierCount: number
  pitSignal: {
    shouldPitSoon: boolean
    label: string
    reason: string
  }
  rows: PaceRow[]
}

const DEFAULT_VM: PaceAnalysisViewModel = {
  isReady: false,
  bestLapText: '-',
  avgLapText: '-',
  currentLap: {
    lap: 0,
    text: '-',
    statusText: '라이브 페이스 대기',
    isLive: false,
  },
  bestRecent: {
    lap: null,
    lapTimeText: '샘플 부족',
  },
  rollingWindow: 4,
  rollingAverageMs: null,
  rollingAverageText: '-',
  trend: {
    direction: 'stable',
    slopeMsPerLap: 0,
    deltaMs: 0,
    label: '0.000s (안정)',
  },
  spread: {
    spreadMs: 0,
    band: 'stable',
    label: '0.000s / 안정',
    tone: 'ok',
  },
  consistency: {
    value: 0,
    band: 'poor',
    label: '0.0% / 불안정',
    tone: 'critical',
    meterPct: 4,
  },
  outlierCount: 0,
  pitSignal: {
    shouldPitSoon: false,
    label: 'HOLD',
    reason: '데이터 부족',
  },
  rows: [],
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function formatLapTime(ms: number | null | undefined): string {
  if (!ms || ms <= 0 || !Number.isFinite(ms)) return '-'
  return `${Math.floor(ms / 60000)}:${((ms % 60000) / 1000).toFixed(3).padStart(6, '0')}`
}

function computeRollingAverage(values: number[], windowSize: number): number | null {
  if (!values.length) return null
  const slice = values.slice(-windowSize)
  if (!slice.length) return null
  const sum = slice.reduce((acc, value) => acc + value, 0)
  return sum / slice.length
}

function linearRegressionSlope(values: number[]): number {
  const n = values.length
  if (n < 2) return 0

  let sumX = 0
  let sumY = 0
  let sumXY = 0
  let sumXX = 0

  for (let i = 0; i < n; i += 1) {
    const x = i
    const y = values[i]
    sumX += x
    sumY += y
    sumXY += x * y
    sumXX += x * x
  }

  const numerator = n * sumXY - sumX * sumY
  const denominator = n * sumXX - sumX * sumX
  if (!denominator) return 0
  return numerator / denominator
}

function classifyTrend(slopeMsPerLap: number): PaceTrendDirection {
  if (slopeMsPerLap <= -120) return 'improving'
  if (slopeMsPerLap >= 120) return 'worsening'
  return 'stable'
}

function buildTrendLabel(deltaMs: number, direction: PaceTrendDirection): string {
  const sec = Math.abs(deltaMs) / 1000
  const sign = deltaMs > 0 ? '+' : deltaMs < 0 ? '-' : ''
  const directionLabel = direction === 'improving' ? '개선' : direction === 'worsening' ? '하락' : '안정'
  return `${sign}${sec.toFixed(3)}s (${directionLabel})`
}

function classifySpread(spreadMs: number): SpreadInterpretation {
  if (spreadMs <= 280) {
    return { spreadMs, band: 'very-stable', label: `${(spreadMs / 1000).toFixed(3)}s / 매우 안정`, tone: 'ok' }
  }
  if (spreadMs <= 520) {
    return { spreadMs, band: 'stable', label: `${(spreadMs / 1000).toFixed(3)}s / 안정`, tone: 'ok' }
  }
  if (spreadMs <= 950) {
    return { spreadMs, band: 'unstable', label: `${(spreadMs / 1000).toFixed(3)}s / 불안정`, tone: 'watch' }
  }
  return { spreadMs, band: 'critical', label: `${(spreadMs / 1000).toFixed(3)}s / 심각`, tone: 'critical' }
}

function classifyConsistency(consistencyPct: number): ConsistencyInterpretation {
  const value = clamp(consistencyPct, 0, 100)
  if (value >= 96) {
    return { value, band: 'elite', label: `${value.toFixed(1)}% / 최상`, tone: 'ok', meterPct: value }
  }
  if (value >= 92) {
    return { value, band: 'strong', label: `${value.toFixed(1)}% / 안정`, tone: 'ok', meterPct: value }
  }
  if (value >= 86) {
    return { value, band: 'watch', label: `${value.toFixed(1)}% / 주의`, tone: 'watch', meterPct: value }
  }
  return { value, band: 'poor', label: `${value.toFixed(1)}% / 불안정`, tone: 'critical', meterPct: Math.max(4, value) }
}

function detectOutliers(times: number[]): Set<number> {
  const indexes = new Set<number>()
  if (times.length < 5) return indexes

  const mean = times.reduce((acc, value) => acc + value, 0) / times.length
  const variance = times.reduce((acc, value) => acc + (value - mean) ** 2, 0) / times.length
  const stdDev = Math.sqrt(variance)
  if (!stdDev) return indexes

  for (let i = 0; i < times.length; i += 1) {
    const zScore = Math.abs((times[i] - mean) / stdDev)
    if (zScore >= 1.8) indexes.add(i)
  }

  return indexes
}

function getDeltaTone(deltaMs: number | null): 'positive' | 'negative' | 'neutral' {
  if (deltaMs === null) return 'neutral'
  if (deltaMs <= -1) return 'negative'
  if (deltaMs >= 1) return 'positive'
  return 'neutral'
}

function getChangeSymbol(changeMs: number | null): 'UP' | 'DOWN' | 'FLAT' | '-' {
  if (changeMs === null) return '-'
  if (changeMs <= -1) return 'DOWN'
  if (changeMs >= 1) return 'UP'
  return 'FLAT'
}

function buildPitSignal(
  trend: PaceTrendDirection,
  spread: SpreadInterpretation,
  outlierCount: number,
  consistency: ConsistencyInterpretation,
): PaceAnalysisViewModel['pitSignal'] {
  if ((trend === 'worsening' && spread.tone !== 'ok') || consistency.tone === 'critical') {
    return {
      shouldPitSoon: true,
      label: 'PIT WINDOW CHECK',
      reason: '페이스 하락과 변동성 증가가 동시 감지됨',
    }
  }

  if (outlierCount >= 2 && spread.tone !== 'ok') {
    return {
      shouldPitSoon: true,
      label: 'TRAFFIC RISK',
      reason: '이상치 랩 다수 발생: 트래픽/실수 가능성 점검 필요',
    }
  }

  return {
    shouldPitSoon: false,
    label: 'HOLD',
    reason: '현재 페이스 유지 가능',
  }
}

export function usePaceAnalysis(state: AppState | null, rollingWindow = 4): PaceAnalysisViewModel {
  return useMemo(() => {
    if (!state) return DEFAULT_VM

    const recent = (state.pace?.recent ?? []).filter((lap) => Number.isFinite(lap.lap_time_ms) && lap.lap_time_ms > 0)
    if (!recent.length) {
      return {
        ...DEFAULT_VM,
        isReady: true,
        currentLap: {
          lap: state.player.lap,
          text: '-',
          statusText: '랩 데이터 수집 중',
          isLive: true,
        },
      }
    }

    const safeWindow = clamp(Math.round(rollingWindow), 3, 5)
    const times = recent.map((lap) => lap.lap_time_ms)
    const rollingAverageMs = computeRollingAverage(times, safeWindow)

    const bestRecent = recent.reduce<{ lap: number; lap_time_ms: number } | null>((best, lap) => {
      if (!best || lap.lap_time_ms < best.lap_time_ms) return lap
      return best
    }, null)

    const spreadMs = Math.max(...times) - Math.min(...times)
    const spread = classifySpread(spreadMs)

    const consistencyPctRaw = state.pace?.consistency_pct ?? 0
    const consistency = classifyConsistency(consistencyPctRaw)

    const trendTimes = times.slice(-safeWindow)
    const slopeMsPerLap = linearRegressionSlope(trendTimes)
    const trendDirection = classifyTrend(slopeMsPerLap)
    const trendDeltaMs = trendTimes.length >= 2 ? trendTimes[trendTimes.length - 1] - trendTimes[0] : 0
    const trend: PaceTrend = {
      direction: trendDirection,
      slopeMsPerLap,
      deltaMs: trendDeltaMs,
      label: buildTrendLabel(trendDeltaMs, trendDirection),
    }

    const outlierIndexes = detectOutliers(times)

    const rows: PaceRow[] = recent.map((lap, index) => {
      const baselineSlice = times.slice(Math.max(0, index - safeWindow), index)
      const baseline = baselineSlice.length
        ? baselineSlice.reduce((acc, value) => acc + value, 0) / baselineSlice.length
        : null
      const deltaMs = baseline !== null ? lap.lap_time_ms - baseline : null

      const previous = index > 0 ? times[index - 1] : null
      const changeMs = previous !== null ? lap.lap_time_ms - previous : null

      const deltaText =
        deltaMs === null
          ? '-'
          : `${deltaMs > 0 ? '+' : ''}${(deltaMs / 1000).toFixed(3)}s`

      return {
        lap: lap.lap,
        lapTimeMs: lap.lap_time_ms,
        lapTimeText: formatLapTime(lap.lap_time_ms),
        deltaToRollingAvgMs: deltaMs,
        deltaToRollingAvgText: deltaText,
        deltaTone: getDeltaTone(deltaMs),
        changeFromPreviousMs: changeMs,
        changeSymbol: getChangeSymbol(changeMs),
        isBestRecent: bestRecent?.lap === lap.lap,
        isOutlier: outlierIndexes.has(index),
      }
    })

    const completedCurrentLap = recent.some((lap) => lap.lap === state.player.lap)
    const currentLap = {
      lap: state.player.lap,
      text: completedCurrentLap ? formatLapTime(state.player.current_lap_ms) : '-',
      statusText: completedCurrentLap ? '완료 랩 반영' : `L${state.player.lap} 진행 중`,
      isLive: !completedCurrentLap,
    }

    const outlierCount = rows.filter((row) => row.isOutlier).length
    const pitSignal = buildPitSignal(trendDirection, spread, outlierCount, consistency)

    return {
      isReady: true,
      bestLapText: formatLapTime(state.pace?.best_lap_ms),
      avgLapText: formatLapTime(state.pace?.avg_lap_ms),
      currentLap,
      bestRecent: {
        lap: bestRecent?.lap ?? null,
        lapTimeText: bestRecent ? formatLapTime(bestRecent.lap_time_ms) : '샘플 부족',
      },
      rollingWindow: safeWindow,
      rollingAverageMs,
      rollingAverageText: formatLapTime(rollingAverageMs),
      trend,
      spread,
      consistency,
      outlierCount,
      pitSignal,
      rows,
    }
  }, [state, rollingWindow])
}
