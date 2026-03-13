import { useEffect, useState } from 'react'
import { TopStatusPanel } from './components/TopStatusPanel'
import { MinimapPanel } from './components/MinimapPanel'
import { connectState } from './lib/ws'
import { AppState } from './lib/types'

export default function App() {
  const [status, setStatus] = useState('connecting')
  const [state, setState] = useState<AppState | null>(null)

  useEffect(() => {
    const ws = connectState(setState, setStatus)
    return () => ws.close()
  }, [])

  return (
    <main style={{ fontFamily: 'Segoe UI, sans-serif', background: '#0b0e13', minHeight: '100vh', color: '#f5f5f5' }}>
      <TopStatusPanel state={state} status={status} />
      <section style={{ padding: 12 }}>
        <h2>Player Car</h2>
        <div>Position: {state?.player.position ?? '-'}</div>
        <div>Lap: {state?.player.lap ?? '-'}</div>
        <div>Tyre: {state?.player.tyre_compound ?? '-'}</div>
        <div>Fuel: {state?.player.fuel?.toFixed(2) ?? '-'}</div>
        <div>ERS: {state?.player.ers?.toFixed(2) ?? '-'}</div>
        <h3>Ingest</h3>
        <div>Received: {state?.ingest_stats.packets_received ?? 0}</div>
        <div>Decoded: {state?.ingest_stats.packets_decoded ?? 0}</div>
        <div>Dropped: {state?.ingest_stats.packets_dropped ?? 0}</div>
        <div>Last Event: {state?.last_event_summary ?? '-'}</div>

        <MinimapPanel state={state} />
      </section>
    </main>
  )
}
