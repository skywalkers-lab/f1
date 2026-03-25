import { AppState } from '../lib/types'
import { RaceStateSnapshot } from '../lib/dashboardMetrics'
import { formatRaceControl } from '../lib/f1Terms'

type Props = { state: AppState | null; evaluation: RaceStateSnapshot }

function ersLabel(pct: number): string {
  if (pct >= 70) return 'ATTACK'
  if (pct >= 35) return 'BALANCED'
  return 'SAVE'
}

function ersColor(pct: number): string {
  if (pct >= 70) return 'var(--drs)'
  if (pct >= 35) return 'var(--ers)'
  return 'var(--warn)'
}

export function BattleControlsPanel({ state, evaluation }: Props) {
  const ersPct = Math.max(0, Math.min(100, ((state?.player.ers ?? 0) / 5000000) * 100))
  const fuel = state?.player.fuel ?? 0
  const fuelWindow = evaluation.fuelWindow
  const ersMode = ersLabel(ersPct)
  const fuelToneClass = fuelWindow.tone === 'safe' ? 'is-safe' : fuelWindow.tone === 'watch' ? 'is-watch' : 'is-critical'
  const raceControl = (state?.race_control_state ?? 'GREEN').toUpperCase()
  const raceNeutralized = raceControl.includes('YELLOW') || raceControl.includes('VSC') || raceControl.includes('SAFETY') || raceControl.startsWith('SC') || raceControl.includes('RED')
  const playerRow = state?.leaderboard.find((row) => row.car_index === state.player_car_index)
  const pitWindowOpen = playerRow?.pit_window_open ?? ((state?.player.lap ?? 0) >= 10)
  const raceDrsEnabled = !!state && !raceNeutralized && ((state.player.lap ?? 0) >= 3 || (state.total_laps ?? 0) <= 0)
  const playerDrsOpen = !!state?.player.drs_enabled
  const warnings = state?.player.total_warnings ?? 0
  const cornerCuts = state?.player.corner_cut_warnings ?? 0
  const driveThroughs = state?.player.unserved_drive_throughs ?? 0
  const stopGoPens = state?.player.unserved_stop_go_pens ?? 0
  const timePenalty = state?.player.time_penalties_s ?? 0
  const hasPenalty = timePenalty > 0 || driveThroughs > 0 || stopGoPens > 0
  const penaltyHeadline = hasPenalty
    ? `+${timePenalty}s / DT ${driveThroughs} / SG ${stopGoPens}`
    : warnings > 0 || cornerCuts > 0
      ? `⚠ ${warnings} WARN`
      : '✓ CLEAR'
  const penaltyClass = hasPenalty ? 'is-critical' : warnings > 0 ? 'is-watch' : 'is-safe'
  const deployCall = evaluation.recommendedActionState.call === 'SAVE'
    ? 'LIFT & COAST'
    : evaluation.recommendedActionState.call === 'BOX'
      ? 'BOX THIS WINDOW'
      : evaluation.recommendedActionState.call === 'PUSH'
        ? 'PUSH IN CLEAN AIR'
        : raceDrsEnabled && playerDrsOpen
          ? 'ATTACK EXIT'
          : ersMode === 'ATTACK'
            ? 'PUSH IN CLEAN AIR'
            : 'MANAGE TYRES'

  if (!state) {
    return (
      <section className="pw-panel battle-panel">
        <div className="pw-panel-header">
          <span className="pw-panel-title">차량 운용</span>
          <span className="pw-panel-subtitle">리소스 데이터 대기</span>
        </div>
        <div className="panel-empty-state">DRS, 연료, ERS, 패널티 데이터가 들어오면 FIA 레이스 컨트롤과 드라이버 운용 상태를 함께 표시합니다.</div>
      </section>
    )
  }

  return (
    <section className="pw-panel battle-panel">
      <div className="pw-panel-header">
        <span className="pw-panel-title">차량 운용 <span className="badge-raw">LIVE</span></span>
        <span className="pw-panel-subtitle">FIA 제어 + 리소스</span>
      </div>

      {/* Status chips */}
      <div className="battle-control-strip">
        <div className={`battle-control-chip is-${raceNeutralized ? 'warn' : 'live'}`}>
          <span className="label">FLAG</span>
          <span className="value">{formatRaceControl(state.race_control_state)}</span>
        </div>
        <div className={`battle-control-chip is-${raceDrsEnabled ? 'live' : 'muted'}`}>
          <span className="label">DRS</span>
          <span className="value">{raceDrsEnabled ? (playerDrsOpen ? 'OPEN' : 'READY') : 'LOCK'}</span>
        </div>
        <div className={`battle-control-chip is-${pitWindowOpen ? 'live' : 'muted'}`}>
          <span className="label">PIT</span>
          <span className="value">{pitWindowOpen ? 'OPEN' : 'CLOSED'}</span>
        </div>
        <div className={`battle-control-chip ${penaltyClass}`}>
          <span className="label">PEN</span>
          <span className="value">{hasPenalty ? 'ACTIVE' : warnings > 0 ? 'WARN' : 'CLR'}</span>
        </div>
      </div>

      {/* ERS gauge */}
      <div className="battle-ers-section">
        <div className="battle-ers-header">
          <span className="battle-ers-title">ERS STORE</span>
          <span className="battle-ers-mode" style={{ color: ersColor(ersPct) }}>{ersMode}</span>
          <span className="battle-ers-pct">{ersPct.toFixed(0)}%</span>
        </div>
        <div className="battle-ers-bar">
          <div className="battle-ers-fill" style={{ width: `${ersPct}%`, background: `linear-gradient(90deg, ${ersColor(ersPct)}88, ${ersColor(ersPct)})` }} />
          <div className="battle-ers-marker" style={{ left: '70%' }} />
          <div className="battle-ers-marker" style={{ left: '35%' }} />
        </div>
      </div>

      {/* Fuel + Deploy */}
      <div className="battle-dual-grid">
        <div className="battle-card">
          <span className="battle-card-label">FUEL</span>
          <span className="battle-card-value">{fuel.toFixed(1)}<small> kg</small></span>
          <span className={`battle-card-tag ${fuelToneClass}`}>{fuelWindow.tone.toUpperCase()}</span>
        </div>
        <div className="battle-card">
          <span className="battle-card-label">DEPLOY</span>
          <span className="battle-card-value battle-card-deploy">{deployCall}</span>
        </div>
      </div>

      {/* Fuel detail */}
      <div className="battle-fuel-detail">
        <div className="battle-fuel-item">
          <span className="battle-fuel-label">랩당</span>
          <span className="battle-fuel-val">{fuelWindow.fuelPerLap.toFixed(2)} kg</span>
        </div>
        <div className="battle-fuel-item">
          <span className="battle-fuel-label">잔여 랩</span>
          <span className="battle-fuel-val">{fuelWindow.lapsLeft}</span>
        </div>
        <div className="battle-fuel-item">
          <span className="battle-fuel-label">마진</span>
          <span className="battle-fuel-val">{fuelWindow.marginLaps.toFixed(1)} L</span>
        </div>
      </div>

      {/* Race core rationale */}
      <div className="battle-rationale">
        {evaluation.recommendedActionState.call} — {evaluation.recommendedActionState.rationale}
      </div>

      {/* Penalty row */}
      <div className="battle-penalty-row">
        <div className="battle-penalty-main">
          <span className="battle-card-label">PENALTY</span>
          <span className={`battle-penalty-value ${penaltyClass}`}>{penaltyHeadline}</span>
        </div>
        <div className="battle-penalty-detail">
          경고 {warnings} · 트랙리밋 {cornerCuts} · {state.player.tyre_compound} · P{state.player.position} · L{state.player.lap}
        </div>
      </div>
    </section>
  )
}
