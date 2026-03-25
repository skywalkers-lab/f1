/**
 * Hook for consuming enhanced strategy engine output from the server.
 * Listens for 'strategy_engine' messages on the WebSocket and merges
 * them with the client-side Monte Carlo decision for display.
 */

import { useEffect, useRef, useState } from 'react'
import { AppState } from '../lib/types'

/** Matches StrategyEngineOutput from the server strategy engine. */
export interface EnhancedStrategyOutput {
  recommended: {
    distributions: {
      totalTime: DistributionMetrics
      positionChange: DistributionMetrics
      finalPosition: DistributionMetrics
    }
    probabilisticConfidence: number
    scenarioVariance: {
      normalVsNeutralized: number
      bestVsWorst: number
      crossScenarioStability: number
    }
    engineerNotes: string[]
    raceEvolution: {
      scProbabilityPerLap: number
      vscProbabilityPerLap: number
      pitWindowCompression: number
      effectivePitLoss: number
      trackEvolutionDelta: number
      fuelCorrectionPerLap: number
      racePhase: 'early' | 'mid' | 'late'
      incidentDensity: number
      clusterCompression: number
    }
    trafficAnalysis: {
      drsTrainLength: number
      inDrsTrain: boolean
      sectorOvertakeDifficulty: number[]
      clusterPosition: number
      cumulativeTrafficLoss: number
      cleanAirScore: number
      expectedTrafficLaps: number
    }
    objectives: {
      timeGain: number
      positionGain: number
      riskExposure: number
      trafficExposure: number
      tyreLongevity: number
      strategicFlexibility: number
    }
    executionPlan: {
      lapIntents: Array<{ lap: number; intent: string; targetDelta: number | null; notes: string }>
      triggers: Array<{ id: string; condition: string; action: string; priority: string; engineerNote: string }>
      contingencies: Array<{ event: string; action: string; conditions: string; priority: string }>
    }
  }
  confidence: number
  separation: number
  engineerBriefing: string
  inertia: {
    previousRecommendation: string | null
    consecutiveLaps: number
    switchThreshold: number
  }
  computeTimeMs: number
  totalRuns: number
  timestamp: number
}

export interface DistributionMetrics {
  mean: number
  median: number
  p10: number
  p90: number
  bestCase: number
  worstCase: number
  stddev: number
}

/**
 * Parse enhanced strategy data from the state object.
 * The backend sends this as part of the state broadcast.
 */
export function useEnhancedStrategy(state: AppState | null): EnhancedStrategyOutput | null {
  const [output, setOutput] = useState<EnhancedStrategyOutput | null>(null)
  const lastTimestamp = useRef<number>(0)

  useEffect(() => {
    if (!state) return

    // Strategy engine output comes as `enhanced_strategy` in the state payload
    const enhanced = (state as Record<string, unknown>).enhanced_strategy as EnhancedStrategyOutput | undefined
    if (!enhanced || !enhanced.timestamp) return

    // Only update if timestamp changed
    if (enhanced.timestamp === lastTimestamp.current) return
    lastTimestamp.current = enhanced.timestamp

    setOutput(enhanced)
  }, [state])

  return output
}
