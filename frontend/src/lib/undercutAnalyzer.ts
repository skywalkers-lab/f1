import { AppState } from './types'
import { TyreHistory } from './tyreHistoryManager'
import { predictCliffLap } from './wearPrediction'

export type UndercutWindow = {
  rivalCarIndex: number
  startLap: number
  endLap: number
  score: number
  reason: string
}

function latestWear(history: TyreHistory, carIndex: number): number | null {
  const points = history[carIndex]
  if (!points || points.length === 0) return null
  const value = points[points.length - 1]?.wear
  return Number.isFinite(value) ? Number(value) : null
}

export function analyzeUndercutWindows(state: AppState, history: TyreHistory, cliffThreshold = 0.78): UndercutWindow[] {
  const rows = [...(state.leaderboard ?? [])].sort((a, b) => a.position - b.position)
  const playerCarIndex = state.player_car_index
  const playerRow = rows.find((r) => r.car_index === playerCarIndex)
  if (!playerRow) return []

  const playerWear = latestWear(history, playerCarIndex)
  if (playerWear === null) return []
  const playerPred = predictCliffLap(playerCarIndex, history[playerCarIndex] ?? [], cliffThreshold)
  const currentLap = Number.isFinite(state.player?.lap) ? Number(state.player.lap) : 0

  const candidates = rows.filter((r) => r.position < playerRow.position).slice(-6)
  const output: UndercutWindow[] = []

  for (const rival of candidates) {
    const rivalWear = latestWear(history, rival.car_index)
    if (rivalWear === null) continue

    const gapAhead = Math.max(0, -Number(rival.gap_to_player_s || 0))
    if (gapAhead < 0.3 || gapAhead > 4.0) continue

    const rivalPred = predictCliffLap(rival.car_index, history[rival.car_index] ?? [], cliffThreshold)
    const wearDelta = rivalWear - playerWear
    const cliffLapDelta = (rivalPred?.cliffLap ?? currentLap + 99) - (playerPred?.cliffLap ?? currentLap + 99)
    const expectedGainS = wearDelta * 8.0 + Math.max(0, cliffLapDelta) * 0.35
    const score = expectedGainS - gapAhead * 0.72

    if (score <= 0.18) continue
    output.push({
      rivalCarIndex: rival.car_index,
      startLap: currentLap,
      endLap: currentLap + Math.min(3.0, 1.0 + score * 1.4),
      score,
      reason: `gap ${gapAhead.toFixed(2)}s, wearΔ ${(wearDelta * 100).toFixed(1)}%`,
    })
  }

  return output.sort((a, b) => b.score - a.score)
}
