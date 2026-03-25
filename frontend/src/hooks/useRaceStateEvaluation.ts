import { useEffect, useMemo, useRef } from 'react'
import { AppState } from '../lib/types'
import { evaluateRaceState, RaceStateSnapshot } from '../lib/dashboardMetrics'

export type RaceStateEvent = {
  id: string
  kind: 'feed-drop' | 'fuel-margin-drop' | 'pace-collapse' | 'strategy-confidence-drop' | 'action-change'
  severity: 'warn' | 'critical'
  message: string
}

export type RaceStateEvaluation = {
  snapshot: RaceStateSnapshot
  events: RaceStateEvent[]
}

function buildEvents(previous: RaceStateSnapshot | null, current: RaceStateSnapshot): RaceStateEvent[] {
  if (!previous) return []

  const next: RaceStateEvent[] = []

  if (previous.dataReliability.systemReliability - current.dataReliability.systemReliability >= 14) {
    next.push({
      id: `feed-${current.dataReliability.systemReliability}`,
      kind: 'feed-drop',
      severity: current.dataReliability.tone === 'critical' ? 'critical' : 'warn',
      message: `시스템 신뢰도 급락: ${previous.dataReliability.systemReliability} -> ${current.dataReliability.systemReliability}`,
    })
  }

  if (previous.fuelWindow.marginLaps - current.fuelWindow.marginLaps >= 0.7) {
    next.push({
      id: `fuel-${current.fuelWindow.marginLaps.toFixed(1)}`,
      kind: 'fuel-margin-drop',
      severity: current.fuelRiskLevel.tone === 'critical' ? 'critical' : 'warn',
      message: `연료 마진 급감: ${previous.fuelWindow.marginLaps.toFixed(1)}L -> ${current.fuelWindow.marginLaps.toFixed(1)}L`,
    })
  }

  if (previous.paceStability.score - current.paceStability.score >= 16) {
    next.push({
      id: `pace-${current.paceStability.score}`,
      kind: 'pace-collapse',
      severity: current.paceStability.tone === 'critical' ? 'critical' : 'warn',
      message: `페이스 안정성 붕괴: ${previous.paceStability.score} -> ${current.paceStability.score}`,
    })
  }

  if (previous.strategyConfidence.score - current.strategyConfidence.score >= 14) {
    next.push({
      id: `strategy-${current.strategyConfidence.score}`,
      kind: 'strategy-confidence-drop',
      severity: current.strategyConfidence.tone === 'critical' ? 'critical' : 'warn',
      message: `전략 확신도 하락: ${previous.strategyConfidence.score} -> ${current.strategyConfidence.score}`,
    })
  }

  if (previous.recommendedActionState.call !== current.recommendedActionState.call) {
    next.push({
      id: `action-${current.recommendedActionState.call}`,
      kind: 'action-change',
      severity: current.recommendedActionState.tone === 'critical' ? 'critical' : 'warn',
      message: `권장 행동 변경: ${previous.recommendedActionState.call} -> ${current.recommendedActionState.call}`,
    })
  }

  return next
}

export function useRaceStateEvaluation(state: AppState | null, status: string): RaceStateEvaluation {
  const previousRef = useRef<RaceStateSnapshot | null>(null)

  const snapshot = useMemo(() => evaluateRaceState(state, status), [state, status])
  const events = useMemo(() => buildEvents(previousRef.current, snapshot), [snapshot])

  useEffect(() => {
    previousRef.current = snapshot
  }, [snapshot])

  return {
    snapshot,
    events,
  }
}
