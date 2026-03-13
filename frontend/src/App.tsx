import { useEffect, useState } from 'react'
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

export default function App() {
  const [status, setStatus] = useState('connecting')
  const [state, setState] = useState<AppState | null>(null)

  useEffect(() => {
    const ws = connectState(setState, setStatus)
    return () => ws.close()
  }, [])

  return (
    <main className="app-shell">
      <TopStatusPanel state={state} status={status} />
      <section className="command-grid">
        <div className="column">
          <MinimapPanel state={state} />
          <LeaderboardPanel state={state} />
        </div>
        <div className="column">
          <PaceAnalysisPanel state={state} />
          <BattleControlsPanel state={state} />
        </div>
        <div className="column">
          <TyreEngineeringPanel state={state} />
          <StrategyHealthPanel state={state} />
        </div>
      </section>
    </main>
  )
}
