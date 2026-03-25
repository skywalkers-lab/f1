// #16 — Bridge publish jitter monitor with adaptive Hz
// #17 — UDP packet loss estimator per packet type
// #18 — Out-of-order frame correction window in bridge
// #24 — Multi-source bridge merge with source quality scoring
// #25 — Dead-reckoning fallback for temporary position loss

/**
 * Jitter monitor: tracks publish intervals and adjusts Hz dynamically
 * to maintain smooth output even under uneven packet arrival.
 */
export class JitterMonitor {
  constructor(targetHz = 15) {
    this.targetHz = targetHz
    this.targetIntervalMs = 1000 / targetHz
    this.intervals = []
    this.maxSamples = 60
    this.lastPublishTs = 0
    this.adaptedHz = targetHz
  }

  recordPublish() {
    const now = Date.now()
    if (this.lastPublishTs > 0) {
      this.intervals.push(now - this.lastPublishTs)
      if (this.intervals.length > this.maxSamples) this.intervals.shift()
    }
    this.lastPublishTs = now
  }

  /** Get jitter stats and adapted Hz. */
  getStats() {
    if (this.intervals.length < 3) {
      return { avgIntervalMs: this.targetIntervalMs, jitterMs: 0, adaptedHz: this.targetHz }
    }
    const avg = this.intervals.reduce((a, b) => a + b, 0) / this.intervals.length
    const variance = this.intervals.reduce((s, v) => s + (v - avg) ** 2, 0) / this.intervals.length
    const jitter = Math.sqrt(variance)

    // If jitter is high, slow down slightly; if low, speed up toward target
    if (jitter > avg * 0.5) {
      this.adaptedHz = Math.max(5, this.targetHz * 0.8)
    } else if (jitter < avg * 0.15) {
      this.adaptedHz = Math.min(this.targetHz * 1.1, 30)
    } else {
      this.adaptedHz = this.targetHz
    }

    return {
      avgIntervalMs: Math.round(avg),
      jitterMs: Math.round(jitter),
      adaptedHz: Math.round(this.adaptedHz * 10) / 10,
    }
  }

  getAdaptedIntervalMs() {
    return Math.max(16, Math.round(1000 / this.adaptedHz))
  }
}

/**
 * Packet loss estimator: tracks received packet IDs per type
 * and estimates loss based on sequence gaps.
 */
export class PacketLossEstimator {
  constructor() {
    this.counters = new Map() // type -> { received, gaps, lastSeq, outOfOrder }
  }

  /**
   * @param {string} packetType
   * @param {number} frameId — monotonically increasing identifier
   */
  record(packetType, frameId) {
    if (!this.counters.has(packetType)) {
      this.counters.set(packetType, { received: 0, gaps: 0, lastSeq: -1, outOfOrder: 0 })
    }
    const c = this.counters.get(packetType)
    c.received++

    if (c.lastSeq >= 0) {
      const delta = frameId - c.lastSeq
      if (delta > 1) {
        c.gaps += delta - 1
      } else if (delta < 0) {
        c.outOfOrder++
      }
    }
    c.lastSeq = frameId
  }

  getStats() {
    const stats = {}
    for (const [type, c] of this.counters) {
      const total = c.received + c.gaps
      stats[type] = {
        received: c.received,
        estimated_lost: c.gaps,
        out_of_order: c.outOfOrder,
        loss_pct: total > 0 ? Math.round((c.gaps / total) * 10000) / 100 : 0,
      }
    }
    return stats
  }
}

/**
 * Out-of-order frame correction window.
 * Buffers a short window of frames and re-orders by frameId before
 * forwarding to the state builder.
 */
export class FrameCorrectionWindow {
  /**
   * @param {number} windowSize — max frames to buffer before forcing flush
   * @param {number} maxDelayMs — max time to hold a frame
   */
  constructor(windowSize = 4, maxDelayMs = 50) {
    this.windowSize = windowSize
    this.maxDelayMs = maxDelayMs
    this.buffer = []
    this.lastEmittedFrame = -1
    this.stats = { reordered: 0, passed: 0, forced: 0, duplicates: 0 }
  }

  /**
   * Insert a parsed packet; returns array of packets to process (in order).
   * @param {{ header: { frameIdentifier: number }, type: string, data: any }} parsed
   * @returns {Array}
   */
  insert(parsed) {
    const frameId = parsed.header?.frameIdentifier ?? -1

    // Duplicate detection
    if (frameId >= 0 && frameId <= this.lastEmittedFrame) {
      this.stats.duplicates++
      return []
    }

    this.buffer.push({ frameId, parsed, ts: Date.now() })
    this.buffer.sort((a, b) => a.frameId - b.frameId)

    return this._flush(false)
  }

  /** Force flush any frames older than maxDelayMs */
  forceFlush() {
    return this._flush(true)
  }

  _flush(force) {
    const now = Date.now()
    const emit = []

    while (this.buffer.length > 0) {
      const head = this.buffer[0]
      const isNext = head.frameId === this.lastEmittedFrame + 1 || this.lastEmittedFrame < 0
      const isOld = now - head.ts > this.maxDelayMs
      const isFull = this.buffer.length >= this.windowSize

      if (isNext) {
        // Perfect order — emit immediately
        emit.push(this.buffer.shift().parsed)
        this.lastEmittedFrame = head.frameId
        this.stats.passed++
      } else if (isOld || isFull || force) {
        // Forced emit — out of order was too late
        const item = this.buffer.shift()
        emit.push(item.parsed)
        this.lastEmittedFrame = Math.max(this.lastEmittedFrame, item.frameId)
        this.stats.forced++
      } else {
        break // wait for more frames
      }
    }

    return emit
  }

  getStats() {
    return { ...this.stats, buffered: this.buffer.length }
  }
}

/**
 * #24 Multi-source bridge merge with source quality scoring.
 * Tracks multiple bridge sources and picks the best quality one.
 */
export class SourceQualityScorer {
  constructor() {
    this.sources = new Map()
  }

  /**
   * @param {string} sourceId
   * @param {{ frameId: number, latencyMs?: number }} meta
   */
  recordFrame(sourceId, meta) {
    if (!this.sources.has(sourceId)) {
      this.sources.set(sourceId, {
        frames: 0,
        gaps: 0,
        lastFrameId: -1,
        lastTs: 0,
        avgLatencyMs: 0,
        score: 1.0,
      })
    }
    const src = this.sources.get(sourceId)
    src.frames++
    const now = Date.now()

    if (src.lastFrameId >= 0 && meta.frameId > src.lastFrameId + 1) {
      src.gaps += meta.frameId - src.lastFrameId - 1
    }

    if (meta.latencyMs != null) {
      src.avgLatencyMs = src.avgLatencyMs * 0.9 + meta.latencyMs * 0.1
    }

    const interval = now - src.lastTs
    src.lastFrameId = meta.frameId
    src.lastTs = now

    // Recalculate score: higher is better
    const lossPct = src.frames > 0 ? src.gaps / (src.frames + src.gaps) : 0
    const latencyPenalty = Math.min(1, src.avgLatencyMs / 500)
    const freshness = interval > 0 && interval < 200 ? 1 : Math.max(0, 1 - interval / 2000)
    src.score = Math.max(0, (1 - lossPct) * 0.4 + (1 - latencyPenalty) * 0.3 + freshness * 0.3)
  }

  /** Get the best source ID */
  getBestSource() {
    let best = null
    let bestScore = -1
    for (const [id, src] of this.sources) {
      if (src.score > bestScore) {
        bestScore = src.score
        best = id
      }
    }
    return best
  }

  getScores() {
    const out = {}
    for (const [id, src] of this.sources) {
      out[id] = {
        frames: src.frames,
        gaps: src.gaps,
        score: Math.round(src.score * 100) / 100,
        avgLatencyMs: Math.round(src.avgLatencyMs),
      }
    }
    return out
  }
}

/**
 * #25 Dead-reckoning fallback for temporary position loss.
 * When motion data stops for a car, predict position from last
 * known velocity for a short window.
 */
export class DeadReckoningFallback {
  constructor(maxPredictMs = 500) {
    this.maxPredictMs = maxPredictMs
    this.lastKnown = new Map() // carIndex -> { x, y, vx, vz, ts }
  }

  /**
   * Update with fresh position.
   * @param {number} carIndex
   * @param {{ x: number, y: number, vx?: number, vz?: number }} pos
   */
  update(carIndex, pos) {
    this.lastKnown.set(carIndex, {
      x: pos.x,
      y: pos.y,
      vx: pos.vx || 0,
      vz: pos.vz || 0,
      ts: Date.now(),
    })
  }

  /**
   * Get position — uses dead reckoning if stale.
   * @param {number} carIndex
   * @returns {{ x: number, y: number, predicted: boolean } | null}
   */
  getPosition(carIndex) {
    const last = this.lastKnown.get(carIndex)
    if (!last) return null

    const age = Date.now() - last.ts
    if (age < 20) {
      return { x: last.x, y: last.y, predicted: false }
    }
    if (age > this.maxPredictMs) {
      return { x: last.x, y: last.y, predicted: true }
    }

    // Linear dead reckoning
    const dtSec = age / 1000
    return {
      x: last.x + last.vx * dtSec,
      y: last.y + last.vz * dtSec,
      predicted: true,
    }
  }
}
