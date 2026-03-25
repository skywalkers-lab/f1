// #48 — Offline demo packs by track with deterministic playback
// #49 — Batch export to CSV/Parquet for data science workflows

// ═══════════════════════════════════════════════════════════════
// #48: Offline demo packs
// ═══════════════════════════════════════════════════════════════

export type DemoFrame = {
  frameId: number
  timestampOffset: number  // ms from session start
  payload: Record<string, unknown>
}

export type DemoPack = {
  trackId: number
  trackName: string
  sessionType: 'race' | 'qualifying' | 'practice'
  totalLaps: number
  totalFrames: number
  durationMs: number
  frames: DemoFrame[]
}

/**
 * Capture running session state into a demo pack.
 * Call addFrame() each tick; finalize with build().
 */
export class DemoPackRecorder {
  private _trackId: number
  private _trackName: string
  private _sessionType: DemoPack['sessionType']
  private _totalLaps: number
  private _frames: DemoFrame[] = []
  private _startTime = 0

  constructor(trackId: number, trackName: string, sessionType: DemoPack['sessionType'], totalLaps: number) {
    this._trackId = trackId
    this._trackName = trackName
    this._sessionType = sessionType
    this._totalLaps = totalLaps
    this._startTime = Date.now()
  }

  addFrame(payload: Record<string, unknown>): void {
    this._frames.push({
      frameId: this._frames.length,
      timestampOffset: Date.now() - this._startTime,
      payload,
    })
  }

  build(): DemoPack {
    const duration = this._frames.length > 0
      ? this._frames[this._frames.length - 1].timestampOffset
      : 0
    return {
      trackId: this._trackId,
      trackName: this._trackName,
      sessionType: this._sessionType,
      totalLaps: this._totalLaps,
      totalFrames: this._frames.length,
      durationMs: duration,
      frames: this._frames,
    }
  }
}

/**
 * Deterministic playback engine for demo packs.
 * Emits frames at recorded offsets via callback.
 */
export class DemoPackPlayer {
  private _pack: DemoPack
  private _cursor = 0
  private _timer: ReturnType<typeof setTimeout> | null = null
  private _onFrame: (frame: DemoFrame) => void
  private _onComplete: () => void
  private _speed: number

  constructor(
    pack: DemoPack,
    onFrame: (frame: DemoFrame) => void,
    onComplete: () => void,
    speed = 1.0,
  ) {
    this._pack = pack
    this._onFrame = onFrame
    this._onComplete = onComplete
    this._speed = Math.max(0.1, Math.min(10, speed))
  }

  start(): void {
    this._cursor = 0
    this._scheduleNext()
  }

  stop(): void {
    if (this._timer) clearTimeout(this._timer)
    this._timer = null
  }

  setSpeed(speed: number): void {
    this._speed = Math.max(0.1, Math.min(10, speed))
  }

  seekToFrame(frameId: number): void {
    this._cursor = Math.max(0, Math.min(this._pack.frames.length - 1, frameId))
  }

  get progress(): number {
    return this._pack.totalFrames > 0 ? this._cursor / this._pack.totalFrames : 0
  }

  private _scheduleNext(): void {
    if (this._cursor >= this._pack.frames.length) {
      this._onComplete()
      return
    }

    const frame = this._pack.frames[this._cursor]
    this._onFrame(frame)
    this._cursor++

    if (this._cursor < this._pack.frames.length) {
      const nextFrame = this._pack.frames[this._cursor]
      const delay = (nextFrame.timestampOffset - frame.timestampOffset) / this._speed
      this._timer = setTimeout(() => this._scheduleNext(), Math.max(1, delay))
    } else {
      this._onComplete()
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// #49: Batch export to CSV/Parquet
// ═══════════════════════════════════════════════════════════════

export type ExportFormat = 'csv' | 'json'
// Note: true Parquet requires a binary encoder; we provide CSV/JSON from frontend
// and delegate Parquet conversion to the backend endpoint.

type ExportableRow = Record<string, string | number | boolean | null>

/**
 * Export an array of flat objects to CSV string.
 */
export function exportToCSV(rows: ExportableRow[], columns?: string[]): string {
  if (rows.length === 0) return ''
  const cols = columns ?? Object.keys(rows[0])
  const header = cols.join(',')
  const lines = rows.map(row =>
    cols.map(c => {
      const val = row[c]
      if (val == null) return ''
      if (typeof val === 'string') return `"${val.replace(/"/g, '""')}"`
      return String(val)
    }).join(',')
  )
  return [header, ...lines].join('\n')
}

/**
 * Export rows as JSON lines (NDJSON).
 */
export function exportToJSON(rows: ExportableRow[]): string {
  return rows.map(r => JSON.stringify(r)).join('\n')
}

/**
 * Trigger a browser download of exported data.
 */
export function downloadExport(data: string, filename: string, mimeType = 'text/csv'): void {
  const blob = new Blob([data], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * Convert leaderboard state to flat exportable rows.
 */
export function leaderboardToExportRows(
  leaderboard: Array<Record<string, unknown>>,
  lap: number,
  sessionTime: number,
): ExportableRow[] {
  return leaderboard.map(row => ({
    lap,
    session_time: sessionTime,
    position: row.position as number,
    driver_code: row.driver_code as string,
    car_index: row.car_index as number,
    gap_to_leader_s: row.gap_to_leader_s as number ?? null,
    gap_to_player_s: row.gap_to_player_s as number ?? null,
    last_lap_ms: row.last_lap_ms as number ?? null,
    best_lap_ms: row.best_lap_ms as number ?? null,
    tyre_compound: row.tyre_compound as string ?? null,
    tyre_wear_pct: row.tyre_wear_pct as number ?? null,
    is_pitting: row.is_pitting as boolean ?? false,
    stint_lap: row.stint_lap as number ?? null,
  }))
}
