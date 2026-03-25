import { useRef, useEffect } from 'react'
import { AppState } from '../lib/types'
import { RaceStateSnapshot } from '../lib/dashboardMetrics'
import { useTyreHistory } from '../hooks/useTyreHistory'
import { useTyreEngineeringAnalysis } from '../hooks/useTyreEngineeringAnalysis'

type Props = { state: AppState | null; evaluation: RaceStateSnapshot }

function formatSpeed(speed: number): string {
  return `${Math.round(speed)}`
}

function formatRpm(rpm: number): string {
  return rpm >= 1000 ? `${(rpm / 1000).toFixed(1)}k` : `${rpm}`
}

/** Tiny canvas-based speed-trace sparkline. */
function SpeedTrace({ history }: { history: number[] }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || history.length < 2) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const w = canvas.width
    const h = canvas.height
    ctx.clearRect(0, 0, w, h)
    const max = Math.max(...history, 1)
    const step = w / (history.length - 1)
    ctx.beginPath()
    ctx.strokeStyle = '#00D1FF'
    ctx.lineWidth = 1.5
    history.forEach((v, i) => {
      const x = i * step
      const y = h - (v / max) * h * 0.9
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.stroke()
  }, [history])

  return <canvas ref={canvasRef} width={280} height={60} className="speed-trace-canvas" />
}

export function TelemetryView({ state, evaluation }: Props) {
  const tyreHistory = useTyreHistory(state)
  const tyreEng = useTyreEngineeringAnalysis(state, tyreHistory)

  const player = state?.player
  const speed = player?.speed ?? 0
  const rpm = player?.rpm ?? 0
  const gear = player?.gear ?? 0
  const throttle = Math.round((player?.throttle ?? 0) * 100)
  const brake = Math.round((player?.brake ?? 0) * 100)
  const ers = Math.round(((player?.ers ?? 0) / 5_000_000) * 100)
  const fuel = player?.fuel ?? 0
  const drs = player?.drs_enabled ?? false

  // Speed history buffer (last 60 readings)
  const speedHistoryRef = useRef<number[]>([])
  useEffect(() => {
    if (speed > 0) {
      speedHistoryRef.current = [...speedHistoryRef.current.slice(-59), speed]
    }
  }, [speed])

  // ERS / fuel metrics from evaluation
  const fuelWindow = evaluation.fuelWindow
  const fuelTone = fuelWindow.tone === 'safe' ? 'is-ok' : fuelWindow.tone === 'watch' ? 'is-warn' : 'is-critical'

  // Tyre corner data
  const corners = tyreEng.corners

  return (
    <div className="telemetry-view">
      {/* Row 1: Speed + RPM + Gear */}
      <div className="telem-top-row">
        <section className="pw-panel telem-speed-panel">
          <div className="pw-panel-header">
            <span className="pw-panel-title">SPEED</span>
            {drs && <span className="drs-badge">DRS</span>}
          </div>
          <div className="telem-big-value">{formatSpeed(speed)}<span className="telem-unit">KPH</span></div>
          <SpeedTrace history={speedHistoryRef.current} />
        </section>

        <section className="pw-panel telem-rpm-panel">
          <div className="pw-panel-header">
            <span className="pw-panel-title">ENGINE</span>
          </div>
          <div className="telem-gauge-row">
            <div className="telem-gauge-item">
              <span className="telem-gauge-label">RPM</span>
              <span className="telem-gauge-value">{formatRpm(rpm)}</span>
              <div className="telem-bar-track">
                <div className="telem-bar-fill is-rpm" style={{ width: `${Math.min(100, (rpm / 15000) * 100)}%` }} />
              </div>
            </div>
            <div className="telem-gauge-item">
              <span className="telem-gauge-label">GEAR</span>
              <span className="telem-gauge-value is-gear">{gear}</span>
            </div>
          </div>
        </section>

        <section className="pw-panel telem-inputs-panel">
          <div className="pw-panel-header">
            <span className="pw-panel-title">DRIVER INPUTS</span>
          </div>
          <div className="telem-dual-bar">
            <div className="telem-input-col">
              <span className="telem-input-label">THROTTLE</span>
              <div className="telem-vertical-bar-track">
                <div className="telem-vertical-bar-fill is-throttle" style={{ height: `${throttle}%` }} />
              </div>
              <span className="telem-input-pct">{throttle}%</span>
            </div>
            <div className="telem-input-col">
              <span className="telem-input-label">BRAKE</span>
              <div className="telem-vertical-bar-track">
                <div className="telem-vertical-bar-fill is-brake" style={{ height: `${brake}%` }} />
              </div>
              <span className="telem-input-pct">{brake}%</span>
            </div>
          </div>
        </section>
      </div>

      {/* Row 2: ERS + Fuel + Tyre Temps */}
      <div className="telem-mid-row">
        <section className="pw-panel telem-ers-panel">
          <div className="pw-panel-header">
            <span className="pw-panel-title" style={{ color: 'var(--ers)' }}>ERS</span>
          </div>
          <div className="ers-gauge-wrap">
            <div className="ers-arc-bg">
              <div className="ers-arc-fill" style={{ '--pct': `${ers}%` } as Record<string, string>} />
            </div>
            <div className="ers-center-value">{ers}%</div>
          </div>
          <div className="ers-deploy-label">
            {ers > 60 ? 'HARVESTING' : ers > 20 ? 'DEPLOYING' : 'DEPLETED'}
          </div>
        </section>

        <section className="pw-panel telem-fuel-panel">
          <div className="pw-panel-header">
            <span className="pw-panel-title" style={{ color: 'var(--fuel)' }}>FUEL</span>
          </div>
          <div className="fuel-level-wrap">
            <div className="fuel-bar-track-v">
              <div className={`fuel-bar-fill-v ${fuelTone}`} style={{ height: `${Math.min(100, (fuel / 110) * 100)}%` }} />
            </div>
            <div className="fuel-stats">
              <div className="fuel-stat">
                <span className="fuel-stat-label">REMAINING</span>
                <span className="fuel-stat-value">{fuel.toFixed(1)} kg</span>
              </div>
              <div className="fuel-stat">
                <span className="fuel-stat-label">LAPS LEFT</span>
                <span className={`fuel-stat-value ${fuelTone}`}>{fuelWindow.lapsLeft}</span>
              </div>
              <div className="fuel-stat">
                <span className="fuel-stat-label">MARGIN</span>
                <span className={`fuel-stat-value ${fuelTone}`}>{fuelWindow.marginLaps > 0 ? '+' : ''}{fuelWindow.marginLaps} laps</span>
              </div>
            </div>
          </div>
        </section>

        <section className="pw-panel telem-tyre-panel">
          <div className="pw-panel-header">
            <span className="pw-panel-title">TYRE TEMPERATURES</span>
            <span className="pw-panel-subtitle">{tyreEng.compoundLabel} — Stint L{tyreEng.stintLap}</span>
          </div>
          <div className="tyre-quad-grid">
            {corners.length === 4 ? corners.map((c) => (
              <div key={c.id} className={`tyre-quad-cell ${c.tone === 'ok' ? 'is-ok' : c.tone === 'watch' ? 'is-warn' : 'is-critical'}`}>
                <span className="tyre-quad-label">{c.id}</span>
                <span className="tyre-quad-temp">{c.temperatureC}°C</span>
                <span className="tyre-quad-wear">{c.wearPct.toFixed(0)}%</span>
                <div className="tyre-quad-bar-track">
                  <div className={`tyre-quad-bar-fill ${c.thermalState === 'optimal' ? 'is-optimal' : c.thermalState === 'cold' ? 'is-cold' : 'is-hot'}`} style={{ width: `${c.wearPct}%` }} />
                </div>
              </div>
            )) : (
              <div className="panel-empty-state" style={{ gridColumn: '1 / -1' }}>타이어 데이터 대기</div>
            )}
          </div>
          {tyreEng.ready && (
            <div className="tyre-summary-row">
              <span className={`tyre-thermal-tag ${tyreEng.thermal.tone === 'ok' ? 'is-ok' : tyreEng.thermal.tone === 'watch' ? 'is-warn' : 'is-critical'}`}>
                {tyreEng.thermal.stateLabel} {tyreEng.thermal.temperatureC}°C
              </span>
              <span className="tyre-grip-tag">Grip {tyreEng.thermal.gripLevelPct}%</span>
              <span className={`tyre-deg-tag ${tyreEng.thermal.tone === 'ok' ? 'is-ok' : 'is-warn'}`}>
                Deg {tyreEng.thermal.degradationRatePctPerLap}%/lap
              </span>
            </div>
          )}
        </section>
      </div>

      {/* Row 3: Tyre Cliff Forecast + Handling Balance */}
      <div className="telem-bottom-row">
        <section className="pw-panel telem-forecast-panel">
          <div className="pw-panel-header">
            <span className="pw-panel-title">CLIFF FORECAST</span>
          </div>
          {tyreEng.forecast.cliffLap ? (
            <div className="cliff-info">
              <div className="cliff-big">LAP {tyreEng.forecast.cliffLap}</div>
              <div className="cliff-conf">Confidence {tyreEng.forecast.confidencePct}%</div>
              <div className="cliff-summary">{tyreEng.forecast.summary}</div>
              {tyreEng.forecast.points.length > 0 && (
                <div className="cliff-points">
                  {tyreEng.forecast.points.map((p, i) => (
                    <div key={i} className={`cliff-point ${p.riskTone === 'ok' ? 'is-ok' : p.riskTone === 'watch' ? 'is-warn' : 'is-critical'}`}>
                      <span>+{p.lapOffset}</span>
                      <span>{p.projectedWearPct.toFixed(0)}%</span>
                      <span>{p.projectedLapLossS > 0 ? `+${p.projectedLapLossS.toFixed(2)}s` : '-'}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="panel-empty-state">클리프 예측 데이터 부족</div>
          )}
        </section>

        <section className="pw-panel telem-balance-panel">
          <div className="pw-panel-header">
            <span className="pw-panel-title">HANDLING BALANCE</span>
          </div>
          {tyreEng.ready ? (
            <div className="balance-info">
              <div className={`balance-label ${tyreEng.imbalance.tone === 'ok' ? 'is-ok' : tyreEng.imbalance.tone === 'watch' ? 'is-warn' : 'is-critical'}`}>
                {tyreEng.imbalance.handlingLabel}
              </div>
              <div className="balance-detail">{tyreEng.imbalance.detail}</div>
              <div className="balance-spread">Spread {tyreEng.imbalance.spreadPct.toFixed(1)}% — Dominant: {tyreEng.imbalance.dominantCorner}</div>
              <div className="balance-loss">Total lap loss: +{tyreEng.totalLapLossS.toFixed(3)}s</div>
            </div>
          ) : (
            <div className="panel-empty-state">밸런스 데이터 대기</div>
          )}
        </section>

        <section className="pw-panel telem-pit-panel">
          <div className="pw-panel-header">
            <span className="pw-panel-title">PIT TIMING</span>
          </div>
          <div className={`pit-timing-card ${tyreEng.pitTiming.tone === 'ok' ? 'is-ok' : tyreEng.pitTiming.tone === 'watch' ? 'is-warn' : 'is-critical'}`}>
            <div className="pit-timing-label">{tyreEng.pitTiming.label}</div>
            <div className="pit-timing-detail">{tyreEng.pitTiming.detail}</div>
          </div>
          {tyreEng.inventory.length > 0 && (
            <div className="tyre-inventory">
              <div className="inventory-title">AVAILABLE SETS</div>
              {tyreEng.inventory.map((inv) => (
                <div key={inv.compound} className={`inventory-row ${inv.tone === 'ok' ? 'is-ok' : inv.tone === 'watch' ? 'is-warn' : 'is-critical'}`}>
                  <span className={`stint-compound-tag is-${inv.compound.toLowerCase()}`}>{inv.label}</span>
                  <span className="inventory-count">×{inv.remainingSets}</span>
                  <span className="inventory-scenario">{inv.scenario}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
