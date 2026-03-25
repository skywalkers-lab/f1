import { memo } from 'react'
import { AppState } from '../lib/types'
import { formatRaceControl, raceControlTone } from '../lib/f1Terms'

type Props = { state: AppState | null }

export const RaceControlBanner = memo(function RaceControlBanner({ state }: Props) {
  const raceControl = state?.race_control_state ?? 'GREEN'
  const tone = raceControlTone(raceControl)
  const badgeClass = tone === 'green' ? 'is-green' : tone === 'yellow' || tone === 'vsc' ? 'is-yellow' : tone === 'sc' ? 'is-sc' : tone === 'red' ? 'is-red' : 'is-green'

  const drsEnabled = !!state?.player?.drs_enabled
  const eventSummary = state?.last_event_summary || ''

  // Compose message
  let message = formatRaceControl(raceControl)
  if (drsEnabled) message = 'DRS ENABLED SECTOR 1 & 3'
  if (eventSummary) message += ` -- ${eventSummary.toUpperCase()}`

  return (
    <div className="race-control-banner">
      <span className={`rc-badge ${badgeClass}`}>RACE<br/>CONTROL</span>
      <span className="rc-message">{message}</span>
    </div>
  )
})
