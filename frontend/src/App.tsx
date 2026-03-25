import { useEffect, useMemo, useRef, useState } from 'react'
import { connectState } from './lib/ws'
import { AppState } from './lib/types'
import { evaluateRaceState } from './lib/dashboardMetrics'
import { HeaderBar, type NavTab } from './components/HeaderBar'
import { SidebarNav, type SidebarId } from './components/SidebarNav'
import { TimingTower } from './components/TimingTower'
import { EventLog } from './components/EventLog'
import { TrackMapPanel } from './components/TrackMapPanel'
import { StrategyPanel } from './components/StrategyPanel'
import { RaceControlBanner } from './components/RaceControlBanner'
import { BottomBar } from './components/BottomBar'
import { TelemetryView } from './components/TelemetryView'
import { AnalysisView } from './components/AnalysisView'
import { ReplayView } from './components/ReplayView'
import { TrackView } from './components/TrackView'
import { WeatherView } from './components/WeatherView'
import { RadioView } from './components/RadioView'
import { SettingsModal } from './components/SettingsModal'
import { useUnifiedStrategy } from './hooks/useUnifiedStrategy'
import './styles.css'

const TAB_TO_SIDEBAR: Record<NavTab, SidebarId> = {
  STRATEGY: 'strategy',
  TELEMETRY: 'live',
  ANALYSIS: 'timing',
  TRACK: 'track',
  WEATHER: 'weather',
  RADIO: 'radio',
  REPLAY: 'system',
}

const SIDEBAR_TO_TAB: Record<SidebarId, NavTab> = {
  strategy: 'STRATEGY',
  live: 'TELEMETRY',
  timing: 'ANALYSIS',
  track: 'TRACK',
  weather: 'WEATHER',
  radio: 'RADIO',
  system: 'REPLAY',
}

function useCadencedState<T>(value: T, ms: number): T {
  const [cadenced, setCadenced] = useState<T>(value)
  const ref = useRef(value)
  ref.current = value
  useEffect(() => {
    const id = setInterval(() => setCadenced(ref.current), ms)
    return () => clearInterval(id)
  }, [ms])
  return cadenced
}

export default function App() {
  const [status, setStatus] = useState('connecting')
  const [state, setState] = useState<AppState | null>(null)
  const [activeTab, setActiveTab] = useState<NavTab>('STRATEGY')
  const [sidebarId, setSidebarId] = useState<SidebarId>('strategy')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [connectionVersion, setConnectionVersion] = useState(0)

  useEffect(() => {
    const disconnect = connectState(setState, setStatus)
    return () => disconnect()
  }, [connectionVersion])

  const fastState = useCadencedState(state, 100)
  const mediumState = useCadencedState(state, 400)
  const evaluation = useMemo(() => evaluateRaceState(state, status), [state, status])
  const mcDecision = useUnifiedStrategy(mediumState)

  // Sync sidebar with tab
  const handleTabChange = (tab: NavTab) => {
    setActiveTab(tab)
    setSidebarId(TAB_TO_SIDEBAR[tab])
  }

  const handleSidebarChange = (id: SidebarId) => {
    setSidebarId(id)
    setActiveTab(SIDEBAR_TO_TAB[id])
  }

  const renderMainContent = () => {
    switch (activeTab) {
      case 'TELEMETRY':
        return (
          <div className="main-content single-column">
            <TelemetryView state={fastState} evaluation={evaluation} />
          </div>
        )
      case 'ANALYSIS':
        return (
          <div className="main-content single-column">
            <AnalysisView state={mediumState} evaluation={evaluation} />
          </div>
        )
      case 'REPLAY':
        return (
          <div className="main-content single-column">
            <ReplayView state={mediumState} status={status} evaluation={evaluation} />
          </div>
        )
      case 'TRACK':
        return (
          <div className="main-content single-column">
            <TrackView state={fastState} status={status} evaluation={evaluation} />
          </div>
        )
      case 'WEATHER':
        return (
          <div className="main-content single-column">
            <WeatherView state={mediumState} evaluation={evaluation} />
          </div>
        )
      case 'RADIO':
        return (
          <div className="main-content single-column">
            <RadioView state={mediumState} evaluation={evaluation} />
          </div>
        )
      case 'STRATEGY':
      default:
        return (
          <div className="main-content">
            {/* LEFT: Timing Tower + Event Log */}
            <div className="left-column">
              <TimingTower state={mediumState} />
              <EventLog state={mediumState} />
            </div>

            {/* CENTER: Track Map */}
            <div className="center-column">
              <TrackMapPanel state={fastState} />
            </div>

            {/* RIGHT: Strategy + Telemetry */}
            <div className="right-column">
              <StrategyPanel state={mediumState} evaluation={evaluation} mcDecision={mcDecision} />
            </div>
          </div>
        )
    }
  }

  return (
    <main className="app-shell">
      <HeaderBar state={state} status={status} evaluation={evaluation} activeTab={activeTab} onTabChange={handleTabChange} onSettingsToggle={() => setSettingsOpen(true)} />
      <SidebarNav activeId={sidebarId} onSelect={handleSidebarChange} />

      {renderMainContent()}

      <RaceControlBanner state={state} />
      <BottomBar state={fastState} evaluation={evaluation} />
      <SettingsModal
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onConnectionApplied={() => setConnectionVersion((prev) => prev + 1)}
      />
    </main>
  )
}
