import { AppState } from './types'
import { TyreHistory } from './tyreHistoryManager'
import { analyzeUndercutWindows } from './undercutAnalyzer'

export type DriverSelectionResult = {
  highlighted: number[]
  faded: number[]
}

export function selectStrategicDrivers(state: AppState, history: TyreHistory, aheadCount = 12, behindCount = 12): DriverSelectionResult {
  const rows = [...(state.leaderboard ?? [])].sort((a, b) => a.position - b.position)
  const playerCarIndex = state.player_car_index
  const playerPos = rows.findIndex((r) => r.car_index === playerCarIndex)
  if (playerPos < 0) return { highlighted: [], faded: [] }

  const highlighted = new Set<number>([playerCarIndex])
  const start = Math.max(0, playerPos - aheadCount)
  const end = Math.min(rows.length - 1, playerPos + behindCount)
  for (let i = start; i <= end; i += 1) highlighted.add(rows[i].car_index)

  const undercutWindows = analyzeUndercutWindows(state, history)
  for (const window of undercutWindows.slice(0, 5)) highlighted.add(window.rivalCarIndex)

  const all = rows.map((r) => r.car_index)
  const faded = all.filter((id) => !highlighted.has(id))
  return { highlighted: [...highlighted], faded }
}
