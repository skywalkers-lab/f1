import { AppState } from '../lib/types'
import { deriveSessionMode } from '../lib/sessionMode'

type Props = { state: AppState | null; status: string }

export function TopStatusPanel({ state, status }: Props) {
  const session = deriveSessionMode(state?.session_type)
  const updated = state?.last_update_iso ? new Date(state.last_update_iso).toLocaleTimeString() : '-'

  return (
    <div className="panel telemetry-frame status-grid">
      <div className="status-cell"><div className="label">Link</div><div className="value">{status.toUpperCase()}</div></div>
      <div className="status-cell"><div className="label">Session</div><div className="value">{session.label}</div></div>
      <div className="status-cell"><div className="label">Track</div><div className="value">{state?.track ?? 'UNKNOWN'}</div></div>
      <div className="status-cell"><div className="label">Race Ctrl</div><div className="value">{state?.race_control_state ?? 'GREEN'}</div></div>
      <div className="status-cell"><div className="label">Focus</div><div className="value" style={{ fontSize: 11 }}>{session.focus}</div></div>
      <div className="status-cell"><div className="label">Frame</div><div className="value">{state?.last_frame_identifier ?? '-'}</div></div>
      <div className="status-cell"><div className="label">Packet</div><div className="value">{state?.ingest_stats.last_packet_type ?? '-'}</div></div>
      <div className="status-cell"><div className="label">Decoded</div><div className="value">{state?.ingest_stats.packets_decoded ?? 0}</div></div>
      <div className="status-cell"><div className="label">Dropped</div><div className="value">{state?.ingest_stats.packets_dropped ?? 0}</div></div>
      <div className="status-cell"><div className="label">Dup / Err</div><div className="value">{state?.ingest_stats.duplicate_packets ?? 0}/{state?.ingest_stats.decode_errors ?? 0}</div></div>
      <div className="status-cell"><div className="label">Updated</div><div className="value" style={{ fontSize: 11 }}>{updated}</div></div>
    </div>
  )
}
