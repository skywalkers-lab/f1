export type AppState = {
  session_uid: string
  packet_format: number
  packet_version: number
  last_frame_identifier: number
  session_type: string
  track: string
  weather_state: string
  total_laps: number
  race_control_state: string
  player_car_index: number
    track_temp_c?: number
    air_temp_c?: number
  player: {
    lap: number
    position: number
    tyre_compound: string
    fuel: number
    ers: number
    tyres_age_laps?: number
    drs_enabled?: boolean
    brake_temps_c?: number[]
    tyre_surface_temps_c?: number[]
    tyre_inner_temps_c?: number[]
    engine_temp_c?: number
    time_penalties_s?: number
    total_warnings?: number
    corner_cut_warnings?: number
    unserved_drive_throughs?: number
    unserved_stop_go_pens?: number
    speed: number
    throttle: number
    brake: number
    gear: number
    rpm: number
    last_lap_ms: number
    current_lap_ms: number
    fuel_delta_per_lap?: number
  }
  leaderboard: Array<{
    position: number
    car_index: number
    driver_code: string
    driver_name?: string
    gap_to_player_s: number
    tyre_compound: string
    is_pitting: boolean
    last_lap_ms: number
    stint_lap?: number
    tyre_wear_pct?: number
    pit_window_open?: boolean
    sector_marks?: Array<'purple' | 'green' | 'none'>
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
    advanced_context?: AdvancedStrategyContext
  }
  minimap: {
    mode: 'live_trace' | 'prebuilt_map' | 'reference_track'
    player_car_index: number
    cars: Array<{
      car_index: number
      x: number
      y: number
      heading_deg?: number
      vx?: number
      vz?: number
      speed_kph?: number
      is_pitting?: boolean
      lap_distance_ratio?: number
      drs_active?: boolean
    }>
    track_trace: Array<{ x: number; y: number }>
    transform: { min_x: number; max_x: number; min_z: number; max_z: number }
    drs_zones?: Array<{ start_ratio: number; end_ratio: number; label?: string }>
    sectors?: Array<{ start_ratio: number; end_ratio: number; label?: string }>
    pit_lane?: { entry_ratio: number; exit_ratio: number }
    track_name?: string
    track_length_m?: number
  }
  last_event_summary: string
  ingest_stats: {
    packets_received: number
    packets_decoded: number
    packets_dropped: number
    duplicate_packets: number
    decode_errors: number
    last_packet_type: string
    out_of_order_packets?: number
    gaps_detected?: number
    max_gap_frames?: number
    interpolated_frames?: number
  }
  udp_stats?: {
    packetsReceived: number
    packetsDropped: number
    decodeErrors: number
    isConnected: boolean
    timeSinceLastPacket: number | null
    connectionUptime: number | null
  }
  bridge_stats?: {
    messagesPublished?: number
    messagesFailed?: number
    reconnectCount?: number
    [key: string]: unknown
  }
  feed_health?: FeedHealthState
  race_aggregate?: RaceAggregateState
  spectator?: SpectatorState
  last_update_iso: string
}

export type FeedHealthState = {
  composite_score: number
  packet_loss_pct: number
  avg_jitter_ms: number
  out_of_order_pct: number
  gap_rate: number
  interpolation_pct: number
  quality_label: string
  last_computed_iso: string
}

export type RaceAggregateState = {
  total_laps_completed: number
  current_stint_number: number
  stints: Array<StintSummary>
  fuel_curve: Array<{ lap: number; fuel_kg: number }>
  tyre_wear_curve: Array<{ lap: number; wear_pct: number; compound: string }>
  lap_history: Array<{ lap: number; time_ms: number; sector1_ms?: number; sector2_ms?: number; sector3_ms?: number }>
  pace_trend: 'improving' | 'stable' | 'degrading'
  best_lap_time_ms: number
  worst_lap_time_ms: number
  mean_lap_time_ms: number
  total_pit_stops: number
  total_pit_time_s: number
  opponent_gap_history: Record<string, Array<{ lap: number; gap_s: number }>>
}

export type StintSummary = {
  stint_number: number
  compound: string
  start_lap: number
  end_lap: number
  laps: number
  avg_lap_ms: number
  degradation_rate_ms: number
}

export type SpectatorState = {
  focused_car_index: number
  mode: 'player' | 'spectator'
  available_drivers: Array<{ car_index: number; driver_code: string; driver_name: string }>
}

export type AdvancedStrategyContext = {
  action_recommendation: {
    call: string
    urgency: 'immediate' | 'next_lap' | 'advisory'
    confidence: 'high' | 'medium' | 'low'
    rationale: string
    key_factors: string[]
  }
  undercut_window: {
    undercut_viable: boolean
    overcut_viable: boolean
    undercut_gain_s: number
    overcut_gain_s: number
    optimal_pit_lap: number
    window_closing_laps: number
  }
  safety_car: {
    sc_probability: number
    vsc_probability: number
    factors: string[]
  }
  tyre_analysis: {
    current_deg_rate_ms: number
    predicted_cliff_lap: number
    laps_to_cliff: number
    wear_acceleration: number
    compound_window: [number, number]
  }
  traffic: {
    clean_air: boolean
    gap_ahead_trend: string
    gap_behind_trend: string
    drs_available: boolean
    undercut_threat: boolean
    overcut_opportunity: boolean
  }
}
