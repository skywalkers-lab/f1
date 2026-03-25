import { useEffect, useMemo, useRef } from 'react'
import { GapTrend } from '../lib/leaderboardTrend'
import { AppState } from '../lib/types'
import { StableLeaderboardRow } from './useStableLeaderboard'

type TacticalTone = 'ok' | 'watch' | 'critical'
type PressureState = 'drs' | 'pressure' | 'stable'
type StintPhase = 'warmup' | 'prime' | 'degradation'
type StrategyStateTag = 'attack' | 'defend' | 'watch' | null
type PaceState = 'best' | 'push' | 'sliding' | 'steady'

type PreviousSnapshot = {
  position: number
  frontGap: number
  backGap: number
  pressureState: PressureState
  isPitting: boolean
}

export type LeaderboardTacticalView = {
  versionKey: string
  ariaLabel: string
  gap: {
    primaryLabel: string
    secondaryLabel: string
    pressureState: PressureState
    drsAvailable: boolean
    drsActive: boolean
    overtakeProbabilityPct: number
    defenseRequired: boolean
    tone: TacticalTone
  }
  stint: {
    phase: StintPhase
    phaseLabel: string
    riskLabel: string
    undercutRisk: boolean
    wearText: string
    tone: TacticalTone
  }
  strategy: {
    tag: StrategyStateTag
    label: string | null
    detail: string
  }
  pace: {
    lapDeltaMs: number
    state: PaceState
    stateLabel: string
    sectorLabel: string
    greenStreak: number
    purpleCount: number
    tone: TacticalTone
  }
  events: {
    highlight: boolean
    labels: string[]
    flashKey: string
  }
}

type TacticalMap = Map<number, LeaderboardTacticalView>

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function toTone(score: number): TacticalTone {
  if (score >= 70) return 'ok'
  if (score >= 45) return 'watch'
  return 'critical'
}

function formatSignedMs(value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? '-' : ''
  return `${sign}${Math.abs(Math.round(value))}ms`
}

function resolvePressureState(frontGap: number, backGap: number): PressureState {
  if (frontGap < 1 || backGap < 1) return 'drs'
  if (frontGap < 2 || backGap < 2) return 'pressure'
  return 'stable'
}

function resolveGapNarrative(frontGap: number, backGap: number, trend: GapTrend): { primaryLabel: string; secondaryLabel: string; tone: TacticalTone; defenseRequired: boolean } {
  if (frontGap < 1 && trend.direction === 'closing') {
    return {
      primaryLabel: '추월 시도 구간',
      secondaryLabel: 'DRS 범위 진입, 패스 시도 가능',
      tone: 'ok',
      defenseRequired: false,
    }
  }

  if (backGap < 1 && trend.direction === 'dropping') {
    return {
      primaryLabel: '방어 필요',
      secondaryLabel: '후방 차량 DRS 위협',
      tone: 'critical',
      defenseRequired: true,
    }
  }

  if (frontGap < 2 || backGap < 2) {
    return {
      primaryLabel: '압박 상태',
      secondaryLabel: trend.direction === 'closing' ? '트래픽 압박 증가' : '상대 접근 감시',
      tone: 'watch',
      defenseRequired: backGap < frontGap,
    }
  }

  return {
    primaryLabel: '갭 안정화',
    secondaryLabel: '즉시 전술 개입 필요 낮음',
    tone: 'ok',
    defenseRequired: false,
  }
}

function resolveStintPhase(stintLap: number | undefined, wear: number | undefined): { phase: StintPhase; phaseLabel: string; tone: TacticalTone } {
  const lap = isFiniteNumber(stintLap) ? stintLap : 0
  const tyreWear = isFiniteNumber(wear) ? wear : 0

  if (lap <= 3 || tyreWear < 12) {
    return { phase: 'warmup', phaseLabel: '워밍업', tone: 'watch' }
  }
  if (tyreWear >= 58 || lap >= 18) {
    return { phase: 'degradation', phaseLabel: '열화 구간', tone: tyreWear >= 72 ? 'critical' : 'watch' }
  }
  return { phase: 'prime', phaseLabel: '최적 성능', tone: 'ok' }
}

function resolveTyreRisk(wear: number | undefined, pitWindowOpen: boolean | undefined, frontGap: number): { riskLabel: string; undercutRisk: boolean; tone: TacticalTone } {
  const tyreWear = isFiniteNumber(wear) ? wear : 0
  const undercutRisk = !!pitWindowOpen && tyreWear >= 58 && frontGap <= 2.4

  if (tyreWear >= 78) {
    return { riskLabel: '성능 급락 임계', undercutRisk: true, tone: 'critical' }
  }
  if (undercutRisk) {
    return { riskLabel: '언더컷 취약', undercutRisk: true, tone: 'critical' }
  }
  if (tyreWear >= 58) {
    return { riskLabel: '열화 상승', undercutRisk: false, tone: 'watch' }
  }
  return { riskLabel: '성능 유지', undercutRisk: false, tone: 'ok' }
}

function resolveStrategyState(params: {
  isPitting: boolean
  pitWindowOpen: boolean | undefined
  frontGap: number
  backGap: number
  wear: number | undefined
  trend: GapTrend
  defenseRequired: boolean
}): { tag: StrategyStateTag; label: string | null; detail: string } {
  const wear = isFiniteNumber(params.wear) ? params.wear : 0

  if (params.isPitting) {
    return { tag: null, label: null, detail: '피트 수행 중' }
  }

  if (params.pitWindowOpen && wear >= 58 && params.frontGap <= 2.4) {
    return { tag: 'attack', label: 'UNDERCUT LIVE', detail: '이번 랩 피트 시 순위 이득 가능' }
  }

  if (params.defenseRequired || params.backGap < 1 || (params.backGap < 1.5 && params.trend.direction === 'dropping')) {
    return { tag: 'defend', label: 'DEFEND NOW', detail: '후방 차량 접근, 라인/배터리 방어 필요' }
  }

  if (params.frontGap < 1.8 || params.trend.direction === 'closing') {
    return { tag: 'watch', label: 'PRESSURE ON', detail: '추월 준비 또는 압박 유지 구간' }
  }

  return { tag: null, label: null, detail: '전략 상태 안정' }
}

function resolvePaceState(params: {
  lastLapMs: number
  bestLapMs: number
  sessionBestMs: number
  sectorMarks?: Array<'purple' | 'green' | 'none'>
}): { lapDeltaMs: number; state: PaceState; stateLabel: string; sectorLabel: string; greenStreak: number; purpleCount: number; tone: TacticalTone } {
  const baseline = params.bestLapMs > 0 ? params.bestLapMs : params.sessionBestMs
  const lapDeltaMs = baseline > 0 ? params.lastLapMs - baseline : 0
  const marks = params.sectorMarks ?? []
  let greenStreak = 0
  let currentStreak = 0
  let purpleCount = 0

  marks.forEach((mark) => {
    if (mark === 'purple') purpleCount += 1
    if (mark === 'green' || mark === 'purple') {
      currentStreak += 1
      greenStreak = Math.max(greenStreak, currentStreak)
    } else {
      currentStreak = 0
    }
  })

  let state: PaceState = 'steady'
  let stateLabel = '페이스 유지'
  let tone: TacticalTone = 'ok'

  if (lapDeltaMs <= 40) {
    state = 'best'
    stateLabel = '개인 베스트 근접'
    tone = 'ok'
  } else if (lapDeltaMs <= 280 || purpleCount > 0 || greenStreak >= 2) {
    state = 'push'
    stateLabel = '페이스 상승'
    tone = 'ok'
  } else if (lapDeltaMs >= 900) {
    state = 'sliding'
    stateLabel = '페이스 하락'
    tone = 'critical'
  } else {
    state = 'steady'
    stateLabel = '성능 유지'
    tone = 'watch'
  }

  const sectorLabel = purpleCount > 0 ? '최고 성능 구간' : greenStreak >= 2 ? '연속 상승 섹터' : '섹터 안정'

  return {
    lapDeltaMs,
    state,
    stateLabel,
    sectorLabel,
    greenStreak,
    purpleCount,
    tone,
  }
}

function buildAriaLabel(params: {
  row: StableLeaderboardRow
  frontGap: number
  backGap: number
  gap: LeaderboardTacticalView['gap']
  stint: LeaderboardTacticalView['stint']
  strategy: LeaderboardTacticalView['strategy']
  pace: LeaderboardTacticalView['pace']
}): string {
  const frontText = Number.isFinite(params.frontGap) ? `${params.frontGap.toFixed(1)}초` : '해당 없음'
  const backText = Number.isFinite(params.backGap) ? `${params.backGap.toFixed(1)}초` : '해당 없음'
  return `${params.row.driver_code}, ${params.row.position}위, 앞차와 ${frontText}, 뒤차와 ${backText}, ${params.gap.secondaryLabel}, 스틴트 ${params.stint.phaseLabel}, 타이어 ${params.stint.riskLabel}, ${params.pace.stateLabel}, ${params.strategy.detail}`
}

export function useLeaderboardTacticalAnalysis(
  state: AppState | null,
  rows: StableLeaderboardRow[],
  trendMap: Map<number, GapTrend>,
): TacticalMap {
  const previousRef = useRef<Map<number, PreviousSnapshot>>(new Map())
  const bestLapRef = useRef<Map<number, number>>(new Map())

  useEffect(() => {
    const nextPrevious = new Map<number, PreviousSnapshot>()

    rows.forEach((row, index) => {
      const ahead = index > 0 ? rows[index - 1] : undefined
      const behind = index < rows.length - 1 ? rows[index + 1] : undefined
      const frontGap = ahead ? Math.abs(row.gap_to_player_s - ahead.gap_to_player_s) : Number.POSITIVE_INFINITY
      const backGap = behind ? Math.abs(behind.gap_to_player_s - row.gap_to_player_s) : Number.POSITIVE_INFINITY
      const pressureState = resolvePressureState(frontGap, backGap)

      nextPrevious.set(row.car_index, {
        position: row.position,
        frontGap,
        backGap,
        pressureState,
        isPitting: row.is_pitting,
      })

      const currentBest = bestLapRef.current.get(row.car_index)
      if (row.last_lap_ms > 0 && (!currentBest || row.last_lap_ms < currentBest)) {
        bestLapRef.current.set(row.car_index, row.last_lap_ms)
      }
    })

    previousRef.current = nextPrevious
  }, [rows])

  return useMemo(() => {
    const result: TacticalMap = new Map()
    const playerCarIndex = state?.player_car_index
    const eventSummary = String(state?.last_event_summary ?? '').toLowerCase()
    const drsStateMap = new Map<number, boolean>()

    state?.minimap.cars.forEach((car) => {
      drsStateMap.set(car.car_index, !!car.drs_active)
    })

    rows.forEach((row, index) => {
      const ahead = index > 0 ? rows[index - 1] : undefined
      const behind = index < rows.length - 1 ? rows[index + 1] : undefined
      const frontGap = ahead ? Math.abs(row.gap_to_player_s - ahead.gap_to_player_s) : Number.POSITIVE_INFINITY
      const backGap = behind ? Math.abs(behind.gap_to_player_s - row.gap_to_player_s) : Number.POSITIVE_INFINITY
      const trend = trendMap.get(row.car_index) ?? { direction: 'stable', delta: 0 }
      const pressureState = resolvePressureState(frontGap, backGap)
      const gapNarrative = resolveGapNarrative(frontGap, backGap, trend)
      const drsAvailable = frontGap < 1 || backGap < 1
      const drsActive = row.car_index === playerCarIndex ? !!state?.player.drs_enabled || drsAvailable : !!drsStateMap.get(row.car_index) || drsAvailable
      const rivalWearAdvantage = (ahead?.tyreWearPct ?? row.tyreWearPct ?? 0) - (row.tyreWearPct ?? 0)
      const paceAdvantage = ahead ? (ahead.last_lap_ms - row.last_lap_ms) / 18 : 0
      const overtakeProbabilityPct = ahead
        ? Math.round(
            clamp(
              42 + (1.4 - Math.min(frontGap, 1.4)) * 22 + (trend.direction === 'closing' ? 14 : -6) + rivalWearAdvantage * 1.4 + paceAdvantage,
              6,
              95,
            ),
          )
        : 0

      const gap = {
        primaryLabel: gapNarrative.primaryLabel,
        secondaryLabel: gapNarrative.secondaryLabel,
        pressureState,
        drsAvailable,
        drsActive,
        overtakeProbabilityPct,
        defenseRequired: gapNarrative.defenseRequired,
        tone: gapNarrative.tone,
      }

      const stintPhase = resolveStintPhase(row.stintLap, row.tyreWearPct)
      const tyreRisk = resolveTyreRisk(row.tyreWearPct, row.pitWindowOpen, frontGap)
      const stint = {
        phase: stintPhase.phase,
        phaseLabel: stintPhase.phaseLabel,
        riskLabel: tyreRisk.riskLabel,
        undercutRisk: tyreRisk.undercutRisk,
        wearText: isFiniteNumber(row.tyreWearPct) ? `${Math.round(row.tyreWearPct)}%` : '-',
        tone: tyreRisk.tone === 'critical' ? 'critical' : stintPhase.tone,
      }

      const strategy = resolveStrategyState({
        isPitting: row.is_pitting,
        pitWindowOpen: row.pitWindowOpen,
        frontGap,
        backGap,
        wear: row.tyreWearPct,
        trend,
        defenseRequired: gap.defenseRequired,
      })

      const personalBestMs = bestLapRef.current.get(row.car_index) ?? row.last_lap_ms
      const pace = resolvePaceState({
        lastLapMs: row.last_lap_ms,
        bestLapMs: personalBestMs,
        sessionBestMs: state?.pace.best_lap_ms ?? 0,
        sectorMarks: row.sectorMarks,
      })

      const previous = previousRef.current.get(row.car_index)
      const eventLabels: string[] = []

      if (previous && row.position < previous.position) eventLabels.push('추월 발생')
      if (previous && !previous.isPitting && row.is_pitting) eventLabels.push('피트 진입')
      if (previous && previous.pressureState !== 'drs' && pressureState === 'drs') eventLabels.push('DRS 활성 구간')
      if (previous && (Math.abs(previous.frontGap - frontGap) >= 0.8 || Math.abs(previous.backGap - backGap) >= 0.8)) eventLabels.push('갭 급변')
      if (eventSummary.includes(row.driver_code.toLowerCase())) eventLabels.push('이벤트 포커스')

      const events = {
        highlight: eventLabels.length > 0,
        labels: eventLabels,
        flashKey: eventLabels.join('|') || 'none',
      }

      const ariaLabel = buildAriaLabel({
        row,
        frontGap,
        backGap,
        gap,
        stint,
        strategy,
        pace,
      })

      const versionKey = [
        row.car_index,
        gap.pressureState,
        gap.drsActive ? 1 : 0,
        gap.overtakeProbabilityPct,
        stint.phase,
        stint.riskLabel,
        strategy.tag ?? 'none',
        pace.state,
        pace.greenStreak,
        pace.purpleCount,
        events.flashKey,
      ].join(':')

      result.set(row.car_index, {
        versionKey,
        ariaLabel,
        gap,
        stint,
        strategy,
        pace,
        events,
      })
    })

    return result
  }, [rows, state, trendMap])
}