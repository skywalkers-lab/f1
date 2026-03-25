export type GapMode = 'player' | 'leader' | 'interval'

type GapRow = {
  car_index: number
  position: number
  gap_to_player_s: number
}

export type GapMetrics = {
  gapToPlayer: number
  gapToLeader: number
  intervalAhead: number
}

const MAX_REASONABLE_GAP_S = 180

function sanitizeGap(value: number, fallback = 0): number {
  if (!Number.isFinite(value)) return fallback
  if (Math.abs(value) > MAX_REASONABLE_GAP_S) return fallback
  return value
}

export function buildGapMetrics(rows: GapRow[]): Map<number, GapMetrics> {
  const sorted = [...rows].sort((a, b) => a.position - b.position)
  const leaderGapToPlayer = sorted.length > 0 ? sanitizeGap(sorted[0].gap_to_player_s, 0) : 0
  const metrics = new Map<number, GapMetrics>()

  sorted.forEach((row, index) => {
    const gapToPlayer = sanitizeGap(row.gap_to_player_s, 0)
    const gapToLeader = sanitizeGap(gapToPlayer - leaderGapToPlayer, 0)

    let intervalAhead = 0
    if (index > 0) {
      const ahead = sorted[index - 1]
      const aheadGap = sanitizeGap(ahead.gap_to_player_s, 0)
      intervalAhead = Math.abs(sanitizeGap(gapToPlayer - aheadGap, 0))
    }

    metrics.set(row.car_index, {
      gapToPlayer,
      gapToLeader,
      intervalAhead,
    })
  })

  return metrics
}

export function gapForMode(mode: GapMode, metrics: GapMetrics, isLeader: boolean): number {
  if (mode === 'player') return metrics.gapToPlayer
  if (mode === 'leader') return isLeader ? 0 : Math.abs(metrics.gapToLeader)
  return isLeader ? 0 : metrics.intervalAhead
}

export function gapModeLabel(mode: GapMode): string {
  if (mode === 'leader') return '리더 기준'
  if (mode === 'interval') return '앞차 간격'
  return '플레이어 기준'
}

export function formatGap(gapS: number, mode: GapMode, isLeader: boolean): string {
  if (!Number.isFinite(gapS)) return '-'
  if (mode !== 'player' && isLeader) return 'LEADER'
  const sign = mode === 'player' && gapS > 0 ? '+' : ''
  return `${sign}${gapS.toFixed(3)}s`
}
