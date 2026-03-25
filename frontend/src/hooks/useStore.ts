/**
 * useStore — React hook for subscribing to the TelemetryStore.
 *
 * Provides:
 *   • useStore() → full AppState with auto-rerender
 *   • useStoreSelector(selector) → optimized partial subscription
 *   • useStoreMetrics() → store diagnostic data
 */

import { useEffect, useRef, useSyncExternalStore } from 'react'
import type { AppState } from '../lib/types'
import { getStore, type TelemetryStore, type StoreSelector } from '../lib/store'

// ── Full state hook ────────────────────────────────────────────────────

let cachedState: AppState | null = null
const stateListeners = new Set<() => void>()

const store = getStore()
store.subscribe((s) => {
  cachedState = s
  stateListeners.forEach((fn) => fn())
})

/**
 * Subscribe to the full telemetry state.
 * Re-renders on every state change (throttled by store's RAF batching).
 */
export function useStore(): AppState | null {
  return useSyncExternalStore(
    (onStoreChange: () => void) => {
      stateListeners.add(onStoreChange)
      return () => stateListeners.delete(onStoreChange)
    },
    () => cachedState,
  )
}

// ── Selector hook ──────────────────────────────────────────────────────

/**
 * Subscribe to a derived slice of state.
 * Only re-renders when the selected value changes (referential equality).
 */
export function useStoreSelector<T>(selector: StoreSelector<T>): T | null {
  const selectorRef = useRef(selector)
  selectorRef.current = selector

  const cachedRef = useRef<T | null>(null)
  const listenersRef = useRef(new Set<() => void>())

  useEffect(() => {
    const unsub = store.subscribe((s) => {
      const next = selectorRef.current(s)
      if (next !== cachedRef.current) {
        cachedRef.current = next
        listenersRef.current.forEach((fn) => fn())
      }
    })
    return unsub
  }, [])

  return useSyncExternalStore(
    (onStoreChange: () => void) => {
      listenersRef.current.add(onStoreChange)
      return () => listenersRef.current.delete(onStoreChange)
    },
    () => cachedRef.current,
  )
}

// ── Metrics hook ───────────────────────────────────────────────────────

export function useStoreMetrics() {
  return store.getMetrics()
}
