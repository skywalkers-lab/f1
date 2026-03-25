import { memo, useEffect, useLayoutEffect, useRef } from 'react'
import { formatTyreCompound, formatTyreCompoundShort, tyreCompoundTone } from '../../lib/f1Terms'
import { GapMode } from '../../lib/leaderboardGap'
import { GapTrend } from '../../lib/leaderboardTrend'
import { LeaderboardTacticalView } from '../../hooks/useLeaderboardTacticalAnalysis'
import { StableLeaderboardRow } from '../../hooks/useStableLeaderboard'
import { getTeamColors } from '../../lib/teamColors'

type Props = {
  row: StableLeaderboardRow
  index: number
  isPlayer: boolean
  gapText: string
  intervalText: string
  gapMode: GapMode
  trend: GapTrend
  tactical: LeaderboardTacticalView
  renderVersion: string
}

const ROW_FLIP_PX = 28

function formatLap(ms?: number): string {
  if (!ms || !Number.isFinite(ms) || ms <= 0) return '-'
  const minutes = Math.floor(ms / 60000)
  const seconds = (ms % 60000) / 1000
  if (!Number.isFinite(seconds)) return '-'
  return `${minutes}:${seconds.toFixed(3).padStart(6, '0')}`
}

function sectorClass(mark: 'purple' | 'green' | 'none' | undefined): string {
  if (mark === 'purple') return 'sector-dot is-purple'
  if (mark === 'green') return 'sector-dot is-green'
  return 'sector-dot is-neutral'
}

function RowComponent({ row, index, isPlayer, gapText, intervalText, gapMode, tactical, renderVersion }: Props) {
  const trRef = useRef<HTMLTableRowElement | null>(null)
  const prevIndexRef = useRef(index)
  const rowHeightRef = useRef(ROW_FLIP_PX)
  const rafRef = useRef<number | null>(null)
  const flashTimeoutRef = useRef<number | null>(null)
  const prevFlashKeyRef = useRef(tactical.events.flashKey)

  useLayoutEffect(() => {
    const prev = prevIndexRef.current
    const next = index
    const delta = prev - next
    prevIndexRef.current = next

    if (!trRef.current || delta === 0) return

    const rect = trRef.current.getBoundingClientRect()
    if (rect.height > 0) {
      rowHeightRef.current = rect.height
    }

    trRef.current.style.transition = 'none'
    trRef.current.style.transform = `translateY(${delta * rowHeightRef.current}px)`

    rafRef.current = requestAnimationFrame(() => {
      if (!trRef.current) return
      trRef.current.style.transition = 'transform 260ms cubic-bezier(0.22, 1, 0.36, 1)'
      trRef.current.style.transform = 'translateY(0)'
      rafRef.current = null
    })

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
      }
    }
  }, [index])

  useEffect(() => {
    const nextFlashKey = tactical.events.flashKey
    const prevFlashKey = prevFlashKeyRef.current
    prevFlashKeyRef.current = nextFlashKey

    if (!trRef.current || nextFlashKey === 'none' || nextFlashKey === prevFlashKey) return

    trRef.current.classList.remove('is-event-flash')
    void trRef.current.offsetWidth
    trRef.current.classList.add('is-event-flash')

    if (flashTimeoutRef.current !== null) {
      window.clearTimeout(flashTimeoutRef.current)
    }

    flashTimeoutRef.current = window.setTimeout(() => {
      trRef.current?.classList.remove('is-event-flash')
      flashTimeoutRef.current = null
    }, 1400)

    return () => {
      if (flashTimeoutRef.current !== null) {
        window.clearTimeout(flashTimeoutRef.current)
      }
    }
  }, [tactical.events.flashKey])

  const trendClass =
    tactical.gap.pressureState === 'drs'
      ? 'gap-trend is-drs'
      : tactical.gap.tone === 'critical'
        ? 'gap-trend is-defend'
        : tactical.gap.tone === 'watch'
          ? 'gap-trend is-pressure'
          : 'gap-trend is-stable'

  const stintText = row.stintLap ? `Stint ${row.stintLap}` : 'Stint -'
  const teamColor = getTeamColors(row.driver_code).body
  const tyreTone = tyreCompoundTone(row.tyre_compound)
  const tyreShort = formatTyreCompoundShort(row.tyre_compound)
  const gapSignalLabel = tactical.gap.drsActive ? 'DRS ACTIVE' : tactical.gap.drsAvailable ? 'DRS READY' : tactical.gap.pressureState === 'pressure' ? 'PRESSURE' : 'STABLE'
  const rowClassName = [
    'leaderboard-row',
    isPlayer ? 'is-player' : '',
    row.is_pitting ? 'is-pitting' : '',
    tactical.gap.pressureState === 'drs' ? 'has-drs-window' : '',
    tactical.stint.tone === 'critical' ? 'has-tyre-risk' : '',
    tactical.events.highlight ? 'has-live-event' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <tr
      ref={trRef}
      className={rowClassName}
      data-gap-mode={gapMode}
      data-render-version={renderVersion}
      aria-label={tactical.ariaLabel}
    >
      <td className="pos-col">{row.position}</td>
      <td className="drv-col">
        <div className="driver-cell" title={tactical.events.labels.join(' · ') || tactical.strategy.detail}>
          <span className="team-stripe" style={{ background: teamColor }} aria-hidden="true" />
          <div className="driver-stack">
            <span>{row.driver_code}</span>
            {tactical.events.labels[0] ? <span className="driver-event-tag">{tactical.events.labels[0]}</span> : null}
          </div>
        </div>
      </td>
      <td className="gap-col">
        <div className={trendClass} aria-label={tactical.ariaLabel} title={tactical.ariaLabel}>
          <span className="gap-main">{gapText}</span>
          <span className="gap-sub">{tactical.gap.primaryLabel}</span>
          <div className="gap-signal-row">
            <span className={`gap-signal is-${tactical.gap.pressureState}`}>{gapSignalLabel}</span>
            <span className="gap-overtake">OT {tactical.gap.overtakeProbabilityPct}%</span>
          </div>
        </div>
      </td>
      <td className="int-col">
        <div className="int-stack" aria-label={`${intervalText}, ${tactical.gap.secondaryLabel}`} title={tactical.gap.secondaryLabel}>
          <span className="int-main">{intervalText}</span>
          <span className={`int-sub is-${tactical.gap.tone}`}>{tactical.gap.secondaryLabel}</span>
        </div>
      </td>
      <td className="tyre-col">
        <div className="tyre-main" aria-label={`${formatTyreCompound(row.tyre_compound)}, ${tactical.stint.phaseLabel}, ${tactical.stint.riskLabel}`} title={tactical.strategy.detail}>
          <span className={`tyre-pill is-${tyreTone}`}>{tyreShort}</span>
          <span className={`stint-pill is-${tactical.stint.phase}`}>{tactical.stint.phaseLabel}</span>
          <span className="tyre-full-label">{formatTyreCompound(row.tyre_compound)}</span>
          {tactical.strategy.label ? <span className={`strategy-pill is-${tactical.strategy.tag}`}>{tactical.strategy.label}</span> : null}
        </div>
        <div className={`tyre-sub is-${tactical.stint.tone}`}>{stintText} · 마모 {tactical.stint.wearText} · {tactical.stint.riskLabel}</div>
        {tactical.stint.undercutRisk ? <div className="tyre-risk-banner">UNDERCUT RISK</div> : null}
      </td>
      <td className="lap-col">
        <div className="lap-main-wrap">
          <div className={`lap-main is-${tactical.pace.state}`} title={`${tactical.pace.stateLabel} · ${tactical.pace.sectorLabel}`}>
            {formatLap(row.last_lap_ms)}
          </div>
          <span className={`pace-pill is-${tactical.pace.state}`}>{tactical.pace.stateLabel}</span>
          <span className={`pit-flag ${row.is_pitting ? 'is-active' : ''}`}>{row.is_pitting ? 'IN PIT' : row.pitWindowOpen ? 'PIT WINDOW' : 'RUN'}</span>
        </div>
        <div className="sector-strip" aria-label="섹터 상태">
          <span className={sectorClass(row.sectorMarks?.[0])}>S1</span>
          <span className={sectorClass(row.sectorMarks?.[1])}>S2</span>
          <span className={sectorClass(row.sectorMarks?.[2])}>S3</span>
          {tactical.pace.greenStreak >= 2 ? <span className="sector-streak">STREAK x{tactical.pace.greenStreak}</span> : null}
        </div>
        <div className={`lap-sub is-${tactical.pace.tone}`}>{tactical.pace.sectorLabel} · Δ {tactical.pace.lapDeltaMs >= 0 ? '+' : ''}{Math.round(tactical.pace.lapDeltaMs)}ms</div>
      </td>
    </tr>
  )
}

function areEqual(prev: Props, next: Props): boolean {
  return prev.renderVersion === next.renderVersion && prev.tactical.versionKey === next.tactical.versionKey
}

export const LeaderboardRow = memo(RowComponent, areEqual)
