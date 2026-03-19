export type SessionMode = {
  mode: 'practice' | 'qualifying' | 'race' | 'unknown'
  label: string
  focus: string
}

const MAP: Record<number, SessionMode> = {
  0: { mode: 'unknown', label: 'UNKNOWN', focus: 'Awaiting session metadata' },
  1: { mode: 'practice', label: 'P1', focus: 'Baseline pace and tyre learning' },
  2: { mode: 'practice', label: 'P2', focus: 'Long-run fuel and degradation' },
  3: { mode: 'practice', label: 'P3', focus: 'Quali prep and final setup' },
  5: { mode: 'qualifying', label: 'Q1', focus: 'Traffic windows and banker laps' },
  6: { mode: 'qualifying', label: 'Q2', focus: 'Tyre commitment and cutline' },
  7: { mode: 'qualifying', label: 'Q3', focus: 'Final attack lap execution' },
  10: { mode: 'race', label: 'RACE', focus: 'Stint strategy and overcut/undercut' },
}

export function deriveSessionMode(sessionType?: string): SessionMode {
  const id = Number((sessionType ?? '').replace(/\D/g, ''))
  return MAP[id] ?? MAP[0]
}
