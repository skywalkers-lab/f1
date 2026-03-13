import { AppState } from '../lib/types'

type Props = { state: AppState | null; status: string }

export function TopStatusPanel({ state, status }: Props) {
  return (
    <div className="panel" style={{ display: 'grid', gridTemplateColumns: 'repeat(10, 1fr)', gap: 8 }}>
      <div><div className="label">Link</div><div className="value">{status.toUpperCase()}</div></div>
      <div><div className="label">Session</div><div className="value">{state?.session_type ?? 'UNKNOWN'}</div></div>
      <div><div className="label">Track</div><div className="value">{state?.track ?? 'UNKNOWN'}</div></div>
      <div><div className="label">Race Ctrl</div><div className="value">{state?.race_control_state ?? 'GREEN'}</div></div>
      <div><div className="label">Frame</div><div className="value">{state?.last_frame_identifier ?? '-'}</div></div>
      <div><div className="label">Pkt</div><div className="value">{state?.ingest_stats.last_packet_type ?? '-'}</div></div>
      <div><div className="label">Decoded</div><div className="value">{state?.ingest_stats.packets_decoded ?? 0}</div></div>
      <div><div className="label">Dropped</div><div className="value">{state?.ingest_stats.packets_dropped ?? 0}</div></div>
      <div><div className="label">Dup/Err</div><div className="value">{state?.ingest_stats.duplicate_packets ?? 0}/{state?.ingest_stats.decode_errors ?? 0}</div></div>
      <div><div className="label">Updated</div><div className="value" style={{ fontSize: 11 }}>{state?.last_update_iso ?? '-'}</div></div>
    </div>
  )
}
