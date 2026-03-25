/**
 * DriverHud — Lightweight tactical HUD overlay for in-race use.
 *
 * Displays: penalty risk, damage analysis, pit decision, rival tyre state.
 * Designed for minimal visual footprint with maximum information density.
 * Each widget is independently positionable and configurable.
 */
import { useCallback, useEffect, useRef, useState, useMemo } from 'react'
import { connectHud } from '../lib/hudWs'
import { HudState, HudLayoutConfig, DEFAULT_HUD_LAYOUT } from '../lib/hudTypes'

// ── Sub-widgets ─────────────────────────────────────────────

function PenaltyWidget({ penalty, opacity }: { penalty: HudState['penalty']; opacity: number }) {
  if (penalty.level === 'ok' && penalty.corner_cuts === 0) return null
  const levelClass = `hud-penalty-${penalty.level}`
  return (
    <div className={`hud-widget hud-penalty ${levelClass}`} style={{ opacity }}>
      <div className="hud-widget-label">PENALTY RISK</div>
      <div className="hud-penalty-bar">
        <div className="hud-penalty-indicator">
          {Array.from({ length: 5 }, (_, i) => (
            <span
              key={i}
              className={`hud-penalty-dot ${i < penalty.corner_cuts ? 'is-active' : ''}`}
            />
          ))}
        </div>
        <span className="hud-penalty-count">{penalty.corner_cuts}/5</span>
      </div>
      {penalty.message && <div className="hud-penalty-msg">{penalty.message}</div>}
      {penalty.time_penalties_s > 0 && (
        <div className="hud-penalty-time">+{penalty.time_penalties_s}s PENALTY</div>
      )}
    </div>
  )
}

function DamageWidget({ damage, opacity }: { damage: HudState['damage']; opacity: number }) {
  if (damage.total_time_loss_ms === 0) return null
  return (
    <div className={`hud-widget hud-damage ${damage.critical ? 'is-critical' : ''}`} style={{ opacity }}>
      <div className="hud-widget-label">DAMAGE</div>
      <div className="hud-damage-total">
        +{(damage.total_time_loss_ms / 1000).toFixed(2)}s/lap
      </div>
      <div className="hud-damage-components">
        {damage.components.slice(0, 4).map((c) => (
          <div key={c.name} className="hud-damage-item">
            <span className="hud-damage-name">{formatComponentName(c.name)}</span>
            <div className="hud-damage-bar-track">
              <div
                className={`hud-damage-bar-fill ${c.damage_pct >= 50 ? 'is-severe' : c.damage_pct >= 25 ? 'is-moderate' : ''}`}
                style={{ width: `${Math.min(c.damage_pct, 100)}%` }}
              />
            </div>
            <span className="hud-damage-loss">+{(c.time_loss_ms / 1000).toFixed(1)}s</span>
          </div>
        ))}
      </div>
      {damage.critical && <div className="hud-damage-alert">⚠ PIT RECOMMENDED</div>}
    </div>
  )
}

function PitDecisionWidget({ pit, opacity }: { pit: HudState['pit_decision']; opacity: number }) {
  const urgencyClass = `hud-pit-${pit.urgency}`
  return (
    <div className={`hud-widget hud-pit ${urgencyClass}`} style={{ opacity }}>
      <div className="hud-widget-label">PIT STRATEGY</div>
      <div className="hud-pit-decision">
        {pit.should_pit ? (
          <span className="hud-pit-call is-box">BOX</span>
        ) : (
          <span className="hud-pit-call is-stay">STAY OUT</span>
        )}
      </div>
      <div className="hud-pit-detail">
        <div className="hud-pit-row">
          <span className="hud-pit-label">Tyres left</span>
          <span className={`hud-pit-value ${pit.laps_can_survive <= 3 ? 'is-critical' : ''}`}>
            {pit.laps_can_survive} laps
          </span>
        </div>
        <div className="hud-pit-row">
          <span className="hud-pit-label">Pit cost</span>
          <span className="hud-pit-value">-{pit.pit_cost_s.toFixed(1)}s</span>
        </div>
        {pit.pit_gain_s > 0 && (
          <div className="hud-pit-row">
            <span className="hud-pit-label">Fresh gain</span>
            <span className="hud-pit-value is-gain">+{pit.pit_gain_s.toFixed(1)}s</span>
          </div>
        )}
        <div className="hud-pit-row">
          <span className="hud-pit-label">Stay loss</span>
          <span className="hud-pit-value is-loss">-{pit.stay_out_loss_s.toFixed(1)}s</span>
        </div>
      </div>
      <div className="hud-pit-reason">{pit.reason}</div>
    </div>
  )
}

function RivalWidget({ ahead, behind, opacity }: {
  ahead: HudState['car_ahead']
  behind: HudState['car_behind']
  opacity: number
}) {
  if (!ahead && !behind) return null
  return (
    <div className="hud-widget hud-rivals" style={{ opacity }}>
      <div className="hud-widget-label">RIVALS</div>
      {ahead && (
        <RivalCard rival={ahead} direction="AHEAD" />
      )}
      {behind && (
        <RivalCard rival={behind} direction="BEHIND" />
      )}
    </div>
  )
}

function RivalCard({ rival, direction }: {
  rival: NonNullable<HudState['car_ahead']>
  direction: 'AHEAD' | 'BEHIND'
}) {
  const trendIcon = rival.pace_trend === 'degrading' ? '↓' : rival.pace_trend === 'improving' ? '↑' : '→'
  const tacticalLabel = rival.is_vulnerable
    ? 'ATTACK'
    : rival.is_threatening
    ? 'DEFEND'
    : ''

  return (
    <div className={`hud-rival-card ${rival.is_vulnerable ? 'is-vulnerable' : rival.is_threatening ? 'is-threatening' : ''}`}>
      <div className="hud-rival-header">
        <span className="hud-rival-dir">{direction}</span>
        <span className="hud-rival-code">{rival.driver_code}</span>
        <span className="hud-rival-gap">
          {rival.gap_ms > 0 ? '+' : ''}{(rival.gap_ms / 1000).toFixed(1)}s
        </span>
      </div>
      <div className="hud-rival-detail">
        <span className={`hud-rival-compound is-${rival.compound.toLowerCase()}`}>
          {rival.compound}
        </span>
        <span className="hud-rival-stint">L{rival.stint_laps}</span>
        <span className="hud-rival-wear">
          ~{rival.estimated_wear_pct.toFixed(0)}%
        </span>
        <span className={`hud-rival-trend is-${rival.pace_trend}`}>
          {trendIcon}
        </span>
      </div>
      {tacticalLabel && (
        <div className={`hud-rival-tactical ${rival.is_vulnerable ? 'is-attack' : 'is-defend'}`}>
          {tacticalLabel}
        </div>
      )}
    </div>
  )
}

function StatusBar({ hud, opacity }: { hud: HudState; opacity: number }) {
  return (
    <div className="hud-status-bar" style={{ opacity }}>
      <span className="hud-sb-item hud-sb-pos">P{hud.position}</span>
      <span className="hud-sb-item hud-sb-lap">L{hud.lap}/{hud.total_laps}</span>
      <span className={`hud-sb-item hud-sb-tyre is-${hud.tyre_compound.toLowerCase()}`}>
        {hud.tyre_compound} {hud.tyre_wear_pct.toFixed(0)}%
      </span>
      <span className="hud-sb-item hud-sb-fuel">{hud.fuel.toFixed(1)}kg</span>
      <span className="hud-sb-item hud-sb-ers">{hud.ers_pct.toFixed(0)}%</span>
      {hud.drs_enabled && <span className="hud-sb-item hud-sb-drs">DRS</span>}
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────

function formatComponentName(name: string): string {
  const map: Record<string, string> = {
    front_wing: 'F.WING',
    rear_wing: 'R.WING',
    floor: 'FLOOR',
    diffuser: 'DIFF',
    sidepod: 'SIDEPOD',
    engine: 'ENGINE',
    gearbox: 'GEARBOX',
    tyres: 'TYRES',
    brakes: 'BRAKES',
  }
  return map[name] || name.toUpperCase()
}

// ── Main DriverHud component ────────────────────────────

type DriverHudProps = {
  embedded?: boolean // If true, render inside existing UI (non-overlay mode)
}

export function DriverHud({ embedded }: DriverHudProps) {
  const [hud, setHud] = useState<HudState | null>(null)
  const [status, setStatus] = useState('connecting')
  const [configMode, setConfigMode] = useState(false)
  const [layout, setLayout] = useState<HudLayoutConfig>(() => {
    try {
      const stored = localStorage.getItem('hud-layout')
      if (stored) return JSON.parse(stored)
    } catch { /* use defaults */ }
    return DEFAULT_HUD_LAYOUT
  })

  useEffect(() => {
    const disconnect = connectHud(setHud, setStatus)
    return disconnect
  }, [])

  // Persist layout changes
  useEffect(() => {
    try {
      localStorage.setItem('hud-layout', JSON.stringify(layout))
    } catch { /* storage full, ignore */ }
  }, [layout])

  const getWidgetConfig = useCallback((id: string) => {
    return layout.widgets.find((w) => w.id === id) ?? DEFAULT_HUD_LAYOUT.widgets.find((w) => w.id === id)!
  }, [layout])

  const toggleWidget = useCallback((id: string) => {
    setLayout((prev) => ({
      ...prev,
      widgets: prev.widgets.map((w) =>
        w.id === id ? { ...w, visible: !w.visible } : w
      ),
    }))
  }, [])

  const updateWidgetOpacity = useCallback((id: string, opacity: number) => {
    setLayout((prev) => ({
      ...prev,
      widgets: prev.widgets.map((w) =>
        w.id === id ? { ...w, opacity: Math.max(0.1, Math.min(1, opacity)) } : w
      ),
    }))
  }, [])

  const resetLayout = useCallback(() => {
    setLayout(DEFAULT_HUD_LAYOUT)
  }, [])

  if (!hud) {
    return (
      <div className={`hud-overlay ${embedded ? 'is-embedded' : ''}`}>
        <div className="hud-connecting">
          {status === 'connecting' ? 'Connecting to HUD...' : 'HUD Disconnected — Reconnecting...'}
        </div>
      </div>
    )
  }

  const penaltyCfg = getWidgetConfig('penalty')
  const damageCfg = getWidgetConfig('damage')
  const pitCfg = getWidgetConfig('pit-decision')
  const rivalsCfg = getWidgetConfig('rivals')
  const statusBarCfg = getWidgetConfig('status-bar')

  return (
    <div className={`hud-overlay ${embedded ? 'is-embedded' : ''} ${configMode ? 'is-config' : ''}`}>
      {/* Status bar (always top) */}
      {statusBarCfg.visible && (
        <StatusBar hud={hud} opacity={statusBarCfg.opacity * layout.globalOpacity} />
      )}

      {/* Floating widgets */}
      <div className="hud-widgets-container">
        {penaltyCfg.visible && (
          <PenaltyWidget penalty={hud.penalty} opacity={penaltyCfg.opacity * layout.globalOpacity} />
        )}
        {damageCfg.visible && (
          <DamageWidget damage={hud.damage} opacity={damageCfg.opacity * layout.globalOpacity} />
        )}
        {pitCfg.visible && (
          <PitDecisionWidget pit={hud.pit_decision} opacity={pitCfg.opacity * layout.globalOpacity} />
        )}
        {rivalsCfg.visible && (
          <RivalWidget
            ahead={hud.car_ahead}
            behind={hud.car_behind}
            opacity={rivalsCfg.opacity * layout.globalOpacity}
          />
        )}
      </div>

      {/* Config panel toggle */}
      <button
        className="hud-config-toggle"
        type="button"
        onClick={() => setConfigMode(!configMode)}
        title="Configure HUD Layout"
      >
        ⚙
      </button>

      {/* Config panel */}
      {configMode && (
        <div className="hud-config-panel">
          <div className="hud-config-header">
            <span>HUD CONFIGURATION</span>
            <button type="button" className="hud-config-close" onClick={() => setConfigMode(false)}>✕</button>
          </div>
          <div className="hud-config-body">
            <div className="hud-config-row">
              <span>Global Opacity</span>
              <input
                type="range"
                min="0.1"
                max="1"
                step="0.05"
                value={layout.globalOpacity}
                onChange={(e) => setLayout((prev) => ({ ...prev, globalOpacity: parseFloat(e.target.value) }))}
              />
              <span>{(layout.globalOpacity * 100).toFixed(0)}%</span>
            </div>
            {layout.widgets.map((w) => (
              <div key={w.id} className="hud-config-row">
                <label className="hud-config-label">
                  <input
                    type="checkbox"
                    checked={w.visible}
                    onChange={() => toggleWidget(w.id)}
                  />
                  {w.id.toUpperCase()}
                </label>
                <input
                  type="range"
                  min="0.1"
                  max="1"
                  step="0.05"
                  value={w.opacity}
                  disabled={!w.visible}
                  onChange={(e) => updateWidgetOpacity(w.id, parseFloat(e.target.value))}
                />
              </div>
            ))}
            <button type="button" className="hud-config-reset" onClick={resetLayout}>
              RESET DEFAULTS
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
