/**
 * TelemetryStore — Central state management for the F1 pit wall frontend.
 *
 * Inspired by pits-n-giggles' frontend architecture where a central store
 * normalizes and distributes telemetry data to all rendering consumers.
 *
 * Architecture:
 *   WebSocket → Normalizer → Store → Subscribers (React hooks)
 *
 * Features:
 *   • Pub/Sub: subscribe(listener) → unsubscribe
 *   • Partial updates: setState(partial) merges into state
 *   • Snapshot diffing: skip no-op updates when data hasn't changed
 *   • Connection tracking: connection status + staleness detection
 *   • Derived state: computed values auto-updated on change
 *   • Performance: batched notifications, RAF-aligned, timing metrics
 */

import type { AppState } from './types'

// ── Types ──────────────────────────────────────────────────────────────

export type StoreListener = (state: AppState, prevState: AppState | null) => void

export type StoreSelector<T> = (state: AppState) => T

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'stale'

export interface TelemetryStore {
  getState(): AppState | null
  setState(partial: Partial<AppState>): void
  replaceState(next: AppState): void
  subscribe(listener: StoreListener): () => void
  subscribeSelector<T>(selector: StoreSelector<T>, listener: (value: T) => void): () => void
  getMetrics(): StoreMetrics
  getConnectionStatus(): ConnectionStatus
  setConnectionStatus(status: ConnectionStatus): void
  getSessionUid(): string
}

export type StoreMetrics = {
  updates: number
  skippedUpdates: number
  subscribers: number
  lastUpdateAt: number
  batchedUpdates: number
  avgUpdateIntervalMs: number
  connectionStatus: ConnectionStatus
}

// ── Snapshot diff ──────────────────────────────────────────────────────

const DIFF_KEYS: ReadonlyArray<keyof AppState> = [
  'last_frame_identifier',
  'last_update_iso',
]

function snapshotChanged(prev: AppState | null, next: AppState): boolean {
  if (!prev) return true
  for (const key of DIFF_KEYS) {
    if (prev[key] !== next[key]) return true
  }
  return false
}

// ── Implementation ─────────────────────────────────────────────────────

export function createTelemetryStore(): TelemetryStore {
  let state: AppState | null = null
  let prevState: AppState | null = null
  let connectionStatus: ConnectionStatus = 'disconnected'
  const listeners = new Set<StoreListener>()
  let pendingNotify = false
  let rafId: number | null = null

  // Update interval tracking (rolling window, last 100 updates)
  const updateTimestamps: number[] = []
  const MAX_TIMESTAMPS = 100

  let metrics: StoreMetrics = {
    updates: 0,
    skippedUpdates: 0,
    subscribers: 0,
    lastUpdateAt: 0,
    batchedUpdates: 0,
    avgUpdateIntervalMs: 0,
    connectionStatus: 'disconnected',
  }

  function recordUpdateTime() {
    const now = performance.now()
    updateTimestamps.push(now)
    if (updateTimestamps.length > MAX_TIMESTAMPS) {
      updateTimestamps.shift()
    }
    metrics.lastUpdateAt = now
    if (updateTimestamps.length >= 2) {
      const span = updateTimestamps[updateTimestamps.length - 1] - updateTimestamps[0]
      metrics.avgUpdateIntervalMs = span / (updateTimestamps.length - 1)
    }
  }

  function notify() {
    if (!state) return
    const s = state
    const p = prevState
    listeners.forEach((fn) => {
      try {
        fn(s, p)
      } catch (e) {
        console.error('[TelemetryStore] listener error:', e)
      }
    })
    pendingNotify = false
  }

  function scheduleNotify() {
    if (pendingNotify) {
      metrics.batchedUpdates++
      return
    }
    pendingNotify = true
    if (rafId !== null) return
    rafId = requestAnimationFrame(() => {
      rafId = null
      notify()
    })
  }

  return {
    getState() {
      return state
    },

    setState(partial: Partial<AppState>) {
      if (!state) return
      prevState = state
      state = { ...state, ...partial }
      metrics.updates++
      recordUpdateTime()
      scheduleNotify()
    },

    replaceState(next: AppState) {
      if (!snapshotChanged(state, next)) {
        metrics.skippedUpdates++
        return
      }
      prevState = state
      state = next
      metrics.updates++
      recordUpdateTime()
      scheduleNotify()
    },

    subscribe(listener: StoreListener): () => void {
      listeners.add(listener)
      metrics.subscribers = listeners.size
      return () => {
        listeners.delete(listener)
        metrics.subscribers = listeners.size
      }
    },

    subscribeSelector<T>(
      selector: StoreSelector<T>,
      listener: (value: T) => void,
    ): () => void {
      let lastValue: T | undefined
      const wrappedListener: StoreListener = (s) => {
        const nextValue = selector(s)
        if (nextValue !== lastValue) {
          lastValue = nextValue
          listener(nextValue)
        }
      }
      return this.subscribe(wrappedListener)
    },

    getMetrics() {
      return { ...metrics, connectionStatus }
    },

    getConnectionStatus() {
      return connectionStatus
    },

    setConnectionStatus(status: ConnectionStatus) {
      connectionStatus = status
      metrics.connectionStatus = status
    },

    getSessionUid(): string {
      return state?.session_uid ?? '0'
    },
  }
}

// ── Singleton ──────────────────────────────────────────────────────────

let _globalStore: TelemetryStore | null = null

export function getStore(): TelemetryStore {
  if (!_globalStore) {
    _globalStore = createTelemetryStore()
  }
  return _globalStore
}
