import { memo, useState, useCallback } from 'react'
import { AppState } from '../lib/types'
import { postStrategyFeedback } from '../lib/ws'

import { RaceStateSnapshot } from '../lib/dashboardMetrics'

type Props = { state: AppState | null; evaluation: RaceStateSnapshot }

export const BottomBar = memo(function BottomBar({ state, evaluation }: Props) {
  const ersPct = Math.max(0, Math.min(100, ((state?.player.ers ?? 0) / 4_000_000) * 100))
  const fuel = state?.player.fuel ?? 0
  const fuelWindow = evaluation.fuelWindow
  const [activeAction, setActiveAction] = useState<string | null>(null)

  const actionCall = evaluation.recommendedActionState.call

  const handleAction = useCallback(async (action: string) => {
    setActiveAction(action)
    const rewardMap: Record<string, number> = {
      PIT_NOW: 1.0,
      BOX: 1.0,
      PUSH: 0.5,
      STAY_OUT: 0.3,
      ALT_STRAT: 0.2,
    }
    await postStrategyFeedback({
      action,
      reward: rewardMap[action] ?? 0.5,
      context: {
        lap: state?.player.lap,
        tyre_wear: state?.leaderboard?.find(r => r.car_index === state?.player_car_index)?.tyre_wear_pct,
        fuel_remaining: fuel,
      },
    })
    setTimeout(() => setActiveAction(null), 1500)
  }, [state, fuel])

  return (
    <div className="bottom-bar">
      {/* ERS Gauge */}
      <div className="bb-gauge">
        <span className="bb-gauge-label is-ers">ERS BATTERY</span>
        <div className="bb-gauge-bar">
          <div className="bb-gauge-fill is-ers" style={{ width: `${ersPct}%` }} />
        </div>
        <span className="bb-gauge-value">{ersPct.toFixed(0)}%</span>
      </div>

      {/* Fuel Gauge */}
      <div className="bb-gauge">
        <span className="bb-gauge-label is-fuel">FUEL</span>
        <div className="bb-gauge-bar">
          <div className="bb-gauge-fill is-fuel" style={{ width: `${Math.min(100, (fuel / 110) * 100)}%` }} />
        </div>
        <span className="bb-gauge-value">{fuel.toFixed(1)}kg</span>
      </div>

      {/* Tyre temps from UDP telemetry (surface temperatures, no random values) */}
      <div className="bb-tyre-temps">
        {(['FL', 'FR', 'RL', 'RR'] as const).map((corner, idx) => {
          const temp = state?.player.tyre_surface_temps_c?.[idx] ?? 0
          const hasData = temp > 0
          const pct = hasData ? Math.min(100, Math.max(0, ((temp - 60) / 80) * 100)) : 0
          const tempColor = !hasData
            ? 'var(--text-muted)'
            : temp > 110
              ? 'var(--critical)'
              : temp > 100
                ? 'var(--warn)'
                : 'var(--ok)'
          return (
            <div key={corner} className="bb-tyre-temp">
              <span className="bb-tyre-temp-label">{corner}</span>
              <div className="bb-tyre-temp-bar">
                <div className="bb-tyre-temp-fill" style={{ width: `${pct}%`, background: tempColor }} />
              </div>
              <span className="bb-tyre-temp-value">{hasData ? `${temp.toFixed(0)}°` : '--'}</span>
            </div>
          )
        })}
      </div>

      {/* Action Buttons */}
      <div className="bb-actions">
        <button type="button" className={`bb-btn is-pit-call ${activeAction === 'PIT_NOW' ? 'is-pressed' : ''}`} onClick={() => handleAction('PIT_NOW')}>
          🏁 PIT CALL
        </button>
        <button type="button" className={`bb-btn ${actionCall === 'BOX' ? 'is-box-now' : ''} ${activeAction === 'BOX' ? 'is-pressed' : ''}`} onClick={() => handleAction(actionCall === 'BOX' ? 'BOX' : 'PUSH')}>
          {actionCall === 'BOX' ? '▶▶ BOX_NOW' : actionCall === 'PUSH' ? '▶▶ PUSH' : '▶▶ ' + actionCall}
        </button>
        <button type="button" className={`bb-btn is-stay-out ${activeAction === 'STAY_OUT' ? 'is-pressed' : ''}`} onClick={() => handleAction('STAY_OUT')}>
          ⏸ STAY OUT
        </button>
        <button type="button" className={`bb-btn ${activeAction === 'ALT_STRAT' ? 'is-pressed' : ''}`} onClick={() => handleAction('ALT_STRAT')}>
          ⇆ ALT STRAT
        </button>
      </div>
    </div>
  )
})
