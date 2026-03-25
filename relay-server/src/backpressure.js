// #15 — Backpressure-aware relay fanout queue with bounded memory
//
// Each viewer gets a bounded outbound queue. If a viewer can't keep up,
// frames are dropped (latest-wins) instead of saturating the send buffer.

const DEFAULT_MAX_QUEUE = 64
const DEFAULT_HIGH_WATER = 48

export class BackpressureQueue {
  /**
   * @param {import('ws').WebSocket} ws
   * @param {{ maxQueue?: number, highWater?: number }} opts
   */
  constructor(ws, opts = {}) {
    this.ws = ws
    this.maxQueue = opts.maxQueue ?? DEFAULT_MAX_QUEUE
    this.highWater = opts.highWater ?? DEFAULT_HIGH_WATER
    this.queue = []
    this.draining = false
    this.dropped = 0
    this.sent = 0
  }

  /** Enqueue a pre-serialized frame. Drops oldest if over limit. */
  enqueue(serialized) {
    if (this.ws.readyState !== this.ws.OPEN) return

    if (this.queue.length >= this.maxQueue) {
      // Drop oldest non-critical frames to stay bounded
      const toDrop = this.queue.length - this.highWater
      if (toDrop > 0) {
        this.queue.splice(0, toDrop)
        this.dropped += toDrop
      }
    }

    this.queue.push(serialized)
    this._drain()
  }

  _drain() {
    if (this.draining) return
    this.draining = true

    const flush = () => {
      while (this.queue.length > 0) {
        if (this.ws.readyState !== this.ws.OPEN) {
          this.queue.length = 0
          break
        }

        // Check Node.js ws bufferedAmount — if too high, pause and retry
        if (this.ws.bufferedAmount > 128 * 1024) {
          setTimeout(flush, 4)
          return
        }

        const frame = this.queue.shift()
        try {
          this.ws.send(frame)
          this.sent++
        } catch {
          // connection lost mid-drain — discard rest
          this.queue.length = 0
        }
      }
      this.draining = false
    }

    flush()
  }

  stats() {
    return {
      queued: this.queue.length,
      dropped: this.dropped,
      sent: this.sent,
      bufferedBytes: this.ws.bufferedAmount ?? 0,
    }
  }
}

/**
 * Wrap fanout: create a BackpressureQueue per viewer, fanout through it.
 * @param {Set<import('ws').WebSocket>} viewerSet
 * @returns {Map<import('ws').WebSocket, BackpressureQueue>}
 */
export function createFanoutMap(viewerSet) {
  const map = new Map()
  for (const ws of viewerSet) {
    if (!map.has(ws)) {
      map.set(ws, new BackpressureQueue(ws))
    }
  }
  return map
}
