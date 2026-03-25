import { useMemo, useState, memo } from 'react'
import { AppState } from '../lib/types'
import { useTelemetryTrendBuffer } from '../hooks/useTelemetryTrendBuffer'
import { decimate, movingAverage } from '../lib/telemetryTrend'

type Props = { state: AppState | null }

const WINDOW_OPTIONS = [30_000, 60_000, 120_000] as const
const MAX_POINTS = 360
const MAX_SVG_POINTS = 120

function formatDelta(ms: number): string {
  const seconds = ms / 1000
  return `${seconds >= 0 ? '+' : ''}${seconds.toFixed(3)}s`
}

function polylineFromPoints(values: number[], min: number, max: number): string {
  if (values.length < 2) return ''
  const range = max - min || 1
  return values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * 100
      const y = 100 - ((value - min) / range) * 100
      return `${x.toFixed(3)},${y.toFixed(3)}`
    })
    .join(' ')
}

function MiniChart({
  title,
  unit,
  color,
  values,
  secondaryValues,
  secondaryColor,
  min,
  max,
  latest,
}: {
  title: string
  unit: string
  color: string
  values: number[]
  secondaryValues?: number[]
  secondaryColor?: string
  min: number
  max: number
  latest: string
}) {
  const points = useMemo(() => polylineFromPoints(values, min, max), [values, min, max])
  const secondaryPoints = useMemo(
    () => (secondaryValues ? polylineFromPoints(secondaryValues, min, max) : ''),
    [secondaryValues, min, max],
  )

  return (
    <article className="trend-card">
      <div className="trend-head">
        <h4>{title}</h4>
        <div className="trend-latest">{latest}{unit}</div>
      </div>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="trend-svg" aria-hidden="true">
        <line x1="0" y1="50" x2="100" y2="50" className="trend-midline" />
        {secondaryPoints ? (
          <polyline points={secondaryPoints} style={{ stroke: secondaryColor ?? '#ff7a7a' }} className="trend-line is-secondary" />
        ) : null}
        {points ? <polyline points={points} style={{ stroke: color }} className="trend-line" /> : null}
      </svg>
    </article>
  )
}

export const TelemetryTrendsPanel = memo(function TelemetryTrendsPanel({ state }: Props) {
  const [windowMs, setWindowMs] = useState<number>(60_000)
  const points = useTelemetryTrendBuffer(state, { windowMs, maxPoints: MAX_POINTS })
  const playerRow = state?.leaderboard?.find((row) => row.car_index === state.player_car_index)

  const throttle = useMemo(() => movingAverage(points.map((p) => p.throttle * 100), 3), [points])
  const brake = useMemo(() => movingAverage(points.map((p) => p.brake * 100), 3), [points])
  const speed = useMemo(() => movingAverage(points.map((p) => p.speed), 4), [points])
  const gearRpm = useMemo(() => movingAverage(points.map((p) => p.rpm), 2), [points])
  const ers = useMemo(() => movingAverage(points.map((p) => p.ersPct), 3), [points])
  const lapDelta = useMemo(() => movingAverage(points.map((p) => p.lapDeltaMs / 1000), 5), [points])

  const throttleView = useMemo(() => decimate(throttle, MAX_SVG_POINTS), [throttle])
  const brakeView = useMemo(() => decimate(brake, MAX_SVG_POINTS), [brake])
  const speedView = useMemo(() => decimate(speed, MAX_SVG_POINTS), [speed])
  const gearRpmView = useMemo(() => decimate(gearRpm, MAX_SVG_POINTS), [gearRpm])
  const ersView = useMemo(() => decimate(ers, MAX_SVG_POINTS), [ers])
  const lapDeltaView = useMemo(() => decimate(lapDelta, MAX_SVG_POINTS), [lapDelta])

  const latest = points[points.length - 1]
  const speedMax = Math.max(220, Math.min(390, Math.ceil(Math.max(...speedView, 220) / 20) * 20))
  const speedMin = speedView.length ? Math.min(...speedView) : 0
  const deltaExtremes = lapDeltaView.length ? `${Math.min(...lapDeltaView).toFixed(2)} / ${Math.max(...lapDeltaView).toFixed(2)}` : '-'
  const paceStability = `${Math.max(0, Math.min(100, state?.pace.consistency_pct ?? 0)).toFixed(0)}%`
  const sectorSummary = (playerRow?.sector_marks ?? []).map((mark) => (mark === 'purple' ? 'P' : mark === 'green' ? 'G' : '-')).join(' · ') || '-'

  if (!state || points.length === 0) {
    return (
      <section className="panel telemetry-trends-panel">
        <div className="panel-header">
          <h3>텔레메트리 트렌드 <span className="badge-raw">LIVE</span></h3>
          <div className="small">샘플 버퍼 대기</div>
        </div>
        <div className="panel-empty-state">스로틀, 브레이크, 속도, RPM 샘플이 쌓이면 최근 구간 추이를 자동 렌더링합니다.</div>
      </section>
    )
  }

  return (
    <section className="panel telemetry-trends-panel">
      <div className="panel-header">
        <h3>텔레메트리 트렌드 <span className="badge-raw">LIVE</span><span className="badge-est">60S</span></h3>
        <div className="small">윈도우: {Math.round(windowMs / 1000)}초 / 샘플: {points.length} / 렌더 포인트: {speedView.length}</div>
      </div>

      <div className="trend-toolbar" role="group" aria-label="트렌드 윈도우 선택">
        {WINDOW_OPTIONS.map((option) => (
          <button
            key={option}
            type="button"
            className={`trend-window-btn ${windowMs === option ? 'is-active' : ''}`}
            onClick={() => setWindowMs(option)}
            aria-pressed={windowMs === option}
          >
            {option / 1000}s
          </button>
        ))}
      </div>

      <div className="trend-grid">
        <MiniChart
          title="스로틀 / 브레이크"
          unit="%"
          color="#00d2ff"
          values={throttleView.length >= 2 ? throttleView : [0, 0]}
          secondaryValues={brakeView.length >= 2 ? brakeView : [0, 0]}
          secondaryColor="#ff6d6d"
          min={0}
          max={100}
          latest={`${Math.round(latest?.throttle ? latest.throttle * 100 : 0)} / ${Math.round(latest?.brake ? latest.brake * 100 : 0)}`}
        />
        <MiniChart
          title="속도"
          unit=" km/h"
          color="#53ffa5"
          values={speedView.length >= 2 ? speedView : [0, 0]}
          min={0}
          max={speedMax}
          latest={`${Math.round(latest?.speed ?? 0)}`}
        />
        <MiniChart
          title="기어 / RPM"
          unit=" rpm"
          color="#ffc254"
          values={gearRpmView.length >= 2 ? gearRpmView : [0, 0]}
          min={0}
          max={14000}
          latest={`G${latest?.gear ?? 0} · ${Math.round(gearRpmView[gearRpmView.length - 1] ?? 0)}`}
        />
        <MiniChart
          title="ERS"
          unit=" %"
          color="#4ecbff"
          values={ersView.length >= 2 ? ersView : [0, 0]}
          min={0}
          max={100}
          latest={`${Math.round(latest?.ersPct ?? 0)}`}
        />
        <MiniChart
          title="랩 델타"
          unit=" s"
          color="#ff8484"
          values={lapDeltaView.length >= 2 ? lapDeltaView : [0, 0]}
          min={-5}
          max={5}
          latest={formatDelta(latest?.lapDeltaMs ?? 0)}
        />
      </div>
      <div className="telemetry-kpi-row">
        <div className="kpi">
          <div className="label">속도 범위</div>
          <div className="value">{Math.round(speedMin)}-{Math.round(speedMax)} km/h</div>
        </div>
        <div className="kpi">
          <div className="label">델타 범위</div>
          <div className="value">{deltaExtremes}s</div>
        </div>
        <div className="kpi">
          <div className="label">페이스 안정성</div>
          <div className="value">{paceStability}</div>
        </div>
        <div className="kpi">
          <div className="label">섹터 성능</div>
          <div className="value">{sectorSummary}</div>
        </div>
      </div>
      <div className="footer-note">스로틀과 브레이크를 동일 윈도우로 표시해 라이브 주행 중 급격한 입력 변화를 쉽게 비교합니다.</div>
    </section>
  )
})
