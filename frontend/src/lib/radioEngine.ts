/**
 * RadioMessage type definitions and message generation engine.
 *
 * Implements a priority-based, situation-aware message system that generates
 * natural F1 engineer-style radio communications with throttling and deduplication.
 */
import { AppState } from './types'
import { RaceStateSnapshot } from './dashboardMetrics'

// ── Types ───────────────────────────────────────────────

export type RadioPriority = 'info' | 'warn' | 'critical' | 'urgent'
export type RadioChannel = 'engineer' | 'strategy' | 'race-control' | 'driver' | 'spotter'
export type RadioCategory =
  | 'position'
  | 'strategy'
  | 'tyre'
  | 'fuel'
  | 'damage'
  | 'weather'
  | 'penalty'
  | 'pit'
  | 'safety'
  | 'pace'
  | 'ers'
  | 'drs'
  | 'general'

export type RadioMessage = {
  id: number
  timestamp: number
  lap: number
  from: string
  to: string
  channel: RadioChannel
  priority: RadioPriority
  category: RadioCategory
  urgency: number // 0-100 for sorting/filtering
  message: string
  actionable: string | null // concise action directive
  driverCode?: string
  pinned?: boolean
  stateSnapshot?: Partial<AppState> // attach relevant state for data tracing
}

export type MessageThrottleKey = string

// ── Throttle engine ─────────────────────────────────────

const THROTTLE_WINDOWS_MS: Record<RadioCategory, number> = {
  position: 3000,
  strategy: 8000,
  tyre: 10000,
  fuel: 15000,
  damage: 5000,
  weather: 20000,
  penalty: 2000,
  pit: 5000,
  safety: 3000,
  pace: 12000,
  ers: 10000,
  drs: 5000,
  general: 5000,
}

export class MessageThrottle {
  private _lastEmit = new Map<string, number>()

  /** Returns true if the message should be emitted (not throttled). */
  shouldEmit(category: RadioCategory, subKey: string = ''): boolean {
    const key = `${category}:${subKey}`
    const now = Date.now()
    const last = this._lastEmit.get(key) ?? 0
    const window = THROTTLE_WINDOWS_MS[category] ?? 5000
    if (now - last < window) return false
    this._lastEmit.set(key, now)
    return true
  }

  reset(): void {
    this._lastEmit.clear()
  }
}

// ── Urgency scoring ────────────────────────────────────

function urgencyFromPriority(priority: RadioPriority): number {
  if (priority === 'urgent') return 95
  if (priority === 'critical') return 80
  if (priority === 'warn') return 55
  return 25
}

// ── Situation-based message generator ──────────────────

type PrevState = {
  raceControl: string
  position: number
  pitting: Set<number>
  action: string
  lap: number
  ers: number
  fuel: number
  lastEvent: string
  fuelTone: string
  cornerCuts: number
  timePenalties: number
  tyreCompound: string
  tyreAge: number
  drs: boolean
  speed: number
  bestLapMs: number
  avgLapMs: number
  weather: string
}

export function createMessageEngine() {
  let msgIdRef = 0
  let prevState: PrevState | null = null
  const throttle = new MessageThrottle()

  function nextId(): number {
    return ++msgIdRef
  }

  function generate(s: AppState, evaluation: RaceStateSnapshot): RadioMessage[] {
    const prev = prevState
    const msgs: RadioMessage[] = []
    const lap = s.player.lap
    const now = Date.now()

    // ── Race control changes ──
    if (prev && prev.raceControl !== s.race_control_state) {
      const isRed = s.race_control_state.includes('RED')
      const isSC = s.race_control_state.includes('SC')
      const isVSC = s.race_control_state.includes('VSC')
      let actionable: string | null = null
      if (isRed) actionable = 'SLOW DOWN. RED FLAG.'
      else if (isSC) actionable = 'Safety car deployed. Delta positive. Pit window open.'
      else if (isVSC) actionable = 'VSC deployed. Maintain delta. Consider pit.'

      if (throttle.shouldEmit('safety', s.race_control_state)) {
        msgs.push({
          id: nextId(), timestamp: now, lap, from: 'RACE CONTROL', to: 'ALL',
          channel: 'race-control',
          priority: isRed ? 'urgent' : isSC ? 'critical' : 'warn',
          category: 'safety',
          urgency: isRed ? 100 : isSC ? 85 : 65,
          message: `${s.race_control_state}${s.last_event_summary ? ` — ${s.last_event_summary}` : ''}`,
          actionable,
        })
      }
    }

    // ── Position change ──
    if (prev && prev.position !== s.player.position) {
      const gained = prev.position > s.player.position
      const delta = Math.abs(prev.position - s.player.position)
      if (throttle.shouldEmit('position', String(s.player.position))) {
        msgs.push({
          id: nextId(), timestamp: now, lap, from: 'ENGINEER', to: 'DRIVER',
          channel: 'engineer',
          priority: gained ? 'info' : 'warn',
          category: 'position',
          urgency: gained ? 40 : 50,
          message: gained
            ? `Great move! P${s.player.position}. Gained ${delta} position${delta > 1 ? 's' : ''}. Gap to next: ${s.leaderboard.find((r) => r.position === s.player.position - 1)?.gap_to_player_s?.toFixed(1) ?? '?'}s.`
            : `Position lost. P${s.player.position}. Focus on tyre management. Push when ready.`,
          actionable: gained ? 'Consolidate position. Manage gap.' : 'Recover pace. Stay within DRS.',
        })
      }
    }

    // ── Strategy action changes ──
    if (prev && prev.action !== s.strategy.action) {
      const isPit = s.strategy.action.includes('PIT') || s.strategy.action.includes('BOX')
      if (throttle.shouldEmit('strategy', s.strategy.action)) {
        let actionMsg: string
        if (s.strategy.action === 'PIT_NOW' || s.strategy.action === 'BOX_THIS_LAP') {
          actionMsg = `BOX THIS LAP. ${s.strategy.reason}. Target compound ready.`
        } else if (s.strategy.action === 'PIT_IN_1') {
          actionMsg = `Box next lap. ${s.strategy.reason}. Prepare for pit entry.`
        } else if (s.strategy.action === 'PIT_IN_2') {
          actionMsg = `Box in 2 laps. ${s.strategy.reason}. Push this lap.`
        } else if (s.strategy.action === 'STAY_OUT') {
          actionMsg = `Stay out. ${s.strategy.reason}. Tyres are still good.`
        } else {
          actionMsg = `Strategy update: ${s.strategy.action}. ${s.strategy.reason}`
        }
        msgs.push({
          id: nextId(), timestamp: now, lap, from: 'STRATEGY', to: 'DRIVER',
          channel: 'strategy',
          priority: isPit ? 'critical' : 'info',
          category: 'strategy',
          urgency: isPit ? 75 : 35,
          message: actionMsg,
          actionable: isPit ? 'BOX NOW' : 'STAY OUT',
        })
      }
    }

    // ── Pit stops by others ──
    const currentPitting = new Set(s.leaderboard.filter((r) => r.is_pitting).map((r) => r.car_index))
    if (prev) {
      currentPitting.forEach((idx) => {
        if (!prev.pitting.has(idx)) {
          const row = s.leaderboard.find((r) => r.car_index === idx)
          if (row && throttle.shouldEmit('pit', `rival-${idx}`)) {
            const posRelative = row.position < s.player.position ? 'ahead' : 'behind'
            msgs.push({
              id: nextId(), timestamp: now, lap, from: 'SPOTTER', to: 'ENGINEER',
              channel: 'spotter',
              priority: Math.abs(row.position - s.player.position) <= 2 ? 'warn' : 'info',
              category: 'pit',
              urgency: Math.abs(row.position - s.player.position) <= 2 ? 60 : 30,
              message: `${row.driver_code} P${row.position} is boxing. ${row.tyre_compound} to fresh rubber. Currently ${posRelative}.`,
              actionable: posRelative === 'ahead' && Math.abs(row.position - s.player.position) <= 1
                ? 'Potential undercut. Watch pit delta.'
                : null,
              driverCode: row.driver_code,
            })
          }
        }
      })
    }

    // ── Lap reports (every 5 laps) ──
    if (prev && prev.lap !== lap && lap > 1 && lap % 5 === 0) {
      if (throttle.shouldEmit('pace', `lap-${lap}`)) {
        const paceMs = s.pace.avg_lap_ms
        const bestMs = s.pace.best_lap_ms
        const consistency = s.pace.consistency_pct
        msgs.push({
          id: nextId(), timestamp: now, lap, from: 'ENGINEER', to: 'DRIVER',
          channel: 'engineer',
          priority: 'info',
          category: 'pace',
          urgency: 20,
          message: `Lap ${lap}. ${s.player.tyre_compound} stint, ${s.player.tyres_age_laps ?? '?'} laps old. Avg ${formatLapTime(paceMs)}, best ${formatLapTime(bestMs)}. Consistency ${consistency?.toFixed(0) ?? '?'}%. Fuel ${s.player.fuel.toFixed(1)}kg.`,
          actionable: null,
        })
      }
    }

    // ── Personal best lap ──
    if (prev && prev.lap !== lap && lap > 1 && s.player.last_lap_ms > 0) {
      if (s.player.last_lap_ms <= s.pace.best_lap_ms && s.player.last_lap_ms > 0) {
        if (throttle.shouldEmit('pace', 'pb')) {
          msgs.push({
            id: nextId(), timestamp: now, lap, from: 'ENGINEER', to: 'DRIVER',
            channel: 'engineer',
            priority: 'info',
            category: 'pace',
            urgency: 35,
            message: `Personal best! ${formatLapTime(s.player.last_lap_ms)}. Great pace.`,
            actionable: null,
          })
        }
      }
    }

    // ── ERS depleted ──
    const ersPct = (s.player.ers / 4_000_000) * 100
    if (prev && prev.ers > 25 && ersPct <= 25) {
      if (throttle.shouldEmit('ers', 'low')) {
        msgs.push({
          id: nextId(), timestamp: now, lap, from: 'ENGINEER', to: 'DRIVER',
          channel: 'engineer',
          priority: 'warn',
          category: 'ers',
          urgency: 50,
          message: `ERS at ${ersPct.toFixed(0)}%. Lift and coast through slow corners to harvest. Target deployment: main straight only.`,
          actionable: 'Lift and coast. Harvest in slow zones.',
        })
      }
    }

    // ── Fuel critical ──
    if (prev && evaluation.fuelWindow.tone === 'critical' && prev.fuelTone !== 'critical') {
      if (throttle.shouldEmit('fuel', 'critical')) {
        msgs.push({
          id: nextId(), timestamp: now, lap, from: 'ENGINEER', to: 'DRIVER',
          channel: 'engineer',
          priority: 'urgent',
          category: 'fuel',
          urgency: 90,
          message: `FUEL CRITICAL. ${evaluation.fuelWindow.lapsLeft} laps of fuel remaining, ${evaluation.fuelWindow.marginLaps < 0 ? 'DEFICIT' : 'margin'} ${Math.abs(evaluation.fuelWindow.marginLaps).toFixed(1)} laps. Lift and coast every lap. Target delta plus ${Math.ceil(Math.abs(evaluation.fuelWindow.marginLaps))} tenths.`,
          actionable: `FUEL SAVE. Lift and coast +${Math.ceil(Math.abs(evaluation.fuelWindow.marginLaps) * 3)}0m before braking.`,
        })
      }
    }

    // ── Fuel watch ──
    if (prev && evaluation.fuelWindow.tone === 'watch' && prev.fuelTone === 'safe') {
      if (throttle.shouldEmit('fuel', 'watch')) {
        msgs.push({
          id: nextId(), timestamp: now, lap, from: 'ENGINEER', to: 'DRIVER',
          channel: 'engineer',
          priority: 'warn',
          category: 'fuel',
          urgency: 45,
          message: `Fuel marginal. ${evaluation.fuelWindow.lapsLeft} laps remaining. Start short-shifting from now.`,
          actionable: 'Short shift. Manage fuel.',
        })
      }
    }

    // ── Corner cut warning ──
    const cornerCuts = s.player.corner_cut_warnings ?? 0
    if (prev && cornerCuts > prev.cornerCuts) {
      if (throttle.shouldEmit('penalty', `cc-${cornerCuts}`)) {
        const remaining = 5 - cornerCuts
        let msg: string
        let actionable: string | null = null
        if (cornerCuts >= 5) {
          msg = `WARNING! ${cornerCuts} corner cuts. Penalty will be applied. Give back the time.`
          actionable = 'GIVE BACK TIME NOW.'
        } else if (cornerCuts >= 3) {
          msg = `${cornerCuts} corner cuts, ${remaining} remaining before penalty. Stay within track limits.`
          actionable = 'Watch track limits!'
        } else {
          msg = `Corner cut warning ${cornerCuts}. ${remaining} warnings left.`
          actionable = null
        }
        msgs.push({
          id: nextId(), timestamp: now, lap, from: 'RACE CONTROL', to: 'DRIVER',
          channel: 'race-control',
          priority: cornerCuts >= 4 ? 'critical' : 'warn',
          category: 'penalty',
          urgency: cornerCuts >= 4 ? 80 : 50,
          message: msg,
          actionable,
        })
      }
    }

    // ── Time penalty applied ──
    const timePen = s.player.time_penalties_s ?? 0
    if (prev && timePen > prev.timePenalties && timePen > 0) {
      msgs.push({
        id: nextId(), timestamp: now, lap, from: 'RACE CONTROL', to: 'ALL',
        channel: 'race-control',
        priority: 'urgent',
        category: 'penalty',
        urgency: 95,
        message: `${timePen} SECOND TIME PENALTY. Will be served at next pit stop.`,
        actionable: 'Penalty active. Extend stint or serve at pit.',
      })
    }

    // ── DRS available ──
    if (prev && s.player.drs_enabled && !prev.drs) {
      if (throttle.shouldEmit('drs', 'on')) {
        msgs.push({
          id: nextId(), timestamp: now, lap, from: 'SPOTTER', to: 'DRIVER',
          channel: 'spotter',
          priority: 'info',
          category: 'drs',
          urgency: 35,
          message: 'DRS enabled. Use on straights.',
          actionable: 'DRS AVAILABLE',
        })
      }
    }

    // ── Weather change ──
    if (prev && prev.weather !== s.weather_state) {
      if (throttle.shouldEmit('weather', s.weather_state)) {
        const isWet = s.weather_state.includes('RAIN') || s.weather_state.includes('WET')
        msgs.push({
          id: nextId(), timestamp: now, lap, from: 'ENGINEER', to: 'DRIVER',
          channel: 'engineer',
          priority: isWet ? 'critical' : 'warn',
          category: 'weather',
          urgency: isWet ? 75 : 40,
          message: `Weather update: ${s.weather_state}. ${isWet ? 'Rain incoming. Be prepared for intermediate or wet tyres.' : 'Conditions changing. Monitor grip levels.'}`,
          actionable: isWet ? 'Consider pit for intermediates.' : null,
        })
      }
    }

    // ── Event summary ──
    if (prev && s.last_event_summary && prev.lastEvent !== s.last_event_summary) {
      if (throttle.shouldEmit('general', s.last_event_summary)) {
        msgs.push({
          id: nextId(), timestamp: now, lap, from: 'RACE CONTROL', to: 'ALL',
          channel: 'race-control',
          priority: 'info',
          category: 'general',
          urgency: 25,
          message: s.last_event_summary,
          actionable: null,
        })
      }
    }

    // ── Update previous state ──
    prevState = {
      raceControl: s.race_control_state,
      position: s.player.position,
      pitting: currentPitting,
      action: s.strategy.action,
      lap: s.player.lap,
      ers: ersPct,
      fuel: s.player.fuel,
      lastEvent: s.last_event_summary,
      fuelTone: evaluation.fuelWindow.tone,
      cornerCuts: cornerCuts,
      timePenalties: timePen,
      tyreCompound: s.player.tyre_compound,
      tyreAge: s.player.tyres_age_laps ?? 0,
      drs: s.player.drs_enabled ?? false,
      speed: s.player.speed,
      bestLapMs: s.pace.best_lap_ms,
      avgLapMs: s.pace.avg_lap_ms,
      weather: s.weather_state,
    }

    return msgs
  }

  return { generate, throttle }
}

function formatLapTime(ms: number): string {
  if (!ms || ms <= 0) return '-:--.---'
  const totalSec = ms / 1000
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  return `${min}:${sec < 10 ? '0' : ''}${sec.toFixed(3)}`
}

// ── Communication quality metrics ──────────────────────

export type CommQuality = {
  totalMessages: number
  criticalCount: number
  warningCount: number
  strategyInterventions: number
  penaltyAlerts: number
  avgUrgency: number
  channelDistribution: Record<RadioChannel, number>
  categoryDistribution: Record<RadioCategory, number>
  qualityScore: number // 0-100
  qualityLabel: string
}

export function computeCommQuality(messages: RadioMessage[]): CommQuality {
  const channelDist = { engineer: 0, strategy: 0, 'race-control': 0, driver: 0, spotter: 0 } as Record<RadioChannel, number>
  const categoryDist = {} as Record<RadioCategory, number>
  let criticalCount = 0
  let warningCount = 0
  let strategyInterventions = 0
  let penaltyAlerts = 0
  let totalUrgency = 0

  for (const msg of messages) {
    channelDist[msg.channel] = (channelDist[msg.channel] ?? 0) + 1
    categoryDist[msg.category] = (categoryDist[msg.category] ?? 0) + 1
    totalUrgency += msg.urgency
    if (msg.priority === 'critical' || msg.priority === 'urgent') criticalCount++
    if (msg.priority === 'warn') warningCount++
    if (msg.category === 'strategy') strategyInterventions++
    if (msg.category === 'penalty') penaltyAlerts++
  }

  const total = messages.length || 1
  const avgUrgency = totalUrgency / total
  // Quality: fewer critical messages = better communication quality
  const qualityScore = Math.max(0, Math.min(100,
    100 - (criticalCount * 8) - (warningCount * 3) - (penaltyAlerts * 10) + (strategyInterventions * 2)
  ))
  const qualityLabel = qualityScore >= 75 ? 'EXCELLENT'
    : qualityScore >= 50 ? 'GOOD'
    : qualityScore >= 30 ? 'MODERATE'
    : 'POOR'

  return {
    totalMessages: messages.length,
    criticalCount,
    warningCount,
    strategyInterventions,
    penaltyAlerts,
    avgUrgency: Math.round(avgUrgency),
    channelDistribution: channelDist,
    categoryDistribution: categoryDist,
    qualityScore: Math.round(qualityScore),
    qualityLabel,
  }
}
