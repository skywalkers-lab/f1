import { useMemo, useRef, useEffect, memo } from 'react'
import { AppState } from '../lib/types'

type Props = { state: AppState | null }

type EventEntry = {
  id: string
  time: string
  tag: string
  tagClass: string
  text: string
  priority: number
}

function deriveEvents(state: AppState | null): EventEntry[] {
  const events: EventEntry[] = []
  const now = new Date()
  const fmt = (d: Date) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

  if (state?.last_event_summary) {
    const summary = state.last_event_summary.toUpperCase()
    let tag = 'MSG'
    let tagClass = 'is-msg'
    if (summary.includes('PIT')) { tag = 'PIT'; tagClass = 'is-pit' }
    else if (summary.includes('YELLOW') || summary.includes('FLAG') || summary.includes('SC')) { tag = 'FLG'; tagClass = 'is-flag' }
    else if (summary.includes('UNDERCUT') || summary.includes('STRATEGY')) { tag = 'STR'; tagClass = 'is-str' }

    const priority = tagClass === 'is-flag' ? 100 : tagClass === 'is-pit' ? 80 : tagClass === 'is-str' ? 70 : 40
    events.push({
      id: `event-${state.last_frame_identifier}`,
      time: fmt(now),
      tag,
      tagClass,
      text: state.last_event_summary,
      priority,
    })
  }

  // Synthetic events from race state
  if (state) {
    const raceCtrl = (state.race_control_state ?? '').toUpperCase()
    if (raceCtrl.includes('YELLOW')) {
      events.push({ id: 'rc-yellow', time: fmt(now), tag: 'FLG', tagClass: 'is-flag', text: 'YELLOW FLAG DEPLOYED', priority: 100 })
    }

    const pittingDrivers = state.leaderboard.filter((r) => r.is_pitting)
    pittingDrivers.forEach((r) => {
      events.push({ id: `pit-${r.car_index}`, time: fmt(now), tag: 'PIT', tagClass: 'is-pit', text: `PIT IN BOX - ${r.driver_code}`, priority: 80 })
    })

    if (state.strategy?.action && state.strategy.action !== 'STAY_OUT') {
      events.push({
        id: 'strat-rec',
        time: fmt(now),
        tag: 'STR',
        tagClass: 'is-str',
        text: `STRATEGY: ${state.strategy.action.replace(/_/g, ' ')}`,
        priority: 70,
      })
    }
  }

  return events.sort((a, b) => b.priority - a.priority).slice(0, 8)
}

export const EventLog = memo(function EventLog({ state }: Props) {
  const events = useMemo(() => deriveEvents(state), [state?.last_frame_identifier, state?.last_event_summary, state?.race_control_state])
  const bodyRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight
    }
  }, [events.length])

  return (
    <section className="event-log pw-panel">
      <div className="pw-panel-header">
        <span className="pw-panel-title">EVENT_LOG</span>
        <span className="pw-panel-subtitle">AUTO_REFRESH: 0.5s</span>
      </div>
      <div className="pw-panel-body" ref={bodyRef}>
        {events.length === 0 && <div className="panel-empty-state">이벤트 대기</div>}
        {events.map((e) => (
          <div key={e.id} className={`event-entry ${e.tagClass}`}>
            <span className="event-time">{e.time}</span>
            <span className={`event-tag ${e.tagClass}`}>[{e.tag}]</span>
            <span className="event-text">{e.text}</span>
          </div>
        ))}
      </div>
    </section>
  )
})
