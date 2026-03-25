/**
 * InputTelemetryOverlay — Real-time throttle/brake/steering visualization.
 * Inspired by pits-n-giggles' input_telemetry overlay (QML-based).
 * Pure SVG rendering for minimal CPU overhead at ~30Hz.
 */
import { memo, useRef, useEffect, useCallback } from 'react'

type Props = {
  throttle: number   // 0..1
  brake: number      // 0..1
  steer: number      // -1..1
  speed: number      // km/h
  gear: number       // 0-8 (0=N, -1=R)
  rpm: number        // 0-15000
  drs: boolean
}

const W = 320
const H = 180
const BAR_W = 40
const BAR_H = 120
const BAR_Y = 30
const STEER_CX = W / 2
const STEER_CY = BAR_Y + BAR_H / 2
const STEER_R = 32
const RPM_MAX = 12500

function InputTelemetryComponent({ throttle, brake, steer, speed, gear, rpm, drs }: Props) {
  const throttlePct = Math.max(0, Math.min(1, throttle)) * 100
  const brakePct = Math.max(0, Math.min(1, brake)) * 100
  const steerAngle = Math.max(-1, Math.min(1, steer)) * 135 // ±135°
  const rpmPct = Math.min(rpm / RPM_MAX, 1)
  const gearLabel = gear === -1 ? 'R' : gear === 0 ? 'N' : String(gear)

  // RPM bar segments
  const rpmSegments = 12
  const activeSegments = Math.floor(rpmPct * rpmSegments)

  return (
    <div className="overlay-input-telemetry">
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="input-telem-svg">
        {/* RPM bar across top */}
        <g className="rpm-bar-group">
          {Array.from({ length: rpmSegments }, (_, i) => {
            const x = 20 + i * ((W - 40) / rpmSegments)
            const segW = (W - 40) / rpmSegments - 2
            const isActive = i < activeSegments
            const isRedzone = i >= rpmSegments - 3
            return (
              <rect
                key={i}
                x={x}
                y={4}
                width={segW}
                height={10}
                rx={2}
                className={`rpm-segment ${isActive ? (isRedzone ? 'is-redzone' : 'is-active') : 'is-inactive'}`}
              />
            )
          })}
        </g>

        {/* Throttle bar (left) */}
        <g className="throttle-bar-group" transform={`translate(${W / 2 - 90}, ${BAR_Y})`}>
          <rect x={0} y={0} width={BAR_W} height={BAR_H} rx={4} className="input-bar-bg" />
          <rect
            x={0}
            y={BAR_H - (BAR_H * throttlePct) / 100}
            width={BAR_W}
            height={(BAR_H * throttlePct) / 100}
            rx={4}
            className="input-bar-fill is-throttle"
          />
          <text x={BAR_W / 2} y={BAR_H + 16} className="input-bar-label">THR</text>
          <text x={BAR_W / 2} y={-6} className="input-bar-value">{throttlePct.toFixed(0)}%</text>
        </g>

        {/* Brake bar (right) */}
        <g className="brake-bar-group" transform={`translate(${W / 2 + 50}, ${BAR_Y})`}>
          <rect x={0} y={0} width={BAR_W} height={BAR_H} rx={4} className="input-bar-bg" />
          <rect
            x={0}
            y={BAR_H - (BAR_H * brakePct) / 100}
            width={BAR_W}
            height={(BAR_H * brakePct) / 100}
            rx={4}
            className="input-bar-fill is-brake"
          />
          <text x={BAR_W / 2} y={BAR_H + 16} className="input-bar-label">BRK</text>
          <text x={BAR_W / 2} y={-6} className="input-bar-value">{brakePct.toFixed(0)}%</text>
        </g>

        {/* Steering wheel indicator (center) */}
        <g className="steer-group" transform={`translate(${STEER_CX}, ${STEER_CY})`}>
          <circle r={STEER_R + 4} className="steer-ring-bg" />
          <g transform={`rotate(${steerAngle})`}>
            <circle r={STEER_R} className="steer-ring" />
            <line x1={0} y1={-STEER_R + 4} x2={0} y2={-STEER_R - 6} className="steer-marker" />
          </g>
        </g>

        {/* Speed display (center-bottom) */}
        <text x={STEER_CX} y={STEER_CY + STEER_R + 20} className="speed-display">
          {speed.toFixed(0)}
        </text>
        <text x={STEER_CX} y={STEER_CY + STEER_R + 32} className="speed-unit">KM/H</text>

        {/* Gear (in steering center) */}
        <text x={STEER_CX} y={STEER_CY + 8} className="gear-display">
          {gearLabel}
        </text>

        {/* DRS indicator */}
        {drs && (
          <g className="drs-indicator">
            <rect x={W - 52} y={BAR_Y + 2} width={40} height={20} rx={4} className="drs-badge" />
            <text x={W - 32} y={BAR_Y + 16} className="drs-text">DRS</text>
          </g>
        )}
      </svg>
    </div>
  )
}

export const InputTelemetryOverlay = memo(InputTelemetryComponent)
