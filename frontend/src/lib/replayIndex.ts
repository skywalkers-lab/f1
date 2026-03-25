// #28 — Replay scrubber with indexed frame seek map --
// Provides indexing of lap frames for efficient seek operations in replay mode

export type FrameIndexEntry = {
  lap: number
  timestamp: number  // epoch ms when frame arrived
  frameId: number
}

export type LapBookmark = {
  lap: number
  frameId: number
  timestamp: number
  note?: string
}

export class ReplayFrameIndex {
  private _index: FrameIndexEntry[] = []
  private _lapMap: Map<number, number> = new Map() // lap → first index into _index
  private _bookmarks: LapBookmark[] = []
  private _maxFrames: number

  constructor(maxFrames = 50000) {
    this._maxFrames = maxFrames
  }

  /**
   * Record a new frame into the seek index.
   */
  record(lap: number, frameId: number): void {
    const entry: FrameIndexEntry = { lap, timestamp: Date.now(), frameId }
    this._index.push(entry)

    if (!this._lapMap.has(lap)) {
      this._lapMap.set(lap, this._index.length - 1)
    }

    // Evict oldest frames if over budget
    if (this._index.length > this._maxFrames) {
      const removed = this._index.splice(0, 1000)
      // Rebuild lap map
      this._lapMap.clear()
      for (let i = 0; i < this._index.length; i++) {
        const l = this._index[i].lap
        if (!this._lapMap.has(l)) this._lapMap.set(l, i)
      }
      // Clean stale bookmarks
      const minFrame = this._index[0]?.frameId ?? 0
      this._bookmarks = this._bookmarks.filter(b => b.frameId >= minFrame)
    }
  }

  /**
   * Get the frame index entry closest to the given lap boundary.
   */
  seekToLap(lap: number): FrameIndexEntry | null {
    const idx = this._lapMap.get(lap)
    if (idx != null && idx < this._index.length) {
      return this._index[idx]
    }
    // Fallback: find closest
    let closest: FrameIndexEntry | null = null
    let minDist = Infinity
    for (const entry of this._index) {
      const d = Math.abs(entry.lap - lap)
      if (d < minDist) {
        minDist = d
        closest = entry
      }
    }
    return closest
  }

  /**
   * Binary search to find the frame closest to a given time ratio [0, 1].
   */
  seekToProgress(progress: number): FrameIndexEntry | null {
    if (this._index.length === 0) return null
    const t0 = this._index[0].timestamp
    const t1 = this._index[this._index.length - 1].timestamp
    const targetTime = t0 + (t1 - t0) * Math.max(0, Math.min(1, progress))

    let lo = 0
    let hi = this._index.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (this._index[mid].timestamp < targetTime) lo = mid + 1
      else hi = mid
    }
    return this._index[lo]
  }

  /**
   * Add a bookmark at a specific lap.
   */
  addBookmark(lap: number, note?: string): LapBookmark | null {
    const entry = this.seekToLap(lap)
    if (!entry) return null
    const bookmark: LapBookmark = {
      lap: entry.lap,
      frameId: entry.frameId,
      timestamp: entry.timestamp,
      note,
    }
    this._bookmarks.push(bookmark)
    return bookmark
  }

  removeBookmark(lap: number): void {
    this._bookmarks = this._bookmarks.filter(b => b.lap !== lap)
  }

  getBookmarks(): LapBookmark[] {
    return [...this._bookmarks]
  }

  /**
   * Returns all indexed laps for the scrubber tick marks.
   */
  getIndexedLaps(): number[] {
    return [...this._lapMap.keys()].sort((a, b) => a - b)
  }

  /**
   * Get overall index stats.
   */
  getStats(): { totalFrames: number; lapsIndexed: number; bookmarks: number; timeSpanMs: number } {
    return {
      totalFrames: this._index.length,
      lapsIndexed: this._lapMap.size,
      bookmarks: this._bookmarks.length,
      timeSpanMs: this._index.length > 1
        ? this._index[this._index.length - 1].timestamp - this._index[0].timestamp
        : 0,
    }
  }

  clear(): void {
    this._index = []
    this._lapMap.clear()
    this._bookmarks = []
  }
}
