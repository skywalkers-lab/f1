import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppState } from '../lib/types'
import { RaceStateSnapshot } from '../lib/dashboardMetrics'
import { getTeamColors } from '../lib/teamColors'
import { formatStrategyAction, formatRaceControl } from '../lib/f1Terms'

type Props = { state: AppState | null; evaluation: RaceStateSnapshot }

type RadioMessage = {
  id: number
  timestamp: number
  lap: number
  from: string
  to: string
  channel: 'engineer' | 'strategy' | 'race-control' | 'driver'
  priority: 'info' | 'warn' | 'critical'
  message: string
  driverCode?: string
}

let msgIdCounter = 0
function nextId() { return ++msgIdCounter }

export function RadioView({ state, evaluation }: Props) {
  const [messages, setMessages] = useState<RadioMessage[]>([])
  const [filter, setFilter] = useState<'all' | 'engineer' | 'strategy' | 'race-control' | 'driver'>('all')
  const [muted, setMuted] = useState(false)
  const logRef = useRef<HTMLDivElement>(null!)
  const prevStateRef = useRef<{
    raceControl: string
    position: number
    pitting: Set<number>
    action: string
    lap: number
    ers: number
    fuel: number
    lastEvent: string
  } | null>(null)

  // Generate radio messages from state changes
  const generateMessages = useCallback((s: AppState) => {
    const prev = prevStateRef.current
    const newMessages: RadioMessage[] = []
    const lap = s.player.lap
    const now = Date.now()

    // Race control changes
    if (prev && prev.raceControl !== s.race_control_state) {
      newMessages.push({
        id: nextId(), timestamp: now, lap, from: 'RACE CONTROL', to: 'ALL',
        channel: 'race-control', priority: s.race_control_state.includes('RED') ? 'critical' : 'warn',
        message: `${formatRaceControl(s.race_control_state)} — ${s.last_event_summary || 'Condition change'}`,
      })
    }

    // Position change
    if (prev && prev.position !== s.player.position) {
      const gained = prev.position > s.player.position
      newMessages.push({
        id: nextId(), timestamp: now, lap, from: 'ENGINEER', to: 'DRIVER',
        channel: 'engineer', priority: 'info',
        message: gained
          ? `Good job! P${s.player.position} now. You gained ${prev.position - s.player.position} position${prev.position - s.player.position > 1 ? 's' : ''}.`
          : `We lost position. P${s.player.position} now. Keep pushing.`,
      })
    }

    // Strategy action changes
    if (prev && prev.action !== s.strategy.action) {
      newMessages.push({
        id: nextId(), timestamp: now, lap, from: 'STRATEGY', to: 'DRIVER',
        channel: 'strategy', priority: s.strategy.action.includes('PIT') ? 'warn' : 'info',
        message: `Strategy update: ${formatStrategyAction(s.strategy.action)}. ${s.strategy.reason}`,
      })
    }

    // Pit stops by others
    const currentPitting = new Set(s.leaderboard.filter((r) => r.is_pitting).map((r) => r.car_index))
    if (prev) {
      currentPitting.forEach((idx) => {
        if (!prev.pitting.has(idx)) {
          const row = s.leaderboard.find((r) => r.car_index === idx)
          if (row) {
            newMessages.push({
              id: nextId(), timestamp: now, lap, from: 'SPOTTER', to: 'ENGINEER',
              channel: 'engineer', priority: 'info',
              message: `${row.driver_code} P${row.position} is pitting — ${row.tyre_compound}`,
              driverCode: row.driver_code,
            })
          }
        }
      })
    }

    // Lap change - report stint info
    if (prev && prev.lap !== lap && lap > 1 && lap % 5 === 0) {
      newMessages.push({
        id: nextId(), timestamp: now, lap, from: 'ENGINEER', to: 'DRIVER',
        channel: 'engineer', priority: 'info',
        message: `Lap ${lap} complete. ${s.player.tyre_compound} compound. Fuel ${s.player.fuel.toFixed(1)}kg remaining.`,
      })
    }

    // ERS depleted warning
    if (prev && prev.ers > 20 && (s.player.ers / 5_000_000) * 100 <= 20) {
      newMessages.push({
        id: nextId(), timestamp: now, lap, from: 'ENGINEER', to: 'DRIVER',
        channel: 'engineer', priority: 'warn',
        message: 'ERS depleted. Lift and coast to harvest.',
      })
    }

    // Fuel warning
    const fuelTone = evaluation.fuelWindow.tone
    if (prev && fuelTone === 'critical') {
      newMessages.push({
        id: nextId(), timestamp: now, lap, from: 'ENGINEER', to: 'DRIVER',
        channel: 'engineer', priority: 'critical',
        message: `FUEL CRITICAL — ${evaluation.fuelWindow.lapsLeft} laps of fuel remaining. Lift and coast.`,
      })
    }

    // New event summary
    if (prev && s.last_event_summary && prev.lastEvent !== s.last_event_summary) {
      newMessages.push({
        id: nextId(), timestamp: now, lap, from: 'RACE CONTROL', to: 'ALL',
        channel: 'race-control', priority: 'info',
        message: s.last_event_summary,
      })
    }

    prevStateRef.current = {
      raceControl: s.race_control_state,
      position: s.player.position,
      pitting: currentPitting,
      action: s.strategy.action,
      lap: s.player.lap,
      ers: (s.player.ers / 5_000_000) * 100,
      fuel: s.player.fuel,
      lastEvent: s.last_event_summary,
    }

    return newMessages
  }, [evaluation.fuelWindow])

  useEffect(() => {
    if (!state) return
    const newMsgs = generateMessages(state)
    if (newMsgs.length > 0) {
      setMessages((prev) => [...prev, ...newMsgs].slice(-200))
    }
  }, [state, generateMessages])

  // Auto-scroll to bottom
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [messages])

  // Initial welcome message
  useEffect(() => {
    setMessages([{
      id: nextId(), timestamp: Date.now(), lap: 0,
      from: 'SYSTEM', to: 'ALL', channel: 'engineer', priority: 'info',
      message: 'Radio channel active. Monitoring all team communications.',
    }])
  }, [])

  const filtered = useMemo(() => {
    if (filter === 'all') return messages
    return messages.filter((m) => m.channel === filter)
  }, [messages, filter])

  const channelCounts = useMemo(() => {
    const counts = { engineer: 0, strategy: 0, 'race-control': 0, driver: 0 }
    messages.forEach((m) => { counts[m.channel] = (counts[m.channel] ?? 0) + 1 })
    return counts
  }, [messages])

  return (
    <div className="radio-view">
      {/* Controls */}
      <section className="pw-panel radio-controls-panel">
        <div className="pw-panel-header">
          <span className="pw-panel-title">TEAM RADIO</span>
          <span className="pw-panel-subtitle">{messages.length} messages</span>
        </div>
        <div className="radio-toolbar">
          <div className="radio-filter-btns">
            {(['all', 'engineer', 'strategy', 'race-control', 'driver'] as const).map((ch) => (
              <button
                key={ch}
                type="button"
                className={`radio-filter-btn ${filter === ch ? 'is-active' : ''}`}
                onClick={() => setFilter(ch)}
              >
                {ch === 'all' ? 'ALL' : ch === 'race-control' ? 'RC' : ch.toUpperCase()}
                {ch !== 'all' && <span className="radio-count">{channelCounts[ch]}</span>}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={`radio-mute-btn ${muted ? 'is-muted' : ''}`}
            onClick={() => setMuted(!muted)}
          >
            {muted ? '🔇' : '🔊'}
          </button>
          <button
            type="button"
            className="radio-clear-btn"
            onClick={() => setMessages([])}
          >
            CLEAR
          </button>
        </div>
      </section>

      {/* Radio Log */}
      <section className="pw-panel radio-log-panel">
        <div ref={logRef} className="radio-log-scroll">
          {filtered.length === 0 ? (
            <div className="panel-empty-state">라디오 메시지 대기 중</div>
          ) : (
            filtered.map((msg) => (
              <div key={msg.id} className={`radio-msg radio-msg-${msg.priority} radio-ch-${msg.channel}`}>
                <div className="radio-msg-header">
                  <span className="radio-msg-time">
                    L{msg.lap} · {new Date(msg.timestamp).toLocaleTimeString()}
                  </span>
                  <span className={`radio-msg-channel is-${msg.channel}`}>{msg.channel.toUpperCase()}</span>
                  <span className={`radio-msg-priority is-${msg.priority}`}>{msg.priority === 'critical' ? '🔴' : msg.priority === 'warn' ? '🟡' : '🟢'}</span>
                </div>
                <div className="radio-msg-route">
                  <span className="radio-msg-from">{msg.from}</span>
                  <span className="radio-msg-arrow">→</span>
                  <span className="radio-msg-to">{msg.to}</span>
                </div>
                <div className="radio-msg-text">
                  {msg.driverCode && (
                    <span className="radio-driver-tag" style={{ color: getTeamColors(msg.driverCode).body }}>
                      {msg.driverCode}
                    </span>
                  )}
                  {msg.message}
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      {/* Quick Summary */}
      <section className="pw-panel radio-summary-panel">
        <div className="pw-panel-header">
          <span className="pw-panel-title">COMMUNICATION SUMMARY</span>
        </div>
        <div className="radio-summary-grid">
          <div className="radio-summary-item">
            <span className="radio-summary-label">ENGINEER</span>
            <span className="radio-summary-count">{channelCounts.engineer}</span>
          </div>
          <div className="radio-summary-item">
            <span className="radio-summary-label">STRATEGY</span>
            <span className="radio-summary-count">{channelCounts.strategy}</span>
          </div>
          <div className="radio-summary-item">
            <span className="radio-summary-label">RACE CTRL</span>
            <span className="radio-summary-count">{channelCounts['race-control']}</span>
          </div>
          <div className="radio-summary-item">
            <span className="radio-summary-label">DRIVER</span>
            <span className="radio-summary-count">{channelCounts.driver}</span>
          </div>
          <div className="radio-summary-item">
            <span className="radio-summary-label">TOTAL</span>
            <span className="radio-summary-count is-ok">{messages.length}</span>
          </div>
          <div className="radio-summary-item">
            <span className="radio-summary-label">ALERTS</span>
            <span className={`radio-summary-count ${messages.filter((m) => m.priority === 'critical').length > 0 ? 'is-critical' : 'is-ok'}`}>
              {messages.filter((m) => m.priority !== 'info').length}
            </span>
          </div>
        </div>
      </section>
    </div>
  )
}
