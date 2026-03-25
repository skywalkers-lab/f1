import { useEffect, useRef, useState } from 'react'
import { AppState } from '../lib/types'
import { TyreHistory, TyreHistoryManager } from '../lib/tyreHistoryManager'

export function useTyreHistory(state: AppState | null): TyreHistory {
  const managerRef = useRef(new TyreHistoryManager())
  const [snapshot, setSnapshot] = useState<TyreHistory>({})

  useEffect(() => {
    if (!state) return
    managerRef.current.ingest(state, Date.now())
    setSnapshot(managerRef.current.snapshot())
  }, [state?.last_frame_identifier])

  return snapshot
}