import { AppState } from './types'

const DRIVERS = ['LEC', 'VER', 'NOR', 'SAI', 'HAM', 'RUS', 'ALO', 'PIA', 'GAS', 'PER', 'ALB', 'OCO']
const TOTAL_LAPS = 78
const PLAYER_CAR_INDEX = 3
const TRACK_LENGTH_M = 3337
const TICK_SEC = 0.12
const PIT_ENTRY_START = 0.84
const PIT_ENTRY_END = 0.99

type Point = { x: number; y: number }
type Compound = 'SOFT' | 'MEDIUM' | 'HARD'
type SectorMark = 'purple' | 'green' | 'none'

type SimCar = {
  carIndex: number
  driverCode: string
  totalDistanceM: number
  speedKph: number
  tyreCompound: Compound
  tyreWearPct: number
  lapCount: number
  stintLap: number
  lapClockMs: number
  lastLapMs: number
  bestLapMs: number
  personalBestSectors: [number, number, number]
  lastLapSectors: [number, number, number]
  currentSector: 0 | 1 | 2
  sectorStartMs: number
  isPitting: boolean
  pitTimerSec: number
  pitCount: number
  drsActive: boolean
  throttle: number
  brake: number
  gear: number
  rpm: number
  fuelKg: number
  ersJ: number
}

type SimState = {
  elapsedSec: number
  sessionUid: number
  cars: SimCar[]
  playerLapHistory: Array<{ lap: number; lap_time_ms: number }>
  globalBestSector: [number, number, number]
  positionMap: Map<number, number>
  recentEvent: string
  overtakeCounter: number
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

function chooseCompound(index: number): Compound {
  if (index % 4 === 0) return 'SOFT'
  if (index % 3 === 0) return 'HARD'
  return 'MEDIUM'
}

function nextCompound(current: Compound): Compound {
  if (current === 'SOFT') return 'MEDIUM'
  if (current === 'MEDIUM') return 'HARD'
  return 'MEDIUM'
}

function compoundWearRate(compound: Compound): number {
  if (compound === 'SOFT') return 0.072
  if (compound === 'MEDIUM') return 0.052
  return 0.038
}

function baseRacePace(carIndex: number): number {
  return 186 + (10 - carIndex) * 1.6
}

function progressRatio(totalDistanceM: number): number {
  const lapDistance = totalDistanceM % TRACK_LENGTH_M
  return lapDistance / TRACK_LENGTH_M
}

function monoTrackPoint(t: number): Point {
  // Monaco-inspired track: tight hairpin, harbor chicane, tunnel, swimming pool
  const n = t / (Math.PI * 2) // 0..1 normalized
  // Control points define a recognizable street circuit shape
  const cx = [0.22, 0.18, 0.25, 0.45, 0.70, 0.88, 0.90, 0.85, 0.78, 0.82, 0.75, 0.55, 0.32, 0.20]
  const cy = [0.28, 0.50, 0.72, 0.82, 0.78, 0.62, 0.42, 0.28, 0.18, 0.32, 0.48, 0.38, 0.22, 0.18]
  const len = cx.length
  const pos = n * len
  const i0 = Math.floor(pos) % len
  const frac = pos - Math.floor(pos)
  const i1 = (i0 + 1) % len
  const i2 = (i0 + 2) % len
  const im = (i0 - 1 + len) % len
  // Catmull-Rom interpolation for smooth curves
  const cr = (p0: number, p1: number, p2: number, p3: number, f: number) => {
    const f2 = f * f
    const f3 = f2 * f
    return 0.5 * (
      (-p0 + 3 * p1 - 3 * p2 + p3) * f3 +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * f2 +
      (-p0 + p2) * f +
      2 * p1
    )
  }
  const x = cr(cx[im], cx[i0], cx[i1], cx[i2], frac)
  const y = cr(cy[im], cy[i0], cy[i1], cy[i2], frac)
  return {
    x: clamp(x, 0.06, 0.94),
    y: clamp(y, 0.08, 0.92),
  }
}

function buildTrackTrace(count = 420): Point[] {
  const pts: Point[] = []
  for (let i = 0; i < count; i += 1) {
    const t = (i / count) * Math.PI * 2
    pts.push(monoTrackPoint(t))
  }
  return pts
}

const TRACK_TRACE = buildTrackTrace()

function initialCars(): SimCar[] {
  return DRIVERS.map((driverCode, i) => {
    const startGap = i * 24
    const initialDistance = (TOTAL_LAPS - 1) * TRACK_LENGTH_M + (TRACK_LENGTH_M - startGap)
    const compound = chooseCompound(i)
    return {
      carIndex: i,
      driverCode,
      totalDistanceM: initialDistance,
      speedKph: baseRacePace(i),
      tyreCompound: compound,
      tyreWearPct: 7 + i * 1.2,
      lapCount: 1,
      stintLap: 1,
      lapClockMs: 0,
      lastLapMs: 0,
      bestLapMs: 0,
      personalBestSectors: [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY],
      lastLapSectors: [0, 0, 0],
      currentSector: 0,
      sectorStartMs: 0,
      isPitting: false,
      pitTimerSec: 0,
      pitCount: 0,
      drsActive: false,
      throttle: 0.7,
      brake: 0.1,
      gear: 6,
      rpm: 9800,
      fuelKg: 104 - i * 0.3,
      ersJ: 4_100_000 - i * 40_000,
    }
  })
}

function buildInitialState(): SimState {
  const cars = initialCars()
  const sorted = [...cars].sort((a, b) => b.totalDistanceM - a.totalDistanceM)
  const positionMap = new Map<number, number>()
  sorted.forEach((car, idx) => positionMap.set(car.carIndex, idx + 1))

  return {
    elapsedSec: 0,
    sessionUid: Math.floor(Date.now() / 1000),
    cars,
    playerLapHistory: [],
    globalBestSector: [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY],
    positionMap,
    recentEvent: 'Formation complete. Race pace simulation active.',
    overtakeCounter: 0,
  }
}

function shouldEnterPit(car: SimCar, ratio: number): boolean {
  if (car.isPitting) return false
  if (car.pitCount >= 2) return false
  const wearThreshold = car.pitCount === 0 ? 63 : 82
  const pitWindow = car.lapCount > 10 && car.tyreWearPct >= wearThreshold
  return pitWindow && ratio >= PIT_ENTRY_START && ratio <= PIT_ENTRY_END
}

function updateSectorTiming(car: SimCar, ratioBefore: number, ratioAfter: number, globalBestSector: [number, number, number]) {
  const thresholds = [1 / 3, 2 / 3]
  for (let i = car.currentSector; i < 2; i += 1) {
    const threshold = thresholds[i]
    const crossed = ratioBefore < threshold && ratioAfter >= threshold
    if (!crossed) continue

    const sectorTime = Math.max(1, car.lapClockMs - car.sectorStartMs)
    car.lastLapSectors[i] = sectorTime
    if (sectorTime < car.personalBestSectors[i]) car.personalBestSectors[i] = sectorTime
    if (sectorTime < globalBestSector[i]) globalBestSector[i] = sectorTime
    car.currentSector = (i + 1) as 0 | 1 | 2
    car.sectorStartMs = car.lapClockMs
  }
}

function completeLap(car: SimCar, globalBestSector: [number, number, number]) {
  const sector3 = Math.max(1, car.lapClockMs - car.sectorStartMs)
  car.lastLapSectors[2] = sector3
  if (sector3 < car.personalBestSectors[2]) car.personalBestSectors[2] = sector3
  if (sector3 < globalBestSector[2]) globalBestSector[2] = sector3

  car.lastLapMs = Math.max(60_000, Math.round(car.lapClockMs))
  if (car.bestLapMs === 0 || car.lastLapMs < car.bestLapMs) car.bestLapMs = car.lastLapMs

  car.lapCount = Math.min(TOTAL_LAPS, car.lapCount + 1)
  car.stintLap += 1
  car.lapClockMs = 0
  car.currentSector = 0
  car.sectorStartMs = 0
}

function sectorMarks(car: SimCar, globalBestSector: [number, number, number]): [SectorMark, SectorMark, SectorMark] {
  return [0, 1, 2].map((idx) => {
    const sectorTime = car.lastLapSectors[idx]
    if (!Number.isFinite(sectorTime) || sectorTime <= 0) return 'none'
    if (Math.abs(sectorTime - globalBestSector[idx]) < 1.5) return 'purple'
    if (Math.abs(sectorTime - car.personalBestSectors[idx]) < 1.5) return 'green'
    return 'none'
  }) as [SectorMark, SectorMark, SectorMark]
}

function updateCars(sim: SimState) {
  sim.elapsedSec += TICK_SEC
  const sortedByDistance = [...sim.cars].sort((a, b) => b.totalDistanceM - a.totalDistanceM)

  sim.cars.forEach((car) => {
    const ratioBefore = progressRatio(car.totalDistanceM)
    const inDrsZone = (ratioBefore >= 0.12 && ratioBefore <= 0.19) || (ratioBefore >= 0.6 && ratioBefore <= 0.68)

    if (shouldEnterPit(car, ratioBefore)) {
      car.isPitting = true
      car.pitTimerSec = 12 + (car.carIndex % 3) * 1.4
      car.drsActive = false
      car.throttle = 0.45
      car.brake = 0.38
      car.speedKph = 78
    }

    const ahead = sortedByDistance.find((c) => c.totalDistanceM > car.totalDistanceM && c.carIndex !== car.carIndex)
    const gapAheadM = ahead ? ahead.totalDistanceM - car.totalDistanceM : 250
    const trafficPenalty = gapAheadM < 22 ? 24 : gapAheadM < 38 ? 11 : 0

    const base = baseRacePace(car.carIndex)
    const wearPenalty = car.tyreWearPct * (car.tyreCompound === 'SOFT' ? 0.52 : car.tyreCompound === 'MEDIUM' ? 0.43 : 0.34)
    const randomWave = Math.sin(sim.elapsedSec * (0.82 + car.carIndex * 0.04) + car.carIndex) * 4.8
    const drsBoost = inDrsZone && gapAheadM < 38 && !car.isPitting ? 12 : 0

    let targetSpeed = base - wearPenalty - trafficPenalty + randomWave + drsBoost

    if (car.isPitting) {
      car.pitTimerSec = Math.max(0, car.pitTimerSec - TICK_SEC)
      if (car.pitTimerSec > 7) targetSpeed = 72
      else if (car.pitTimerSec > 2.5) targetSpeed = 18
      else targetSpeed = 92
      if (car.pitTimerSec <= 0) {
        car.isPitting = false
        car.pitCount += 1
        car.tyreCompound = nextCompound(car.tyreCompound)
        car.tyreWearPct = clamp(4 + car.pitCount * 2, 0, 14)
        car.stintLap = 0
      }
    }

    car.speedKph = clamp(targetSpeed, 42, 336)
    car.drsActive = !car.isPitting && inDrsZone && gapAheadM < 38
    car.throttle = clamp(0.58 + car.speedKph / 420 - trafficPenalty / 140, 0.12, 1)
    car.brake = clamp(0.5 - car.throttle * 0.45 + (car.isPitting ? 0.25 : 0), 0, 0.95)
    car.gear = clamp(Math.round(1 + (car.speedKph / 330) * 7), 1, 8)
    car.rpm = clamp(Math.round(5500 + car.speedKph * 22 + car.throttle * 1800), 5200, 13_400)

    const wearRate = compoundWearRate(car.tyreCompound)
    car.tyreWearPct = clamp(car.tyreWearPct + wearRate * TICK_SEC * (0.85 + car.speedKph / 280), 0, 100)
    car.fuelKg = clamp(car.fuelKg - 0.016 * TICK_SEC * (0.72 + car.speedKph / 250), 2.5, 110)
    car.ersJ = clamp(car.ersJ + (car.brake * 22_000 - car.throttle * 14_500) * TICK_SEC, 550_000, 4_800_000)

    const speedMps = car.speedKph / 3.6
    car.totalDistanceM += speedMps * TICK_SEC
    car.lapClockMs += TICK_SEC * 1000

    const ratioAfter = progressRatio(car.totalDistanceM)
    updateSectorTiming(car, ratioBefore, ratioAfter, sim.globalBestSector)

    if (ratioAfter < ratioBefore) {
      completeLap(car, sim.globalBestSector)
      if (car.carIndex === PLAYER_CAR_INDEX) {
        sim.playerLapHistory.push({ lap: car.lapCount - 1, lap_time_ms: car.lastLapMs })
        sim.playerLapHistory = sim.playerLapHistory.slice(-8)
      }
    }
  })
}

function buildLeaderboard(sim: SimState): AppState['leaderboard'] {
  const sorted = [...sim.cars].sort((a, b) => b.totalDistanceM - a.totalDistanceM)
  const player = sim.cars.find((c) => c.carIndex === PLAYER_CAR_INDEX) ?? sorted[0]

  const playerSpeedMps = Math.max(12, player.speedKph / 3.6)

  const nextPositionMap = new Map<number, number>()
  sorted.forEach((car, idx) => nextPositionMap.set(car.carIndex, idx + 1))

  const movers: string[] = []
  sorted.forEach((car, idx) => {
    const prevPos = sim.positionMap.get(car.carIndex) ?? idx + 1
    const nextPos = idx + 1
    if (nextPos < prevPos) {
      movers.push(`${car.driverCode} P${prevPos}->P${nextPos}`)
    }
  })

  if (movers.length > 0) {
    sim.overtakeCounter += movers.length
    sim.recentEvent = `Overtake: ${movers.slice(0, 2).join(' | ')}`
  } else if (sim.elapsedSec % 18 < TICK_SEC * 2) {
    sim.recentEvent = 'Field compressing through middle sector. Watch undercut windows.'
  }

  sim.positionMap = nextPositionMap

  return sorted.map((car, idx) => {
    const deltaSeconds = (player.totalDistanceM - car.totalDistanceM) / playerSpeedMps
    return {
      position: idx + 1,
      car_index: car.carIndex,
      driver_code: car.driverCode,
      gap_to_player_s: car.carIndex === PLAYER_CAR_INDEX ? 0 : Number(deltaSeconds.toFixed(3)),
      tyre_compound: car.tyreCompound,
      is_pitting: car.isPitting,
      last_lap_ms: car.lastLapMs || 0,
      stint_lap: car.stintLap,
      tyre_wear_pct: Number(car.tyreWearPct.toFixed(1)),
      pit_window_open: car.tyreWearPct >= 55,
      sector_marks: sectorMarks(car, sim.globalBestSector),
    }
  })
}

function buildMinimapCars(sim: SimState): AppState['minimap']['cars'] {
  return sim.cars.map((car) => {
    const ratio = progressRatio(car.totalDistanceM)
    const idx = Math.floor(ratio * (TRACK_TRACE.length - 1))
    const pt = TRACK_TRACE[idx]
    const next = TRACK_TRACE[(idx + 1) % TRACK_TRACE.length]
    const heading = (Math.atan2(-(next.y - pt.y), next.x - pt.x) * 180) / Math.PI

    return {
      car_index: car.carIndex,
      x: pt.x,
      y: pt.y,
      lap_distance_ratio: Number(ratio.toFixed(4)),
      heading_deg: Number(heading.toFixed(2)),
      speed_kph: Math.round(car.speedKph),
      is_pitting: car.isPitting,
      drs_active: car.drsActive,
    }
  })
}

function strategyAction(player: SimCar): string {
  if (player.isPitting) return 'PIT_NOW'
  if (player.tyreWearPct > 72) return 'BOX_THIS_LAP'
  if (player.tyreWearPct > 56) return 'PIT_IN_1'
  if (player.lapCount > 52) return 'DEFEND_TRACK_POS'
  return 'PUSH_IN_CLEAR_AIR'
}

function strategyReason(player: SimCar): string {
  if (player.isPitting) return 'Pit lane committed. Prioritize clean release and tyre warm-up for out-lap.'
  if (player.tyreWearPct > 70) return 'Rear tyre wear is critical. Undercut probability is now favorable.'
  if (player.tyreWearPct > 55) return 'Pit window open. Monitor traffic before committing this lap.'
  return 'Tyre delta remains manageable. Continue pushing in clear air.'
}

function weatherByTime(elapsedSec: number): string {
  if (elapsedSec > 380) return 'WEATHER_2'
  if (elapsedSec > 250) return 'WEATHER_1'
  return 'WEATHER_0'
}

export function createMonacoDemoStream(onState: (s: AppState) => void, onStatus: (s: string) => void): () => void {
  const sim = buildInitialState()
  onStatus('connected')

  const id = window.setInterval(() => {
    updateCars(sim)

    const leaderboard = buildLeaderboard(sim)
    const player = sim.cars.find((car) => car.carIndex === PLAYER_CAR_INDEX) ?? sim.cars[0]
    const bestLapMs = sim.cars.reduce((best, car) => {
      if (!car.bestLapMs) return best
      if (!best || car.bestLapMs < best) return car.bestLapMs
      return best
    }, 0)

    const cautionWindow = sim.elapsedSec % 90 > 44 && sim.elapsedSec % 90 < 49
    const raceControlState = cautionWindow ? 'YELLOW' : 'GREEN'

    const nextState: AppState = {
      session_uid: String(sim.sessionUid),
      packet_format: 2024,
      packet_version: 1,
      last_frame_identifier: Math.floor(sim.elapsedSec / TICK_SEC),
      session_type: 'SESSION_11',
      track: 'MONACO',
      weather_state: weatherByTime(sim.elapsedSec),
      total_laps: TOTAL_LAPS,
      race_control_state: raceControlState,
      player_car_index: PLAYER_CAR_INDEX,
        track_temp_c: 42,
        air_temp_c: 28,
      player: {
        lap: player.lapCount,
        position: leaderboard.find((row) => row.car_index === PLAYER_CAR_INDEX)?.position ?? 1,
        tyre_compound: player.tyreCompound,
        fuel: Number(player.fuelKg.toFixed(1)),
        ers: Math.round(player.ersJ),
        drs_enabled: player.drsActive,
        time_penalties_s: sim.elapsedSec > 420 ? 5 : 0,
        total_warnings: sim.elapsedSec > 170 ? 1 : 0,
        corner_cut_warnings: sim.elapsedSec > 290 ? 1 : 0,
        unserved_drive_throughs: sim.elapsedSec > 560 ? 1 : 0,
        unserved_stop_go_pens: 0,
        speed: Math.round(player.speedKph),
        throttle: Number(player.throttle.toFixed(3)),
        brake: Number(player.brake.toFixed(3)),
        gear: player.gear,
        rpm: player.rpm,
        last_lap_ms: player.lastLapMs || 0,
        current_lap_ms: Math.round(player.lapClockMs),
      },
      leaderboard,
      pace: {
        best_lap_ms: bestLapMs || 0,
        avg_lap_ms: leaderboard.reduce((sum, row) => sum + (row.last_lap_ms || 0), 0) / Math.max(1, leaderboard.filter((r) => r.last_lap_ms > 0).length),
        consistency_pct: Number(clamp(96 - player.tyreWearPct * 0.18 + (player.isPitting ? -4 : 0), 72, 99).toFixed(1)),
        recent: sim.playerLapHistory.slice(-6),
      },
      strategy: {
        action: strategyAction(player),
        score: Number(clamp(0.91 - player.tyreWearPct / 140 - (player.isPitting ? 0.06 : 0), 0.45, 0.97).toFixed(3)),
        confidence: player.tyreWearPct > 66 ? 'high' : player.tyreWearPct > 48 ? 'medium' : 'low',
        reason: strategyReason(player),
        key_inputs: {
          laps_remaining: TOTAL_LAPS - player.lapCount,
          tyre_age: player.lapCount,
          tyre_wear_pct: Number(player.tyreWearPct.toFixed(1)),
          fuel_remaining_kg: Number(player.fuelKg.toFixed(1)),
          overtake_events: sim.overtakeCounter,
          pit_window_open: player.tyreWearPct >= 55 ? 'open' : 'closed',
          sc_vsc_status: raceControlState,
          weather_state: weatherByTime(sim.elapsedSec),
          pit_loss_est_s: 21.9,
        },
        candidates: [
          { action: 'BOX_THIS_LAP', score: Number(clamp(0.52 + player.tyreWearPct / 135, 0.45, 0.94).toFixed(3)), reason: 'Tyre wear and undercut opportunity rising.' },
          { action: 'PUSH_IN_CLEAR_AIR', score: Number(clamp(0.86 - player.tyreWearPct / 145, 0.34, 0.9).toFixed(3)), reason: 'Viable if traffic window ahead is clear.' },
          { action: 'DEFEND_TRACK_POS', score: Number(clamp(0.7 - player.tyreWearPct / 210, 0.3, 0.82).toFixed(3)), reason: 'Protect track position from cars in DRS train.' },
        ],
      },
      minimap: {
        mode: 'prebuilt_map',
        player_car_index: PLAYER_CAR_INDEX,
        cars: buildMinimapCars(sim),
        track_trace: TRACK_TRACE,
        transform: {
          min_x: 0,
          max_x: 1,
          min_z: 0,
          max_z: 1,
        },
        drs_zones: [
          { start_ratio: 0.12, end_ratio: 0.19, label: 'DRS1' },
          { start_ratio: 0.6, end_ratio: 0.68, label: 'DRS2' },
        ],
      },
      last_event_summary: cautionWindow ? 'Yellow flag in sector 2. Marshals on track.' : sim.recentEvent,
      ingest_stats: {
        packets_received: Math.floor(sim.elapsedSec / TICK_SEC) * 20,
        packets_decoded: Math.floor(sim.elapsedSec / TICK_SEC) * 20 - 2,
        packets_dropped: 2,
        duplicate_packets: 1,
        decode_errors: 0,
        last_packet_type: 'MOTION',
      },
      last_update_iso: new Date().toISOString(),
    }

    onState(nextState)
  }, TICK_SEC * 1000)

  return () => {
    window.clearInterval(id)
    onStatus('disconnected')
  }
}
