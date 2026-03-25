import { useMemo, useRef } from 'react'
import { AppState } from '../lib/types'
import { StrategyEngineOutput, StrategyScenario } from '../lib/strategyEngine'

type ScenarioRiskBand = 'low' | 'medium' | 'high'
type StrategyAlertLevel = 'normal' | 'watch' | 'critical'
type ConfidenceStability = 'stable' | 'watch' | 'unstable'

type ScenarioCurvePoint = {
  lap: number
  lapTimeText: string
  deltaToBaselineMs: number
  deltaToBaselineText: string
  normalizedPct: number
}

type ScenarioDecisionRow = {
  id: StrategyScenario['id']
  rank: number
  label: string
  timingText: string
  projectedText: string
  rejoinText: string
  expectedGainText: string
  lapDeltaText: string
  lapDeltaMs: number
  riskBand: ScenarioRiskBand
  riskLabel: string
  downsideLabel: string
  pitWindowSensitivity: string
  confidencePct: number
  triggerRule: string
  fallbackRule: string
  curve: ScenarioCurvePoint[]
  crossoverLap: number | null
  isBest: boolean
}

type DecisionCausalLog = {
  id: string
  cause: string
  impact: string
  conclusion: string
  tone: 'positive' | 'warning' | 'neutral'
}

type ExecutionCommand = {
  command: string
  condition: string
  timing: string
  status: 'ready' | 'watch' | 'hold'
}

export type StrategyAnalysisViewModel = {
  ready: boolean
  titleTone: 'gain' | 'warn' | 'hold'
  simulationHorizon: number
  recommendation: {
    headline: string
    subline: string
    timing: string
    triggerSummary: string
    fallback: string
    confidenceText: string
    confidencePct: number
    confidenceStability: ConfidenceStability
  }
  scenarioRows: ScenarioDecisionRow[]
  recommendationMatrix: {
    crossoverSummary: string
    trafficAlert: string
  }
  decisionCausalLog: DecisionCausalLog[]
  executionCommands: ExecutionCommand[]
  attention: {
    strategyChanged: boolean
    riskSpike: boolean
    confidenceDrop: boolean
    level: StrategyAlertLevel
    message: string
  }
}

const EMPTY_VM: StrategyAnalysisViewModel = {
  ready: false,
  titleTone: 'hold',
  simulationHorizon: 0,
  recommendation: {
    headline: '-',
    subline: '-',
    timing: '-',
    triggerSummary: '-',
    fallback: '-',
    confidenceText: '-',
    confidencePct: 0,
    confidenceStability: 'stable',
  },
  scenarioRows: [],
  recommendationMatrix: {
    crossoverSummary: '-',
    trafficAlert: '-',
  },
  decisionCausalLog: [],
  executionCommands: [],
  attention: {
    strategyChanged: false,
    riskSpike: false,
    confidenceDrop: false,
    level: 'normal',
    message: '-',
  },
}

function msToSignedSec(ms: number): string {
  const sign = ms > 0 ? '+' : ms < 0 ? '-' : ''
  return `${sign}${(Math.abs(ms) / 1000).toFixed(3)}s`
}

function msToLap(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '-'
  return `${Math.floor(ms / 60000)}:${((ms % 60000) / 1000).toFixed(3).padStart(6, '0')}`
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function riskToLabel(risk: ScenarioRiskBand): string {
  if (risk === 'high') return 'HIGH / 리조인 손실 가능성 큼'
  if (risk === 'medium') return 'MEDIUM / 트래픽 영향 감시'
  return 'LOW / 클린에어 유지 가능'
}

function toTimingText(pitOffset: number | null): string {
  if (pitOffset === null) return 'Stay Out'
  if (pitOffset === 0) return '지금'
  if (pitOffset === 1) return '1랩 후'
  if (pitOffset === 2) return '2랩 후'
  return `${pitOffset}랩 후`
}

function inferTriggerRule(scenario: StrategyScenario, state: AppState): string {
  const playerRow = state.leaderboard.find((row) => row.car_index === state.player_car_index)
  const wear = Number(playerRow?.tyre_wear_pct ?? 0)
  const aheadGap = Math.max(0, Math.round((state.leaderboard.find((row) => row.position === Math.max(1, state.player.position - 1))?.gap_to_player_s ?? 2.5) * 1000))

  if (scenario.id === 'BOX_THIS_LAP') {
    return `IF tyre wear > ${Math.max(62, Math.round(wear))}% OR gapAhead < ${(aheadGap / 1000).toFixed(1)}s`
  }
  if (scenario.id === 'PIT_IN_2') {
    return 'IF current delta worsening for 2 laps AND traffic risk <= medium'
  }
  if (scenario.id === 'PIT_IN_4') {
    return 'IF clean air likely and tyre degradation slope remains controlled'
  }
  return 'IF gapAhead > 2.0s AND lap trend stable, HOLD POSITION'
}

function inferFallbackRule(scenario: StrategyScenario): string {
  if (scenario.id === 'BOX_THIS_LAP') return 'FAILSAFE: Stay out next lap only if rejoin risk flips HIGH'
  if (scenario.id === 'PIT_IN_2') return 'FAILSAFE: Switch to BOX THIS LAP when pace delta > +0.450s'
  if (scenario.id === 'PIT_IN_4') return 'FAILSAFE: pull trigger to PIT_IN_2 when crossover lost'
  return 'FAILSAFE: move to PIT_IN_2 if two consecutive slower laps'
}

function computePitWindowSensitivity(current: StrategyScenario, all: StrategyScenario[]): string {
  const nearby = all
    .filter((scenario) => scenario.id !== current.id && scenario.pitOffset !== null && current.pitOffset !== null)
    .sort((a, b) => Math.abs((a.pitOffset ?? 0) - (current.pitOffset ?? 0)) - Math.abs((b.pitOffset ?? 0) - (current.pitOffset ?? 0)))[0]

  if (!nearby) return '낮음: 윈도우 영향 제한적'

  const gainDiff = Math.abs(current.expectedGainMs - nearby.expectedGainMs)
  if (gainDiff > 2200) return `높음: ±1랩 변화 시 ${msToSignedSec(gainDiff)} 편차`
  if (gainDiff > 1200) return `중간: ±1랩 변화 시 ${msToSignedSec(gainDiff)} 편차`
  return `낮음: ±1랩 변화 시 ${msToSignedSec(gainDiff)} 편차`
}

function computeDownsideLabel(scenario: StrategyScenario): string {
  const volatilityPenalty = scenario.trafficRisk === 'high' ? 2600 : scenario.trafficRisk === 'medium' ? 1300 : 600
  const downsideMs = scenario.expectedGainMs - volatilityPenalty
  if (downsideMs >= 0) return `Worst-case ${msToSignedSec(downsideMs)} 유지`
  return `Worst-case ${msToSignedSec(downsideMs)} 손실 가능`
}

function buildScenarioRows(decision: StrategyEngineOutput, baseline: StrategyScenario, state: AppState): ScenarioDecisionRow[] {
  const allLapDeltas: number[] = []
  const baselineMap = new Map<number, number>(baseline.laps.map((lap) => [lap.lap, lap.lapTimeMs]))

  decision.scenarios.forEach((scenario) => {
    scenario.laps.forEach((lap) => {
      const base = baselineMap.get(lap.lap) ?? lap.lapTimeMs
      allLapDeltas.push(lap.lapTimeMs - base)
    })
  })

  const minDelta = Math.min(...allLapDeltas, 0)
  const maxDelta = Math.max(...allLapDeltas, 0)
  const span = Math.max(1, maxDelta - minDelta)

  return decision.scenarios.slice(0, 3).map((scenario, index) => {
    const avgLap = scenario.laps.reduce((sum, lap) => sum + lap.lapTimeMs, 0) / Math.max(1, scenario.laps.length)
    const avgBase = baseline.laps.reduce((sum, lap) => sum + lap.lapTimeMs, 0) / Math.max(1, baseline.laps.length)
    const avgDelta = avgLap - avgBase

    const curve = scenario.laps.map((lap) => {
      const base = baselineMap.get(lap.lap) ?? lap.lapTimeMs
      const delta = lap.lapTimeMs - base
      const normalizedPct = clamp(((delta - minDelta) / span) * 100, 0, 100)
      return {
        lap: lap.lap,
        lapTimeText: msToLap(lap.lapTimeMs),
        deltaToBaselineMs: delta,
        deltaToBaselineText: msToSignedSec(delta),
        normalizedPct,
      }
    })

    let crossoverLap: number | null = null
    for (let i = 1; i < curve.length; i += 1) {
      const prev = curve[i - 1].deltaToBaselineMs
      const curr = curve[i].deltaToBaselineMs
      if (prev > 0 && curr <= 0) {
        crossoverLap = curve[i].lap
        break
      }
    }

    return {
      id: scenario.id,
      rank: index + 1,
      label: scenario.label,
      timingText: toTimingText(scenario.pitOffset),
      projectedText: `P${scenario.projectedPosition}`,
      rejoinText: `P${scenario.projectedRejoinPosition}`,
      expectedGainText: msToSignedSec(scenario.expectedGainMs),
      lapDeltaText: msToSignedSec(avgDelta),
      lapDeltaMs: avgDelta,
      riskBand: scenario.trafficRisk,
      riskLabel: riskToLabel(scenario.trafficRisk),
      downsideLabel: computeDownsideLabel(scenario),
      pitWindowSensitivity: computePitWindowSensitivity(scenario, decision.scenarios),
      confidencePct: Math.round(clamp(scenario.confidence * 100, 0, 100)),
      triggerRule: inferTriggerRule(scenario, state),
      fallbackRule: inferFallbackRule(scenario),
      curve,
      crossoverLap,
      isBest: index === 0,
    }
  })
}

function mapDecisionLog(decision: StrategyEngineOutput): DecisionCausalLog[] {
  return decision.decisionLog.slice(0, 5).map((entry, idx) => {
    const parts = entry.value.split('/').map((part) => part.trim()).filter(Boolean)
    const impact = parts[0] ?? entry.value
    const conclusion = parts[1] ?? (entry.tone === 'warning' ? '리스크 반영하여 즉시 보정 필요' : '전략 우위 유지')

    return {
      id: `${entry.label}-${idx}`,
      cause: entry.label,
      impact,
      conclusion,
      tone: entry.tone,
    }
  })
}

function mapExecutionCommands(decision: StrategyEngineOutput, rows: ScenarioDecisionRow[]): ExecutionCommand[] {
  const best = rows[0]
  const primary = decision.executionChecklist[0]
  const secondary = decision.executionChecklist[1]
  const third = decision.executionChecklist[2]

  const commands: ExecutionCommand[] = [
    {
      command: best?.id === 'BOX_THIS_LAP' ? 'BOX THIS LAP' : best?.id === 'PIT_IN_2' ? 'BOX IN 2' : 'HOLD',
      condition: best?.triggerRule ?? '조건 데이터 없음',
      timing: best?.timingText ?? '-',
      status: best?.riskBand === 'high' ? 'watch' : 'ready',
    },
    {
      command: primary?.step ?? 'MONITOR',
      condition: secondary?.detail ?? '트리거 없음',
      timing: '실시간',
      status: 'watch',
    },
    {
      command: 'FAILSAFE',
      condition: best?.fallbackRule ?? third?.detail ?? '대안 없음',
      timing: '조건 충족 시 즉시',
      status: 'hold',
    },
  ]

  return commands
}

function confidenceStability(confidencePct: number, spreadMs: number): ConfidenceStability {
  if (confidencePct < 54 || spreadMs > 2200) return 'unstable'
  if (confidencePct < 66 || spreadMs > 1300) return 'watch'
  return 'stable'
}

export function useStrategyAnalysis(
  state: AppState | null,
  decision: StrategyEngineOutput | null,
): StrategyAnalysisViewModel {
  const previousRef = useRef<{ call: string; risk: ScenarioRiskBand; confidencePct: number } | null>(null)

  return useMemo(() => {
    if (!state || !decision || !decision.scenarios.length) return EMPTY_VM

    const baseline = decision.scenarios.find((scenario) => scenario.id === 'STAY_OUT') ?? decision.scenarios[0]
    const scenarioRows = buildScenarioRows(decision, baseline, state)
    const best = scenarioRows[0]

    const confidencePct = Math.round(clamp(decision.recommendation.confidence * 100, 0, 100))
    const spreadMs = Math.abs((scenarioRows[0]?.lapDeltaMs ?? 0) - (scenarioRows[1]?.lapDeltaMs ?? 0))
    const stability = confidenceStability(confidencePct, spreadMs)

    const crossoverCount = scenarioRows.filter((row) => row.crossoverLap !== null).length
    const recommendationMatrix = {
      crossoverSummary:
        crossoverCount > 0
          ? `${crossoverCount}개 시나리오에서 교차점 감지 (${scenarioRows
              .filter((row) => row.crossoverLap)
              .map((row) => `${row.label}: L${row.crossoverLap}`)
              .join(' / ')})`
          : '교차점 없음: 선택 전략 우위 고정',
      trafficAlert:
        best.riskBand === 'high'
          ? '트래픽 경보: 리조인 직후 포지션 손실 가능성 높음'
          : best.riskBand === 'medium'
            ? '트래픽 주의: 언더컷 타이밍 정밀 제어 필요'
            : '트래픽 양호: 실행 지연 리스크 제한적',
    }

    const recommendation = {
      headline: decision.recommendation.headline,
      subline: decision.recommendation.subline,
      timing: best.timingText,
      triggerSummary: best.triggerRule,
      fallback: best.fallbackRule,
      confidenceText: `${confidencePct}% / ${stability === 'stable' ? '안정' : stability === 'watch' ? '주의' : '불안정'}`,
      confidencePct,
      confidenceStability: stability,
    }

    const executionCommands = mapExecutionCommands(decision, scenarioRows)
    const decisionCausalLog = mapDecisionLog(decision)

    const prev = previousRef.current
    const strategyChanged = !!prev && prev.call !== decision.recommendation.call
    const riskSpike = !!prev && prev.risk !== 'high' && best.riskBand === 'high'
    const confidenceDrop = !!prev && prev.confidencePct - confidencePct >= 10

    let level: StrategyAlertLevel = 'normal'
    if (riskSpike || confidenceDrop) level = 'critical'
    else if (strategyChanged) level = 'watch'

    const message =
      level === 'critical'
        ? '전략 경보: 리스크 급증 또는 신뢰도 하락, 즉시 재판단 필요'
        : level === 'watch'
          ? '전략 변경 감지: 드라이버/피트크루 콜 동기화 필요'
          : '전략 안정: 현재 실행 플랜 유지 가능'

    previousRef.current = {
      call: decision.recommendation.call,
      risk: best.riskBand,
      confidencePct,
    }

    return {
      ready: true,
      titleTone: decision.recommendation.tone,
      simulationHorizon: decision.simulationHorizon,
      recommendation,
      scenarioRows,
      recommendationMatrix,
      decisionCausalLog,
      executionCommands,
      attention: {
        strategyChanged,
        riskSpike,
        confidenceDrop,
        level,
        message,
      },
    }
  }, [state, decision])
}
