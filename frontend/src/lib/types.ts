export type AppState = {
  session_uid: number
  packet_format: number
  packet_version: number
  last_frame_identifier: number
  session_type: string
  track: string
  weather_state: string
  total_laps: number
  race_control_state: string
  player_car_index: number
  player: {
    lap: number
    position: number
    tyre_compound: string
    fuel: number
    ers: number
    last_lap_ms: number
    current_lap_ms: number
  }
  leaderboard: Array<{
    position: number
    car_index: number
    driver_code: string
    gap_to_player_s: number
    tyre_compound: string
    is_pitting: boolean
    last_lap_ms: number
  }>
  pace: {
    best_lap_ms: number
    avg_lap_ms: number
    consistency_pct: number
    recent: Array<{ lap: number; lap_time_ms: number }>
  }
  strategy: {
    action: string
    score: number
    confidence: string
    reason: string
    key_inputs: Record<string, number | string>
    candidates: Array<{ action: string; score: number; reason: string }>
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
    duplicate_packets: number
    decode_errors: number
    last_packet_type: string
  }
  last_update_iso: string
}
