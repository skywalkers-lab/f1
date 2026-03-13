export type AppState = {
  session_uid: number
  packet_format: number
  packet_version: number
  last_frame_identifier: number
  session_type: string
  track: string
  race_control_state: string
  player_car_index: number
  player: {
    lap: number
    position: number
    tyre_compound: string
    fuel: number
    ers: number
  }
  minimap: {
    mode: 'live_trace' | 'prebuilt_map'
    player_car_index: number
    cars: Array<{ car_index: number; x: number; y: number }>
    track_trace: Array<{ x: number; y: number }>
    transform: { min_x: number; max_x: number; min_z: number; max_z: number }
  }
  last_event_summary: string
  ingest_stats: {
    packets_received: number
    packets_decoded: number
    packets_dropped: number
    last_packet_type: string
  }
  last_update_iso: string
}
