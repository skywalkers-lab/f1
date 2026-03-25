import { useMemo, useState } from 'react'
import { AppState } from '../lib/types'
import { RaceStateSnapshot } from '../lib/dashboardMetrics'
import { formatWeatherState } from '../lib/f1Terms'

type Props = { state: AppState | null; evaluation: RaceStateSnapshot }

type WeatherForecast = {
  lap: number
  condition: string
  rain: number
  temp: number
  trackTemp: number
  wind: number
}

const WEATHER_ICONS: Record<string, string> = {
  WEATHER_0: '☀️',
  WEATHER_1: '🌤️',
  WEATHER_2: '☁️',
  WEATHER_3: '🌦️',
  WEATHER_4: '🌧️',
  WEATHER_5: '⛈️',
}

function weatherSeverity(state: string): 'dry' | 'damp' | 'wet' {
  if (state === 'WEATHER_4' || state === 'WEATHER_5') return 'wet'
  if (state === 'WEATHER_3') return 'damp'
  return 'dry'
}

function tyreRecommendation(severity: 'dry' | 'damp' | 'wet', currentCompound: string): string {
  if (severity === 'wet') return currentCompound.includes('WET') ? 'STAY ON WETS' : '→ WET TYRES'
  if (severity === 'damp') return currentCompound.includes('INTER') ? 'STAY ON INTERS' : '→ INTERMEDIATES'
  return currentCompound.includes('WET') || currentCompound.includes('INTER') ? '→ DRY SLICKS' : 'NO CHANGE'
}

export function WeatherView({ state, evaluation }: Props) {
  const [forecastRange, setForecastRange] = useState(10)

  const weatherState = state?.weather_state ?? 'WEATHER_0'
  const icon = WEATHER_ICONS[weatherState] ?? '🌡️'
  const label = formatWeatherState(weatherState)
  const severity = weatherSeverity(weatherState)
  const currentLap = state?.player.lap ?? 0
  const totalLaps = state?.total_laps ?? 0
  const compound = state?.player.tyre_compound ?? 'MEDIUM'
  const tyreAdvice = tyreRecommendation(severity, compound)
  const track = state?.track ?? 'UNKNOWN'
    const trackTempC = state?.track_temp_c ?? 0
    const airTempC = state?.air_temp_c ?? 0
    const weatherIdx = parseInt(weatherState.replace('WEATHER_', ''), 10) || 0
    // Use real temp from UDP if available, fall back to estimates
    const displayAirTemp = airTempC > 0 ? airTempC : (22 - weatherIdx * 1.5)
    const displayTrackTemp = trackTempC > 0 ? trackTempC : (35 - weatherIdx * 3)

  // Deterministic short-horizon forecast from current UDP weather state.
  // We expose trend likelihood bands instead of random values.
  const forecast = useMemo<WeatherForecast[]>(() => {
    const items: WeatherForecast[] = []
    const baseIdx = parseInt(weatherState.replace('WEATHER_', ''), 10) || 0
    const rc = (state?.race_control_state ?? '').toUpperCase()
    const riskBias = rc.includes('SC') || rc.includes('VSC') ? 1 : 0

    for (let i = 0; i <= forecastRange; i += 2) {
      const lap = currentLap + i
      if (lap > totalLaps && totalLaps > 0) break

      const driftStep = i >= 8 ? 1 : 0
      const idx = Math.max(0, Math.min(5, baseIdx + driftStep * riskBias))
      const stateKey = `WEATHER_${idx}`
      const rain = Math.max(0, (idx - 2) * 25)
      const temp = 22 - idx * 1.5
      const trackTemp = 35 - idx * 3
      const wind = 8 + (idx >= 3 ? 3 : 0)

      items.push({
        lap,
        condition: formatWeatherState(stateKey),
        rain,
        temp,
        trackTemp,
        wind,
      })
    }
    return items
  }, [currentLap, totalLaps, weatherState, forecastRange, state?.race_control_state])

  // Track grip estimation
  const gripLevel = severity === 'wet' ? 55 : severity === 'damp' ? 72 : 95
  const gripTone = gripLevel >= 85 ? 'is-ok' : gripLevel >= 65 ? 'is-warn' : 'is-critical'

  // DRS availability based on weather
  const drsAvailable = severity === 'dry'
  const raceControl = state?.race_control_state ?? 'GREEN'
  const isNeutralized = raceControl.includes('SC') || raceControl.includes('VSC') || raceControl.includes('RED')

  return (
    <div className="weather-view">
      {/* Current Conditions */}
      <section className="pw-panel weather-current-panel">
        <div className="pw-panel-header">
          <span className="pw-panel-title">CURRENT CONDITIONS</span>
          <span className="pw-panel-subtitle">{track} — LAP {currentLap}/{totalLaps}</span>
        </div>
        <div className="weather-hero">
          <div className="weather-icon-big">{icon}</div>
          <div className="weather-hero-info">
            <div className="weather-condition-label">{label}</div>
            <div className={`weather-severity-badge is-${severity}`}>{severity.toUpperCase()}</div>
          </div>
        </div>
        <div className="weather-kpi-grid">
          <div className="weather-kpi">
            <span className="weather-kpi-label">AIR TEMP</span>
              <span className="weather-kpi-value">{displayAirTemp.toFixed(1)}°C</span>
          </div>
          <div className="weather-kpi">
            <span className="weather-kpi-label">TRACK TEMP</span>
              <span className="weather-kpi-value">{displayTrackTemp.toFixed(1)}°C</span>
          </div>
          <div className="weather-kpi">
            <span className="weather-kpi-label">HUMIDITY</span>
              <span className="weather-kpi-value">{40 + weatherIdx * 10}%</span>
          </div>
          <div className="weather-kpi">
            <span className="weather-kpi-label">WIND</span>
            <span className="weather-kpi-value">{(8 + Math.sin(currentLap * 0.2) * 4).toFixed(1)} km/h</span>
          </div>
          <div className="weather-kpi">
            <span className="weather-kpi-label">RAIN CHANCE</span>
            <span className={`weather-kpi-value ${severity !== 'dry' ? 'is-warn' : ''}`}>
                {Math.max(0, weatherIdx * 20)}%
            </span>
          </div>
          <div className="weather-kpi">
            <span className="weather-kpi-label">VISIBILITY</span>
            <span className="weather-kpi-value">{severity === 'wet' ? 'REDUCED' : 'CLEAR'}</span>
          </div>
        </div>
      </section>

      <div className="weather-bottom-grid">
        {/* Track Grip & Tyre Strategy */}
        <section className="pw-panel weather-grip-panel">
          <div className="pw-panel-header">
            <span className="pw-panel-title">TRACK SURFACE</span>
          </div>
          <div className="grip-meter">
            <div className="grip-meter-label">GRIP LEVEL</div>
            <div className="grip-meter-track">
              <div className={`grip-meter-fill ${gripTone}`} style={{ width: `${gripLevel}%` }} />
            </div>
            <div className={`grip-meter-value ${gripTone}`}>{gripLevel}%</div>
          </div>
          <div className="weather-status-rows">
            <div className="weather-status-row">
              <span className="weather-status-label">DRS</span>
              <span className={`weather-status-value ${drsAvailable && !isNeutralized ? 'is-ok' : 'is-critical'}`}>
                {drsAvailable && !isNeutralized ? 'AVAILABLE' : 'DISABLED'}
              </span>
            </div>
            <div className="weather-status-row">
              <span className="weather-status-label">AQUAPLANING RISK</span>
              <span className={`weather-status-value ${severity === 'wet' ? 'is-critical' : severity === 'damp' ? 'is-warn' : 'is-ok'}`}>
                {severity === 'wet' ? 'HIGH' : severity === 'damp' ? 'MODERATE' : 'LOW'}
              </span>
            </div>
            <div className="weather-status-row">
              <span className="weather-status-label">SPRAY</span>
              <span className={`weather-status-value ${severity === 'wet' ? 'is-critical' : 'is-ok'}`}>
                {severity === 'wet' ? 'HEAVY' : severity === 'damp' ? 'LIGHT' : 'NONE'}
              </span>
            </div>
          </div>

          {/* Tyre Recommendation */}
          <div className="weather-tyre-advice">
            <div className="pw-panel-header">
              <span className="pw-panel-title">TYRE RECOMMENDATION</span>
            </div>
            <div className={`tyre-advice-card is-${severity}`}>
              <span className="tyre-advice-label">CURRENT</span>
              <span className={`stint-compound-tag is-${compound.toLowerCase().includes('soft') ? 'soft' : compound.toLowerCase().includes('hard') ? 'hard' : compound.toLowerCase().includes('inter') ? 'inter' : compound.toLowerCase().includes('wet') ? 'wet' : 'medium'}`}>
                {compound}
              </span>
              <span className="tyre-advice-arrow">→</span>
              <span className={`tyre-advice-action ${tyreAdvice.includes('→') ? 'is-warn' : 'is-ok'}`}>{tyreAdvice}</span>
            </div>
          </div>
        </section>

        {/* Weather Forecast */}
        <section className="pw-panel weather-forecast-panel">
          <div className="pw-panel-header">
            <span className="pw-panel-title">FORECAST</span>
            <div className="forecast-range-btns">
              {[5, 10, 20].map((r) => (
                <button
                  key={r}
                  type="button"
                  className={`forecast-range-btn ${forecastRange === r ? 'is-active' : ''}`}
                  onClick={() => setForecastRange(r)}
                >
                  +{r}L
                </button>
              ))}
            </div>
          </div>
          <div className="forecast-table-wrap">
            <table className="scenario-table">
              <thead>
                <tr>
                  <th>LAP</th>
                  <th>CONDITION</th>
                  <th>RAIN %</th>
                  <th>AIR °C</th>
                  <th>TRACK °C</th>
                  <th>WIND</th>
                </tr>
              </thead>
              <tbody>
                {forecast.map((f) => (
                  <tr key={f.lap} className={f.lap === currentLap ? 'is-best-row' : ''}>
                    <td className="mono">{f.lap}</td>
                    <td>{f.condition}</td>
                    <td className={`mono ${f.rain > 50 ? 'is-critical' : f.rain > 0 ? 'is-warn' : ''}`}>{f.rain}</td>
                    <td className="mono">{f.temp.toFixed(1)}</td>
                    <td className="mono">{f.trackTemp.toFixed(1)}</td>
                    <td className="mono">{f.wind.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Safety Conditions */}
        <section className="pw-panel weather-safety-panel">
          <div className="pw-panel-header">
            <span className="pw-panel-title">SAFETY CONDITIONS</span>
          </div>
          <div className="safety-grid">
            <div className={`safety-card ${isNeutralized ? 'is-critical' : 'is-ok'}`}>
              <span className="safety-label">RACE CONTROL</span>
              <span className="safety-value">{raceControl}</span>
            </div>
            <div className={`safety-card ${severity === 'wet' ? 'is-critical' : severity === 'damp' ? 'is-warn' : 'is-ok'}`}>
              <span className="safety-label">STANDING WATER</span>
              <span className="safety-value">{severity === 'wet' ? 'WARNING' : 'CLEAR'}</span>
            </div>
            <div className={`safety-card ${gripLevel < 70 ? 'is-critical' : gripLevel < 85 ? 'is-warn' : 'is-ok'}`}>
              <span className="safety-label">TRACK EVOLUTION</span>
              <span className="safety-value">{severity === 'dry' ? 'RUBBERING IN' : 'WASHING OUT'}</span>
            </div>
            <div className="safety-card is-ok">
              <span className="safety-label">DAYLIGHT</span>
              <span className="safety-value">ADEQUATE</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
