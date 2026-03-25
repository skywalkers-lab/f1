/**
 * MFDOverlay — Multi-Function Display with paginated strategy information.
 * Inspired by pits-n-giggles' MFD overlay (7 pages: fuel, tyre_wear, weather, etc.).
 * Navigate pages with keyboard arrows or touch.
 */
import { memo, useState, useCallback, useEffect } from 'react'

type TyreInfo = {
  compound: string
  wearPct: number
  stintLap: number
  surfaceTemps: number[]
  innerTemps: number[]
}

type FuelInfo = {
  fuelKg: number
  fuelLapsRemaining: number
  fuelPerLap: number
  targetDelta: number
}

type WeatherInfo = {
  state: string
  trackTempC: number
  airTempC: number
}

type LapInfo = {
  currentMs: number
  lastMs: number
  bestMs: number
  lap: number
  totalLaps: number
}

type ERSInfo = {
  ersPct: number
  ersDeployMode: string
}

type DamageInfo = {
  frontWing: number
  rearWing: number
  floor: number
  diffuser: number
  engine: number
  gearbox: number
}

type Props = {
  tyre: TyreInfo
  fuel: FuelInfo
  weather: WeatherInfo
  laps: LapInfo
  ers: ERSInfo
  damage: DamageInfo
  position: number
}

type MFDPage = 'TYRE' | 'FUEL' | 'WEATHER' | 'LAPS' | 'ERS' | 'DAMAGE'
const MFD_PAGES: MFDPage[] = ['TYRE', 'FUEL', 'WEATHER', 'LAPS', 'ERS', 'DAMAGE']

function formatTime(ms: number): string {
  if (ms <= 0) return '--:--.---'
  const totalS = ms / 1000
  const min = Math.floor(totalS / 60)
  const sec = totalS % 60
  return `${min}:${sec.toFixed(3).padStart(6, '0')}`
}

function wearLevel(pct: number): string {
  if (pct >= 70) return 'is-critical'
  if (pct >= 45) return 'is-warn'
  return 'is-ok'
}

function compoundLabel(c: string): string {
  const u = c?.toUpperCase() || ''
  if (u.includes('SOFT')) return 'SOFT'
  if (u.includes('MED')) return 'MEDIUM'
  if (u.includes('HARD')) return 'HARD'
  if (u.includes('INTER')) return 'INTER'
  if (u.includes('WET')) return 'WET'
  return u || '?'
}

// ── Page renderers ─────────────────────────────────────────

function TyrePage({ tyre }: { tyre: TyreInfo }) {
  const labels = ['FL', 'FR', 'RL', 'RR']
  return (
    <div className="mfd-page mfd-tyre">
      <div className="mfd-page-title">TYRE WEAR</div>
      <div className={`mfd-compound ${tyre.compound.toLowerCase()}`}>
        {compoundLabel(tyre.compound)} · L{tyre.stintLap}
      </div>
      <div className="mfd-tyre-grid">
        {labels.map((lbl, i) => {
          const surfTemp = tyre.surfaceTemps?.[i] ?? 0
          const innerTemp = tyre.innerTemps?.[i] ?? 0
          return (
            <div key={lbl} className="mfd-tyre-cell">
              <span className="mfd-tyre-label">{lbl}</span>
              <div className={`mfd-tyre-bar ${wearLevel(tyre.wearPct)}`}>
                <div className="mfd-tyre-bar-fill" style={{ width: `${Math.min(100, tyre.wearPct)}%` }} />
              </div>
              <span className="mfd-tyre-temp">{surfTemp.toFixed(0)}°/{innerTemp.toFixed(0)}°</span>
            </div>
          )
        })}
      </div>
      <div className="mfd-wear-summary">{tyre.wearPct.toFixed(1)}% avg wear</div>
    </div>
  )
}

function FuelPage({ fuel }: { fuel: FuelInfo }) {
  const fuelOk = fuel.fuelLapsRemaining > 3
  return (
    <div className="mfd-page mfd-fuel">
      <div className="mfd-page-title">FUEL</div>
      <div className="mfd-fuel-main">
        <span className="mfd-fuel-kg">{fuel.fuelKg.toFixed(1)} kg</span>
        <span className={`mfd-fuel-laps ${fuelOk ? 'is-ok' : 'is-critical'}`}>
          {fuel.fuelLapsRemaining.toFixed(1)} laps
        </span>
      </div>
      <div className="mfd-fuel-detail">
        <div className="mfd-kv-row">
          <span>Consumption</span>
          <span>{fuel.fuelPerLap.toFixed(2)} kg/lap</span>
        </div>
        <div className="mfd-kv-row">
          <span>Target Δ</span>
          <span className={fuel.targetDelta >= 0 ? 'is-ok' : 'is-warn'}>
            {fuel.targetDelta >= 0 ? '+' : ''}{fuel.targetDelta.toFixed(2)} kg
          </span>
        </div>
      </div>
      <div className="mfd-fuel-bar">
        <div
          className={`mfd-fuel-bar-fill ${fuelOk ? '' : 'is-low'}`}
          style={{ width: `${Math.min(100, (fuel.fuelKg / 110) * 100)}%` }}
        />
      </div>
    </div>
  )
}

function WeatherPage({ weather }: { weather: WeatherInfo }) {
  const weatherLabel = (s: string) => {
    if (s.includes('0')) return '☀ CLEAR'
    if (s.includes('1')) return '🌤 LIGHT CLOUD'
    if (s.includes('2')) return '☁ OVERCAST'
    if (s.includes('3')) return '🌧 LIGHT RAIN'
    if (s.includes('4')) return '🌧 HEAVY RAIN'
    if (s.includes('5')) return '⛈ STORM'
    return s
  }
  return (
    <div className="mfd-page mfd-weather">
      <div className="mfd-page-title">WEATHER</div>
      <div className="mfd-weather-state">{weatherLabel(weather.state)}</div>
      <div className="mfd-weather-temps">
        <div className="mfd-kv-row">
          <span>Track</span>
          <span>{weather.trackTempC}°C</span>
        </div>
        <div className="mfd-kv-row">
          <span>Air</span>
          <span>{weather.airTempC}°C</span>
        </div>
      </div>
    </div>
  )
}

function LapsPage({ laps }: { laps: LapInfo }) {
  return (
    <div className="mfd-page mfd-laps">
      <div className="mfd-page-title">LAP TIMES</div>
      <div className="mfd-laps-counter">LAP {laps.lap}/{laps.totalLaps}</div>
      <div className="mfd-kv-row">
        <span>Current</span>
        <span>{formatTime(laps.currentMs)}</span>
      </div>
      <div className="mfd-kv-row">
        <span>Last</span>
        <span>{formatTime(laps.lastMs)}</span>
      </div>
      <div className="mfd-kv-row">
        <span>Best</span>
        <span className="is-purple">{formatTime(laps.bestMs)}</span>
      </div>
    </div>
  )
}

function ERSPage({ ers }: { ers: ERSInfo }) {
  return (
    <div className="mfd-page mfd-ers">
      <div className="mfd-page-title">ERS</div>
      <div className="mfd-ers-ring">
        <svg viewBox="0 0 100 100" width={80} height={80}>
          <circle cx={50} cy={50} r={40} className="mfd-ers-bg-ring" />
          <circle
            cx={50} cy={50} r={40}
            className="mfd-ers-fill-ring"
            strokeDasharray={`${ers.ersPct * 2.512} ${251.2 - ers.ersPct * 2.512}`}
            strokeDashoffset={62.8}
          />
          <text x={50} y={54} className="mfd-ers-pct">{ers.ersPct.toFixed(0)}%</text>
        </svg>
      </div>
      <div className="mfd-ers-mode">{ers.ersDeployMode || 'BALANCED'}</div>
    </div>
  )
}

function DamagePage({ damage }: { damage: DamageInfo }) {
  const items = [
    { label: 'Front Wing', pct: damage.frontWing },
    { label: 'Rear Wing', pct: damage.rearWing },
    { label: 'Floor', pct: damage.floor },
    { label: 'Diffuser', pct: damage.diffuser },
    { label: 'Engine', pct: damage.engine },
    { label: 'Gearbox', pct: damage.gearbox },
  ]
  return (
    <div className="mfd-page mfd-damage">
      <div className="mfd-page-title">DAMAGE</div>
      {items.map((item) => (
        <div key={item.label} className="mfd-damage-row">
          <span className="mfd-damage-label">{item.label}</span>
          <div className="mfd-damage-bar">
            <div
              className={`mfd-damage-bar-fill ${item.pct > 50 ? 'is-critical' : item.pct > 20 ? 'is-warn' : ''}`}
              style={{ width: `${Math.min(100, item.pct)}%` }}
            />
          </div>
          <span className="mfd-damage-pct">{item.pct}%</span>
        </div>
      ))}
    </div>
  )
}

// ── Main MFD component ─────────────────────────────────────

function MFDComponent({ tyre, fuel, weather, laps, ers, damage, position }: Props) {
  const [pageIndex, setPageIndex] = useState(0)
  const page = MFD_PAGES[pageIndex]

  const nextPage = useCallback(() => {
    setPageIndex((prev) => (prev + 1) % MFD_PAGES.length)
  }, [])

  const prevPage = useCallback(() => {
    setPageIndex((prev) => (prev - 1 + MFD_PAGES.length) % MFD_PAGES.length)
  }, [])

  // Keyboard navigation (← →)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); nextPage() }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); prevPage() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [nextPage, prevPage])

  const renderPage = () => {
    switch (page) {
      case 'TYRE': return <TyrePage tyre={tyre} />
      case 'FUEL': return <FuelPage fuel={fuel} />
      case 'WEATHER': return <WeatherPage weather={weather} />
      case 'LAPS': return <LapsPage laps={laps} />
      case 'ERS': return <ERSPage ers={ers} />
      case 'DAMAGE': return <DamagePage damage={damage} />
    }
  }

  return (
    <div className="overlay-mfd">
      <div className="mfd-nav">
        <button type="button" className="mfd-nav-btn" onClick={prevPage} aria-label="Previous page">◀</button>
        <div className="mfd-nav-dots">
          {MFD_PAGES.map((p, i) => (
            <span
              key={p}
              className={`mfd-dot ${i === pageIndex ? 'is-active' : ''}`}
              onClick={() => setPageIndex(i)}
            />
          ))}
        </div>
        <button type="button" className="mfd-nav-btn" onClick={nextPage} aria-label="Next page">▶</button>
      </div>
      {renderPage()}
      <div className="mfd-footer">
        <span className="mfd-page-label">{page}</span>
        <span className="mfd-page-count">{pageIndex + 1}/{MFD_PAGES.length}</span>
      </div>
    </div>
  )
}

export const MFDOverlay = memo(MFDComponent)
