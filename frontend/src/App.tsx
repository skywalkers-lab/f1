import { useEffect, useMemo, useState } from 'react'
import { TopStatusPanel } from './components/TopStatusPanel'
import { MinimapPanel } from './components/MinimapPanel'
import { LeaderboardPanel } from './components/LeaderboardPanel'
import { PaceAnalysisPanel } from './components/PaceAnalysisPanel'
import { BattleControlsPanel } from './components/BattleControlsPanel'
import { TyreEngineeringPanel } from './components/TyreEngineeringPanel'
import { StrategyHealthPanel } from './components/StrategyHealthPanel'
import { connectState } from './lib/ws'
import { AppState } from './lib/types'
import { deriveSessionMode } from './lib/sessionMode'
import './styles.css'

function useCadencedState<T>(value: T, ms: number): T {
  const [cadenced, setCadenced] = useState<T>(value)
  useEffect(() => {
    const id = setInterval(() => setCadenced(value), ms)
    return () => clearInterval(id)
  }, [value, ms])
  return cadenced
}

export default function App() {
  const [status, setStatus] = useState('connecting')
  const [state, setState] = useState<AppState | null>(null)

  useEffect(() => {
    const disconnect = connectState(setState, setStatus)
    return () => disconnect()
  }, [])

  const fastState = useCadencedState(state, 100)
  const mediumState = useCadencedState(state, 400)

  const memoTop = useMemo(() => fastState, [fastState])
  const sessionMode = deriveSessionMode(state?.session_type)

  return (
    <main className={`app-shell mode-${sessionMode.mode}`}>
      <div className="background-grid" aria-hidden="true" />
      <header className="top-zone">
        <TopStatusPanel state={memoTop} status={status} />
      </header>

      <section className="command-grid">
        <aside className="utility-rail panel telemetry-frame">
          <h3>Mission Feed</h3>
          <div className="reason-list">
            <div className="reason-line">Session: {sessionMode.label}</div>
            <div className="reason-line">Focus: {sessionMode.focus}</div>
            <div className="reason-line">Track: {state?.track ?? 'UNKNOWN'}</div>
            <div className="reason-line">Weather: {state?.weather_state ?? 'WEATHER_0'}</div>
            <div className="reason-line">Event: {state?.last_event_summary || 'No current event'}</div>
          </div>
        </aside>

        <div className="zone zone-left">
          <MinimapPanel state={fastState} />
          <LeaderboardPanel state={mediumState} />
        </div>
        <div className="zone zone-mid">
          <PaceAnalysisPanel state={mediumState} />
          <BattleControlsPanel state={fastState} />
        </div>
        <div className="zone zone-right">
          <TyreEngineeringPanel state={mediumState} />
          <StrategyHealthPanel state={mediumState} />
        </div>
      </section>
    </main>
  )
}
