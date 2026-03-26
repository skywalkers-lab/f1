import { memo } from 'react'
import { AppState } from '../lib/types'
import { formatStateAge, RaceStateSnapshot } from '../lib/dashboardMetrics'
import { deriveSessionMode } from '../lib/sessionMode'

export type NavTab = 'STRATEGY' | 'TELEMETRY' | 'ANALYSIS' | 'REPLAY' | 'TRACK' | 'WEATHER' | 'RADIO'

type Props = {
  state: AppState | null
  status: string
  evaluation: RaceStateSnapshot
  activeTab: NavTab
  onTabChange: (tab: NavTab) => void
  onSettingsToggle?: () => void
}

const NAV_TABS: NavTab[] = ['STRATEGY', 'TELEMETRY', 'ANALYSIS', 'TRACK', 'WEATHER', 'RADIO', 'REPLAY']

export const HeaderBar = memo(function HeaderBar({ state, status, evaluation, activeTab, onTabChange, onSettingsToggle }: Props) {
  const session = deriveSessionMode(state?.session_type)
  const connectionTone = evaluation.connectionTone
  const dotClass = connectionTone === 'live' ? '' : connectionTone === 'stale' ? 'is-warn' : 'is-down'
  const qualityClass = evaluation.feedHealth.tone === 'good' ? 'is-ok' : evaluation.feedHealth.tone === 'warn' ? 'is-warn' : 'is-critical'
  const statusText =
    status === 'connected'
      ? connectionTone === 'stale' ? 'STALE' : 'LIVE'
      : status === 'connecting' ? 'CONNECTING' : status === 'error' ? 'ERROR' : 'OFFLINE'
  const ageText = formatStateAge(evaluation.stateAgeMs)

  const flagState = state?.race_control_state ?? 'GREEN'
  // SC_0 = green, SC_1 = yellow, SC_2 = VSC, SC_3 = SC
  const scNum = parseInt(flagState.replace('SC_', ''), 10)
  const isYellow = !isNaN(scNum) ? scNum > 0 : flagState.includes('YELLOW') || flagState === 'VSC'

  const flagLabel = (() => {
    if (!isNaN(scNum)) {
      if (scNum >= 3) return 'SAFETY CAR'
      if (scNum === 2) return 'VIRTUAL SAFETY CAR'
      if (scNum === 1) return 'YELLOW FLAG'
      return ''
    }
    if (flagState.includes('RED')) return 'RED FLAG'
    if (flagState === 'VSC') return 'VIRTUAL SAFETY CAR'
    if (flagState.includes('YELLOW')) return 'YELLOW FLAG'
    return flagState
  })()

  return (
    <header className="top-header">
      <span className="header-brand">PIT_WALL_COMMAND</span>

      <nav className="header-nav">
        {NAV_TABS.map((tab) => (
          <button key={tab} type="button" className={`header-nav-btn ${tab === activeTab ? 'is-active' : ''}`} onClick={() => onTabChange(tab)}>
            {tab}
          </button>
        ))}
      </nav>

      <span className="header-spacer" />

      <span className="header-live-badge">
        {isYellow && (
          <span className="header-flag-alert">
            {flagLabel}
          </span>
        )}
        {!isYellow && session.label && (
          <span className="header-session-tag">
            {session.label}
          </span>
        )}
        <span className={`live-dot ${dotClass}`} />
        <span>{statusText}</span>
        <span className="header-feed-age">{ageText}</span>
        <span className={`header-feed-quality ${qualityClass}`}>{evaluation.feedHealth.score}%</span>
      </span>

      <span className="header-icons">
        {!window.pitwallDesktop && (
          <a href={`${import.meta.env.BASE_URL}download.html`} className="header-icon-btn header-download-btn" title="Download Desktop App" target="_blank" rel="noopener noreferrer">⬇ Desktop</a>
        )}
        <button type="button" className="header-icon-btn" aria-label="Settings" title="Settings" onClick={onSettingsToggle}>⚙</button>
      </span>
    </header>
  )
})
