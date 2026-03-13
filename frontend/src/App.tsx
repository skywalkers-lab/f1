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
  const slowState = useCadencedState(state, 1000)

  const memoTop = useMemo(() => fastState, [fastState])

  return (
    <main className="app-shell">
      <TopStatusPanel state={memoTop} status={status} />
      <section className="command-grid">
        <div className="column">
          <MinimapPanel state={fastState} />
          <LeaderboardPanel state={mediumState} />
        </div>
        <div className="column">
          <PaceAnalysisPanel state={mediumState} />
          <BattleControlsPanel state={fastState} />
        </div>
        <div className="column">
          <TyreEngineeringPanel state={mediumState} />
          <StrategyHealthPanel state={slowState} />
        </div>
      </section>
    </main>
  )
}
