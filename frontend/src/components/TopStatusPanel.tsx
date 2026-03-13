import { AppState } from '../lib/types'

type Props = { state: AppState | null; status: string }

export function TopStatusPanel({ state, status }: Props) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 8, background: '#111', color: '#eee', padding: 12 }}>
      <div>WS: {status}</div>
      <div>Session: {state?.session_type ?? '-'}</div>
      <div>Track: {state?.track ?? '-'}</div>
      <div>Race Ctrl: {state?.race_control_state ?? '-'}</div>
      <div>Frame: {state?.last_frame_identifier ?? '-'}</div>
      <div>Last Update: {state?.last_update_iso ?? '-'}</div>
    </div>
  )
}
