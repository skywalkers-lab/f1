import { useEffect, useMemo, useRef } from 'react'
import { AppState } from '../lib/types'

export type StableLeaderboardRow = AppState['leaderboard'][number] & {
  stintLap?: number
  tyreWearPct?: number
  pitWindowOpen?: boolean
  sectorMarks?: Array<'purple' | 'green' | 'none'>
}

type PrevRowMap = Map<number, StableLeaderboardRow>
type SectorMark = 'purple' | 'green' | 'none'

function isReasonableGap(value: number): boolean {
  return Number.isFinite(value) && Math.abs(value) <= 180
}

function isReasonableLapTime(value: number): boolean {
  return Number.isFinite(value) && value >= 45_000 && value <= 220_000
}

function toSectorMarks(raw: unknown): Array<'purple' | 'green' | 'none'> | undefined {
  if (!Array.isArray(raw)) return undefined
  const marks = raw
    .slice(0, 3)
    .map((v) => (v === 'purple' || v === 'green' ? v : 'none')) as Array<'purple' | 'green' | 'none'>
  if (marks.length === 0) return undefined
  return marks
}

function normalizeUniquePurple(rows: StableLeaderboardRow[]): StableLeaderboardRow[] {
  const purpleWinnerBySector = [-1, -1, -1]

  rows.forEach((row, rowIndex) => {
    const marks = row.sectorMarks ?? []
    for (let sectorIndex = 0; sectorIndex < 3; sectorIndex += 1) {
      if (marks[sectorIndex] !== 'purple') continue
      const currentWinner = purpleWinnerBySector[sectorIndex]
      if (currentWinner === -1 || rows[rowIndex].position < rows[currentWinner].position) {
        purpleWinnerBySector[sectorIndex] = rowIndex
      }
    }
  })

  return rows.map((row, rowIndex) => {
    if (!row.sectorMarks || row.sectorMarks.length === 0) return row

    const adjusted = [...row.sectorMarks] as SectorMark[]
    let changed = false

    for (let sectorIndex = 0; sectorIndex < 3; sectorIndex += 1) {
      if (adjusted[sectorIndex] !== 'purple') continue
      if (purpleWinnerBySector[sectorIndex] === rowIndex) continue
      adjusted[sectorIndex] = 'green'
      changed = true
    }

    if (!changed) return row
    return {
      ...row,
      sectorMarks: adjusted,
    }
  })
}

function stabilizeRow(raw: AppState['leaderboard'][number], prev?: StableLeaderboardRow): StableLeaderboardRow {
  const gap = isReasonableGap(raw.gap_to_player_s) ? raw.gap_to_player_s : (prev?.gap_to_player_s ?? 0)
  const lastLap = isReasonableLapTime(raw.last_lap_ms) ? raw.last_lap_ms : (prev?.last_lap_ms ?? 0)
  const tyreCompound = raw.tyre_compound || prev?.tyre_compound || 'C3'

  return {
    ...raw,
    gap_to_player_s: gap,
    last_lap_ms: lastLap,
    tyre_compound: tyreCompound,
    stintLap: Number.isFinite(raw.stint_lap) ? Number(raw.stint_lap) : prev?.stintLap,
    tyreWearPct: Number.isFinite(raw.tyre_wear_pct) ? Number(raw.tyre_wear_pct) : prev?.tyreWearPct,
    pitWindowOpen: typeof raw.pit_window_open === 'boolean' ? raw.pit_window_open : prev?.pitWindowOpen,
    sectorMarks: toSectorMarks(raw.sector_marks) ?? prev?.sectorMarks,
  }
}

export function useStableLeaderboard(rows: AppState['leaderboard']): StableLeaderboardRow[] {
  const prevRef = useRef<PrevRowMap>(new Map())
  const nextMapRef = useRef<PrevRowMap>(new Map())

  const result = useMemo(() => {
    const sorted = [...rows].sort((a, b) => a.position - b.position).slice(0, 12)
    const nextMap: PrevRowMap = new Map()

    const stableRows = sorted.map((row) => {
      const prev = prevRef.current.get(row.car_index)
      const stable = stabilizeRow(row, prev)
      nextMap.set(row.car_index, stable)
      return stable
    })

    const normalizedRows = normalizeUniquePurple(stableRows)

    nextMapRef.current = nextMap
    return normalizedRows
  }, [rows])

  useEffect(() => {
    prevRef.current = nextMapRef.current
  })

  return result
}
