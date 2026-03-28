const WEATHER_MAP = {
  0: 'WEATHER_0',
  1: 'WEATHER_1',
  2: 'WEATHER_2',
  3: 'WEATHER_3',
  4: 'WEATHER_4',
  5: 'WEATHER_5',
}

const SESSION_MAP = {
  0: 'UNKNOWN',
  1: 'P1',
  2: 'P2',
  3: 'P3',
  4: 'SHORT_P',
  5: 'Q1',
  6: 'Q2',
  7: 'Q3',
  8: 'SHORT_Q',
  10: 'RACE',
}

const TRACK_MAP = {
  '-1': 'TRACK_UNKNOWN',
  0: 'TRACK_0',
  1: 'TRACK_1',
  2: 'TRACK_2',
  5: 'TRACK_5',
  10: 'TRACK_10',
  13: 'TRACK_13',
  14: 'TRACK_14',
  16: 'TRACK_16',
}

const TYRE_MAP = {
  16: 'C5',
  17: 'C4',
  18: 'C3',
  19: 'C2',
  20: 'C1',
  7: 'INTER',
  8: 'WET',
}

const DRS_BY_TRACK = {
  TRACK_0: [
    { start_ratio: 0.08, end_ratio: 0.18, label: 'DRS1' },
    { start_ratio: 0.57, end_ratio: 0.66, label: 'DRS2' },
  ],
  TRACK_14: [
    { start_ratio: 0.17, end_ratio: 0.29, label: 'DRS1' },
    { start_ratio: 0.74, end_ratio: 0.85, label: 'DRS2' },
  ],
}

function normalizeTyre(rawVisual, rawFallback) {
  return TYRE_MAP[rawVisual] || TYRE_MAP[rawFallback] || 'C3'
}

function defaultLeaderboardRow(index) {
  return {
    position: index + 1,
    car_index: index,
    driver_code: `C${String(index).padStart(2, '0')}`,
    gap_to_player_s: 0,
    tyre_compound: 'C3',
    is_pitting: false,
    last_lap_ms: 0,
    stint_lap: 0,
    tyre_wear_pct: 0,
    pit_window_open: false,
    sector_marks: ['none', 'none', 'none'],
  }
}

function createEmptyState(playerCarIndex = 0) {
  return {
    raw: {
      last_packets_by_type: {},
      recent_packets: [],
      latest_packet_payloads: {},
    },
    derived: {
      schema_version: 1,
      telemetry_feed: {
        score_pct: 0,
        band: 'unknown',
        coverage_ratio: 0,
        avg_jitter_ms: 0,
      },
    },
    session_uid: '0',
    packet_format: 2025,
    packet_version: 1,
    last_frame_identifier: 0,
    session_type: 'UNKNOWN',
    track: 'TRACK_UNKNOWN',
    weather_state: 'WEATHER_0',
    total_laps: 0,
    race_control_state: 'GREEN',
    player_car_index: playerCarIndex,
    player: {
      lap: 0,
      position: 0,
      tyre_compound: 'C3',
      fuel: 0,
      ers: 0,
      drs_enabled: false,
      time_penalties_s: 0,
      total_warnings: 0,
      corner_cut_warnings: 0,
      unserved_drive_throughs: 0,
      unserved_stop_go_pens: 0,
      speed: 0,
      throttle: 0,
      brake: 0,
      gear: 0,
      rpm: 0,
      last_lap_ms: 0,
      current_lap_ms: 0,
    },
    leaderboard: new Array(22).fill(null).map((_, i) => defaultLeaderboardRow(i)),
    pace: {
      best_lap_ms: 0,
      avg_lap_ms: 0,
      consistency_pct: 0,
      recent: [],
    },
    strategy: {
      action: 'STAY_OUT',
      score: 0.5,
      confidence: 'low',
      reason: '초기화 상태',
      key_inputs: {},
      candidates: [
        { action: 'STAY_OUT', score: 0.5, reason: '초기화 상태' },
      ],
    },
    minimap: {
      mode: 'live_trace',
      player_car_index: playerCarIndex,
      cars: [],
      track_trace: [],
      transform: {
        min_x: -100,
        max_x: 100,
        min_z: -100,
        max_z: 100,
      },
      drs_zones: [],
    },
    last_event_summary: '대기 중',
    ingest_stats: {
      packets_received: 0,
      packets_decoded: 0,
      packets_dropped: 0,
      duplicate_packets: 0,
      decode_errors: 0,
      size_validation_failures: 0,
      last_packet_type: 'NONE',
      feed_health_score_pct: 0,
    },
    last_update_iso: new Date(0).toISOString(),
  }
}

function cloneJson(obj) {
  return JSON.parse(JSON.stringify(obj))
}

function profileSnapshot(state, profile = 'engineer') {
  const normalizedProfile = ['engineer', 'hud', 'overlay', 'debug'].includes(profile)
    ? profile
    : 'engineer'

  const full = cloneJson(state)
  if (normalizedProfile === 'debug') {
    full.profile = 'debug'
    return full
  }

  const base = {
    profile: normalizedProfile,
    session_uid: full.session_uid,
    packet_format: full.packet_format,
    packet_version: full.packet_version,
    last_frame_identifier: full.last_frame_identifier,
    session_type: full.session_type,
    track: full.track,
    weather_state: full.weather_state,
    total_laps: full.total_laps,
    race_control_state: full.race_control_state,
    player_car_index: full.player_car_index,
    player: full.player,
    leaderboard: full.leaderboard,
    pace: full.pace,
    strategy: full.strategy,
    minimap: full.minimap,
    last_event_summary: full.last_event_summary,
    ingest_stats: full.ingest_stats,
    derived: full.derived,
    feed_health: full.feed_health,
    last_update_iso: full.last_update_iso,
  }

  if (normalizedProfile === 'overlay') {
    return {
      profile: 'overlay',
      session_uid: base.session_uid,
      last_frame_identifier: base.last_frame_identifier,
      race_control_state: base.race_control_state,
      player: {
        lap: base.player?.lap || 0,
        position: base.player?.position || 0,
        speed: base.player?.speed || 0,
        throttle: base.player?.throttle || 0,
        brake: base.player?.brake || 0,
        gear: base.player?.gear || 0,
      },
      strategy: {
        action: base.strategy?.action || 'STAY_OUT',
        confidence: base.strategy?.confidence || 'low',
        reason: base.strategy?.reason || '',
      },
      last_event_summary: base.last_event_summary,
      last_update_iso: base.last_update_iso,
    }
  }

  if (normalizedProfile === 'hud') {
    return {
      profile: 'hud',
      session_uid: base.session_uid,
      last_frame_identifier: base.last_frame_identifier,
      race_control_state: base.race_control_state,
      player: base.player,
      minimap: {
        mode: base.minimap?.mode,
        player_car_index: base.minimap?.player_car_index,
        cars: base.minimap?.cars || [],
      },
      last_event_summary: base.last_event_summary,
      last_update_iso: base.last_update_iso,
    }
  }

  return base
}

export class AppStateBuilder {
  constructor(playerCarIndex = 0) {
    this.state = createEmptyState(playerCarIndex)
    this.playerCarIndex = playerCarIndex
    this.lastFrame = -1
    this.telemetryByCar = new Map()
    this.statusByCar = new Map()
    this.lapByCar = new Map()
    this.motionByCar = new Map()
    this.namesByCar = new Map()
    this.playerTrace = []
    this.playerLapHistory = []
  }

  markPacketReceived() {
    this.state.ingest_stats.packets_received += 1
  }

  markPacketDropped() {
    this.state.ingest_stats.packets_dropped += 1
  }

  applyPacket(parsed) {
    this.markPacketReceived()

    const { header, type, data, raw, meta } = parsed
    if (!header) {
      this.state.ingest_stats.decode_errors += 1
      return
    }

    if (header.frameIdentifier === this.lastFrame && type !== 'unknown') {
      this.state.ingest_stats.duplicate_packets += 1
    }
    this.lastFrame = header.frameIdentifier

    this.state.packet_format = header.packetFormat
    this.state.packet_version = header.packetVersion
    this.state.session_uid = header.sessionUID
    this.state.last_frame_identifier = header.frameIdentifier
    this.state.player_car_index = header.playerCarIndex
    this.playerCarIndex = header.playerCarIndex
    this.state.minimap.player_car_index = header.playerCarIndex

    if (raw) {
      this.state.raw.last_packets_by_type[type] = {
        receivedAtMs: raw.receivedAtMs,
        byteLength: raw.byteLength,
        checksumSha1: raw.checksumSha1,
        header: raw.header,
      }
      this.state.raw.latest_packet_payloads[type] = {
        packetId: raw.header.packetId,
        packetName: raw.header.packetName,
        frameIdentifier: raw.header.frameIdentifier,
        receivedAtMs: raw.receivedAtMs,
        rawBase64: raw.rawBase64,
      }
      this.state.raw.recent_packets.push({
        type,
        frameIdentifier: header.frameIdentifier,
        packetId: header.packetId,
        byteLength: raw.byteLength,
        receivedAtMs: raw.receivedAtMs,
      })
      if (this.state.raw.recent_packets.length > 120) {
        this.state.raw.recent_packets.splice(0, this.state.raw.recent_packets.length - 120)
      }
    }

    if (meta?.sizeCheck?.ok === false) {
      this.state.ingest_stats.size_validation_failures += 1
    }

    switch (type) {
      case 'session': {
        this.state.session_type = SESSION_MAP[data.sessionType] || `SESSION_${data.sessionType}`
        this.state.track = TRACK_MAP[data.trackId] || `TRACK_${data.trackId}`
        this.state.weather_state = WEATHER_MAP[data.weather] || `WEATHER_${data.weather}`
        this.state.total_laps = data.totalLaps || this.state.total_laps
        this.state.race_control_state = data.safetyCarStatus > 0 ? 'SC_OR_VSC' : 'GREEN'
        this.state.minimap.drs_zones = DRS_BY_TRACK[this.state.track] || [
          { start_ratio: 0.12, end_ratio: 0.19, label: 'DRS1' },
          { start_ratio: 0.60, end_ratio: 0.68, label: 'DRS2' },
        ]
        break
      }
      case 'lap': {
        for (const row of data) this.lapByCar.set(row.carIndex, row)
        this.rebuildLeaderboard()
        break
      }
      case 'telemetry': {
        for (const row of data) this.telemetryByCar.set(row.carIndex, row)
        break
      }
      case 'status': {
        for (const row of data) this.statusByCar.set(row.carIndex, row)
        break
      }
      case 'participants': {
        for (const row of data) {
          const code = row.name ? row.name.slice(0, 3).toUpperCase() : `C${String(row.carIndex).padStart(2, '0')}`
          this.namesByCar.set(row.carIndex, code)
        }
        break
      }
      case 'motion': {
        for (const row of data) this.motionByCar.set(row.carIndex, row)
        this.rebuildMinimap()
        break
      }
      default:
        break
    }

    this.state.ingest_stats.packets_decoded += 1
    this.state.ingest_stats.last_packet_type = type.toUpperCase()

    this.rebuildPlayer()
    this.rebuildPace()
    this.rebuildStrategy()

    this.state.last_update_iso = new Date().toISOString()
  }

  applyFeedHealth(feedHealth) {
    if (!feedHealth || typeof feedHealth !== 'object') return
    const health = feedHealth.health || {}
    this.state.ingest_stats.feed_health_score_pct = Number(health.scorePct || 0)
    this.state.derived.telemetry_feed = {
      score_pct: Number(health.scorePct || 0),
      band: health.band || 'unknown',
      coverage_ratio: Number(feedHealth.coverageRatio || 0),
      avg_jitter_ms: Number(feedHealth.avgJitterMs || 0),
    }
  }

  rebuildPlayer() {
    const lap = this.lapByCar.get(this.playerCarIndex)
    const telemetry = this.telemetryByCar.get(this.playerCarIndex)
    const status = this.statusByCar.get(this.playerCarIndex)

    if (lap) {
      this.state.player.lap = lap.currentLapNum
      this.state.player.position = lap.carPosition
      this.state.player.last_lap_ms = lap.lastLapMs
      this.state.player.current_lap_ms = lap.currentLapMs
    }
    if (telemetry) {
      this.state.player.speed = telemetry.speed
      this.state.player.throttle = telemetry.throttle
      this.state.player.brake = telemetry.brake
      this.state.player.gear = telemetry.gear
      this.state.player.rpm = telemetry.rpm
      this.state.player.drs_enabled = telemetry.drs > 0
    }
    if (status) {
      this.state.player.tyre_compound = normalizeTyre(status.tyreCompoundVisual, status.tyreCompoundRaw)
      this.state.player.fuel = Math.max(0, status.fuelInTank)
      this.state.player.ers = Math.max(0, status.ersStoreEnergy)
    }
    if (lap) {
      this.state.player.time_penalties_s = lap.penalties ?? 0
      this.state.player.total_warnings = lap.totalWarnings ?? 0
      this.state.player.corner_cut_warnings = lap.cornerCuttingWarnings ?? 0
      this.state.player.unserved_drive_throughs = lap.numUnservedDriveThroughPens ?? 0
      this.state.player.unserved_stop_go_pens = lap.numUnservedStopGoPens ?? 0
    }

    this.state.last_event_summary = this.state.player.position > 0
      ? `P${this.state.player.position} · L${this.state.player.lap}`
      : '포지션 수신 대기'
  }

  rebuildLeaderboard() {
    const rows = []
    const playerLap = this.lapByCar.get(this.playerCarIndex)
    const playerDistance = playerLap?.lapDistance ?? 0

    for (let i = 0; i < 22; i += 1) {
      const lap = this.lapByCar.get(i)
      const status = this.statusByCar.get(i)
      const base = defaultLeaderboardRow(i)
      const distance = lap?.lapDistance ?? 0
      rows.push({
        ...base,
        position: lap?.carPosition || base.position,
        driver_code: this.namesByCar.get(i) || base.driver_code,
        gap_to_player_s: (distance - playerDistance) / 90,
        tyre_compound: normalizeTyre(status?.tyreCompoundVisual, status?.tyreCompoundRaw),
        is_pitting: (lap?.pitStatus ?? 0) > 0,
        last_lap_ms: lap?.lastLapMs || 0,
        stint_lap: lap?.currentLapNum || 0,
        tyre_wear_pct: Math.min(100, Math.max(0, ((lap?.currentLapNum || 0) / 35) * 100)),
        pit_window_open: (lap?.currentLapNum || 0) > 8,
        sector_marks: ['none', 'none', 'none'],
      })
    }

    rows.sort((a, b) => a.position - b.position)
    this.state.leaderboard = rows
  }

  rebuildPace() {
    const playerLast = this.state.player.last_lap_ms
    if (playerLast > 0) {
      this.playerLapHistory.push(playerLast)
      if (this.playerLapHistory.length > 8) this.playerLapHistory.shift()
    }

    const best = this.playerLapHistory.reduce((m, v) => (v > 0 && (m === 0 || v < m) ? v : m), 0)
    const nonZero = this.playerLapHistory.filter((v) => v > 0)
    const avg = nonZero.length > 0 ? Math.round(nonZero.reduce((a, b) => a + b, 0) / nonZero.length) : 0

    const variance = nonZero.length
      ? nonZero.reduce((acc, v) => acc + Math.pow(v - avg, 2), 0) / nonZero.length
      : 0
    const consistency = nonZero.length ? Math.max(0, 100 - Math.sqrt(variance) / 3.2) : 0

    this.state.pace.best_lap_ms = best
    this.state.pace.avg_lap_ms = avg
    this.state.pace.consistency_pct = Number(consistency.toFixed(1))
    this.state.pace.recent = nonZero.slice(-5).map((lap_time_ms, idx) => ({
      lap: Math.max(1, this.state.player.lap - (nonZero.length - idx - 1)),
      lap_time_ms,
    }))
  }

  rebuildMinimap() {
    const cars = []
    for (let i = 0; i < 22; i += 1) {
      const motion = this.motionByCar.get(i)
      const telemetry = this.telemetryByCar.get(i)
      const lap = this.lapByCar.get(i)
      if (!motion) continue
      const heading = Math.atan2(motion.vx || 0, motion.vz || 0) * (180 / Math.PI)
      cars.push({
        car_index: i,
        x: motion.x,
        y: motion.z,
        heading_deg: Number.isFinite(heading) ? heading : 0,
        vx: motion.vx,
        vz: motion.vz,
        speed_kph: telemetry?.speed || 0,
        is_pitting: (lap?.pitStatus || 0) > 0,
        lap_distance_ratio: Math.max(0, Math.min(1, (lap?.lapDistance || 0) / 5600)),
        drs_active: (telemetry?.drs || 0) > 0,
      })
    }

    const player = cars.find((c) => c.car_index === this.playerCarIndex)
    if (player) {
      this.playerTrace.push({ x: player.x, y: player.y })
      if (this.playerTrace.length > 1400) {
        this.playerTrace.splice(0, this.playerTrace.length - 1400)
      }
    }

    const sample = [...this.playerTrace, ...cars.map((c) => ({ x: c.x, y: c.y }))]
    if (sample.length > 0) {
      const xs = sample.map((p) => p.x)
      const ys = sample.map((p) => p.y)
      this.state.minimap.transform = {
        min_x: Math.min(...xs),
        max_x: Math.max(...xs),
        min_z: Math.min(...ys),
        max_z: Math.max(...ys),
      }
    }

    this.state.minimap.cars = cars
    this.state.minimap.track_trace = this.playerTrace.slice()
  }

  rebuildStrategy() {
    const lapsRemaining = Math.max(0, (this.state.total_laps || 0) - this.state.player.lap)
    const fuel = this.state.player.fuel
    const wear = Math.min(1, Math.max(0, this.state.player.lap / 35))

    const scores = [
      {
        action: 'PIT_NOW',
        score: 0.45 + (wear > 0.7 ? 0.28 : 0) - (fuel < 5 ? 0.08 : 0),
        reason: '타이어 마모 및 언더컷 창 계산',
      },
      {
        action: 'PIT_IN_1',
        score: 0.50 + (wear > 0.58 ? 0.12 : 0),
        reason: '다음 랩 피트로 트래픽 완화',
      },
      {
        action: 'PIT_IN_2',
        score: 0.44 + (lapsRemaining > 15 ? 0.09 : 0),
        reason: '스틴트 길이 최적화',
      },
      {
        action: 'STAY_OUT',
        score: 0.52 + (wear < 0.45 ? 0.16 : 0) + (fuel < 8 ? 0.04 : 0),
        reason: '타이어 여유 및 트랙 포지션 유지',
      },
    ].map((c) => ({ ...c, score: Number(Math.max(0, Math.min(0.99, c.score)).toFixed(3)) }))

    scores.sort((a, b) => b.score - a.score)
    const best = scores[0]
    const gap = best.score - (scores[1]?.score || 0)

    this.state.strategy = {
      action: best.action,
      score: best.score,
      confidence: gap > 0.12 ? 'high' : gap > 0.06 ? 'medium' : 'low',
      reason: best.reason,
      key_inputs: {
        laps_remaining: lapsRemaining,
        tyre_wear_mean: Number(wear.toFixed(3)),
        fuel_remaining_kg: Number(fuel.toFixed(2)),
        traffic_density: Number(Math.min(1, Math.max(0, (22 - this.state.player.position) / 22)).toFixed(3)),
        pit_loss_est_s: 21.5,
        gap_ahead_s: Number(Math.max(0, this.state.leaderboard[0]?.gap_to_player_s || 0).toFixed(3)),
        gap_behind_s: Number(Math.max(0, -(this.state.leaderboard[1]?.gap_to_player_s || 0)).toFixed(3)),
        weather_state: this.state.weather_state,
      },
      candidates: scores,
    }
  }

  snapshot(profile = 'engineer') {
    return profileSnapshot(this.state, profile)
  }
}
