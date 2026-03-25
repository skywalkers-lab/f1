import { useEffect, useMemo, useRef, useState } from 'react'
import { AppState } from '../lib/types'
import { TyreHistory, TyreHistoryManager } from '../lib/tyreHistoryManager'
import { evaluateStrategy, type UnifiedStrategyDecision } from '../lib/unifiedMonteCarloCore'

/**
 * Hook that evaluates strategy through the unified Monte Carlo simulation core.
 * Manages its own TyreHistory and runs evaluation on a cadence (not every frame).
 */
export function useUnifiedStrategy(
  state: AppState | null,
): UnifiedStrategyDecision | null {
  const managerRef = useRef(new TyreHistoryManager())
  const [history, setHistory] = useState<TyreHistory>({})
  const lastEvalRef = useRef<number>(0)
  const [decision, setDecision] = useState<UnifiedStrategyDecision | null>(null)

  // Ingest tyre data every frame
  useEffect(() => {
    if (!state) return
    managerRef.current.ingest(state, Date.now())
    setHistory(managerRef.current.snapshot())
  }, [state?.last_frame_identifier])

  // Evaluate strategy on a cadence (~2s or when lap changes)
  const lapRef = useRef<number>(0)
  useEffect(() => {
    if (!state || !state.leaderboard?.length) return
    const now = Date.now()
    const lapChanged = state.player.lap !== lapRef.current
    const timeSinceLastEval = now - lastEvalRef.current

    // Evaluate when: lap changes, or every 2 seconds, whichever comes first
    if (!lapChanged && timeSinceLastEval < 2000) return

    lapRef.current = state.player.lap
    lastEvalRef.current = now

    try {
      const result = evaluateStrategy(state, history)
      setDecision(result)
    } catch {
      // Don't crash the UI if simulation fails
    }
  }, [state?.last_frame_identifier, state?.player?.lap, history])

  return decision
}
