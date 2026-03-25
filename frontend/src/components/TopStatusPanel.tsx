import { memo } from 'react'
import { AppState } from '../lib/types'
import { deriveSessionMode } from '../lib/sessionMode'
import { formatRaceControl, formatSessionCode, formatWeatherState, raceControlTone } from '../lib/f1Terms'
import { formatStateAge, RaceStateSnapshot } from '../lib/dashboardMetrics'

type Props = { state: AppState | null; status: string; evaluation: RaceStateSnapshot }

export const TopStatusPanel = memo(function TopStatusPanel({ state, status, evaluation }: Props) {
  const session = deriveSessionMode(state?.session_type)
  const updated = state?.last_update_iso ? new Date(state.last_update_iso).toLocaleTimeString() : '-'
  const ageMs = evaluation.stateAgeMs
  const connectionTone = evaluation.connectionTone
  const feedHealth = evaluation.feedHealth
  const sessionProgress = evaluation.sessionProgressPct
  const linkClass = connectionTone === 'live' ? 'status-ok' : connectionTone === 'stale' ? 'status-warn' : 'status-critical'
  const statusLabel =
    status === 'connected'
      ? connectionTone === 'stale'
        ? '지연 중'
        : '연결됨'
      : status === 'connecting'
        ? '연결 중'
        : status === 'error'
          ? '오류'
          : '끊김'
  const raceControl = state?.race_control_state ?? 'GREEN'
  const raceTone = raceControlTone(raceControl)
  const lapLabel = state ? `L${state.player.lap}/${state.total_laps}` : '-'
  const positionLabel = state ? `P${state.player.position}` : '-'
  const decodeLabel = `${state?.ingest_stats.packets_decoded ?? 0}/${state?.ingest_stats.packets_dropped ?? 0}`
  const errorLabel = `${state?.ingest_stats.duplicate_packets ?? 0}/${state?.ingest_stats.decode_errors ?? 0}`
  const trackLabel = state?.track ?? 'UNKNOWN'
  const weatherLabel = formatWeatherState(state?.weather_state)

  return (
    <div className="panel telemetry-frame status-grid">
      <div className={`status-cell status-cell-primary ${linkClass}`}>
        <div className="label">LIVE LINK</div>
        <div className="value">{statusLabel}</div>
        <div className="small">업데이트 {updated} · {formatStateAge(ageMs)}</div>
      </div>

      <div className="status-cell status-cell-primary">
        <div className="label">RACE CTRL</div>
        <div className={`race-control-pill is-${raceTone}`}>{formatRaceControl(raceControl)}</div>
        <div className="small">{session.focus}</div>
      </div>

      <div className="status-cell status-cell-emphasis">
        <div className="label">POSITION</div>
        <div className="value">{positionLabel}</div>
      </div>

      <div className="status-cell status-cell-emphasis">
        <div className="label">LAP</div>
        <div className="value">{lapLabel}</div>
      </div>

      <div className="status-cell">
        <div className="label">SESSION</div>
        <div className="value">{formatSessionCode(state?.session_type)}</div>
        <div className="small">{session.label}</div>
      </div>

      <div className="status-cell">
        <div className="label">TRACK / WEATHER</div>
        <div className="value">{trackLabel}</div>
        <div className="small">{weatherLabel}</div>
      </div>

      <div className="status-cell">
        <div className="label">FRAME / PACKET</div>
        <div className="value">{state?.last_frame_identifier ?? '-'}</div>
        <div className="small">{state?.ingest_stats.last_packet_type ?? '-'}</div>
      </div>

      <div className="status-cell">
        <div className="label">DECODE / DROP</div>
        <div className="value">{decodeLabel}</div>
        <div className="small">피드 {feedHealth.score}% · 신뢰 {evaluation.dataReliability.label}</div>
      </div>

      <div className="status-cell">
        <div className="label">DUP / ERROR</div>
        <div className="value">{errorLabel}</div>
        <div className="small">진행 {sessionProgress.toFixed(0)}% · 액션 {evaluation.recommendedActionState.call}</div>
      </div>
    </div>
  )
})
