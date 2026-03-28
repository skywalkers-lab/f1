// #19 — Session change auto-reset debounce in frontend
//
// Detects when session_uid changes and debounces the reset so that
// transient flickers (e.g. replay boundary) don't cause full resets.

import { useEffect, useRef, useCallback } from 'react'
import type { AppState } from '../lib/types'

const DEBOUNCE_MS = 1500

/**
 * Hook that fires `onReset` when session UID changes, debounced.
 */
export function useSessionResetDebounce(
  state: AppState | null,
  onReset: (newUid: string, oldUid: string) => void,
) {
  const prevUid = useRef<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stableOnReset = useCallback(onReset, [onReset])

  useEffect(() => {
    if (!state) return
    const uid = state.session_uid

    if (prevUid.current === null) {
      prevUid.current = uid
      return
    }

    if (uid !== prevUid.current) {
      const oldUid = prevUid.current
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        // Confirm the UID is still different after debounce
        stableOnReset(uid, oldUid)
        prevUid.current = uid
      }, DEBOUNCE_MS)
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [state?.session_uid, stableOnReset])
}
