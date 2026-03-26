import { memo, useMemo } from 'react'
import { SmoothedCar } from '../../hooks/useSmoothedMinimapCars'
import type { TrackLookup } from '../../lib/trackDefinition'

/**
 * Track Radar mode (inspired by pits-n-giggles track_radar overlay)
 * - Player-centric view
 * - Relative positioning
 * - Proximity-based opacity
 * - Real-time updates
 */

type Props = {
  cars: SmoothedCar[]
  playerCar: SmoothedCar | null
  playerIdx: number
  battleCars: Set<number>
  driverCodes: Record<number, string>
  trackLookup?: TrackLookup | null
}

const RADAR_WIDTH = 300
const RADAR_HEIGHT = 300
const RADAR_RANGE = 80 // meters - relative range visualization
const BASE_OPACITY = 1.0
const IDLE_OPACITY = 0.3 // When no cars nearby

interface RadarCar {
  carIndex: number
  relX: number // relative lateral offset
  relZ: number // relative forward offset
  heading: number
  speed: number
  isPlayer: boolean
  isBattle: boolean
  isPitting: boolean
}

function calculateRelativePosition(playerCar: SmoothedCar, otherCar: SmoothedCar): { relX: number; relZ: number } {
  // Calculate relative position from player's perspective
  const dx = otherCar.x - playerCar.x
  const dz = otherCar.y - playerCar.y // Note: y in screen space maps to z in world space

  // Rotate by player heading to get relative coordinates
  const playerHeadingRad = (playerCar.headingDeg * Math.PI) / 180
  const cos = Math.cos(playerHeadingRad)
  const sin = Math.sin(playerHeadingRad)

  // Player's perspective: +z = forward, +x = right
  // Screen X maps to world X (lateral)
  // Screen Y maps to world Z (forward track direction)
  return {
    relX: dx * cos - dz * sin,
    relZ: dx * sin + dz * cos,
  }
}

function RadarModeComponent({ cars, playerCar, playerIdx, battleCars, driverCodes, trackLookup }: Props) {
  const radarCars = useMemo(() => {
    if (!playerCar) return []

    return cars
      .filter((car) => car.car_index !== playerIdx)
      .map((car): RadarCar => {
        const { relX, relZ } = calculateRelativePosition(playerCar, car)
        return {
          carIndex: car.car_index,
          relX,
          relZ,
          heading: car.headingDeg,
          speed: car.speedKph,
          isPlayer: false,
          isBattle: battleCars.has(car.car_index),
          isPitting: car.isPitting,
        }
      })
      .filter((car) => {
        // Only show cars within radar range
        const distance = Math.hypot(car.relX, car.relZ)
        return distance <= RADAR_RANGE * 1.2 || car.isBattle // Always show battle cars
      })
  }, [cars, playerCar, playerIdx, battleCars])

  const carsNearby = useMemo(() => radarCars.some((car) => Math.hypot(car.relX, car.relZ) <= RADAR_RANGE * 0.8), [radarCars])
  const opacity = useMemo(() => (carsNearby ? BASE_OPACITY : IDLE_OPACITY), [carsNearby])

  if (!playerCar) {
    return (
      <div className="radar-mode-container" style={{ opacity: 0.5 }}>
        <div className="radar-status-text">대기 중...</div>
      </div>
    )
  }

  const centerX = RADAR_WIDTH / 2
  const centerY = RADAR_HEIGHT / 2
  const scale = RADAR_WIDTH / (RADAR_RANGE * 2)

  // Convert radar coordinates to screen coordinates
  const toScreen = (relX: number, relZ: number) => ({
    x: centerX + relX * scale,
    y: centerY - relZ * scale,
  })

  const showHeaderAndStats = radarCars.length > 0

  return (
    <div className="radar-mode-container" style={{ opacity }}>
      {showHeaderAndStats && (
        <div className="radar-header">
          <div className="radar-title">TRACK RADAR</div>
          <div className="radar-range-text">{RADAR_RANGE}m</div>
        </div>
      )}

      <svg
        className="radar-svg"
        width={RADAR_WIDTH}
        height={RADAR_HEIGHT}
        viewBox={`0 0 ${RADAR_WIDTH} ${RADAR_HEIGHT}`}
        role="img"
        aria-label="플레이어 중심 트랙 레이더"
      >
        <defs>
          {/* Grid pattern */}
          <pattern id="radarGrid" x="30" y="30" width="30" height="30" patternUnits="userSpaceOnUse">
            <circle cx="15" cy="15" r="1" fill="rgba(123, 213, 252, 0.1)" />
          </pattern>

          {/* Radial gradient for radar effect */}
          <radialGradient id="radarBg">
            <stop offset="0%" stopColor="#1a1a2e" />
            <stop offset="100%" stopColor="#0a0a14" />
          </radialGradient>
        </defs>

        {/* Background */}
        <circle
          cx={centerX}
          cy={centerY}
          r={RADAR_HEIGHT / 2}
          fill="url(#radarBg)"
          stroke="rgba(123, 213, 252, 0.3)"
          strokeWidth="1"
        />

        {/* Grid */}
        <rect x="0" y="0" width={RADAR_WIDTH} height={RADAR_HEIGHT} fill="url(#radarGrid)" />

        {/* Range rings */}
        {[0.25, 0.5, 0.75, 1].map((ratio) => (
          <circle
            key={`ring-${ratio}`}
            cx={centerX}
            cy={centerY}
            r={(RADAR_HEIGHT / 2) * ratio}
            fill="none"
            stroke="rgba(123, 213, 252, 0.15)"
            strokeWidth="0.5"
            strokeDasharray="2,2"
          />
        ))}

        {/* Cardinal directions (N forward) */}
        <g className="radar-directions">
          <line x1={centerX} y1="5" x2={centerX} y2="15" stroke="rgba(0, 255, 0, 0.4)" strokeWidth="2" />
          <text x={centerX} y="25" textAnchor="middle" className="radar-direction-label">
            ↑
          </text>
        </g>

        {/* Other cars */}
        {radarCars.map((radarCar) => {
          const { x, y } = toScreen(radarCar.relX, radarCar.relZ)
          const distance = Math.hypot(radarCar.relX, radarCar.relZ)
          const isVisible = distance <= RADAR_RANGE * 1.2
          const distanceStr = distance.toFixed(1)

          if (!isVisible) return null

          const teamColor = driverCodes[radarCar.carIndex]
            ? getTeamColorForCode(driverCodes[radarCar.carIndex])
            : '#ffffff'

          return (
            <g key={`radar-car-${radarCar.carIndex}`} className="radar-car" transform={`translate(${x} ${y})`}>
              {/* Car marker */}
              <circle
                cx="0"
                cy="0"
                r="6"
                fill={radarCar.isBattle ? '#ff6b6b' : teamColor}
                opacity={radarCar.isPitting ? 0.5 : 1}
                className={`radar-car-marker ${radarCar.isBattle ? 'is-battle' : ''}`}
              />

              {/* Heading indicator */}
              <line
                x1="0"
                y1="0"
                x2={Math.sin((radarCar.heading * Math.PI) / 180) * 5}
                y2={-Math.cos((radarCar.heading * Math.PI) / 180) * 5}
                stroke={teamColor}
                strokeWidth="1.5"
                opacity="0.7"
              />

              {/* Battle warning ring */}
              {radarCar.isBattle && (
                <circle
                  cx="0"
                  cy="0"
                  r="8"
                  fill="none"
                  stroke="#ff6b6b"
                  strokeWidth="1"
                  strokeDasharray="2,1"
                  opacity="0.6"
                />
              )}

              {/* Label */}
              <text x="10" y="-3" className="radar-car-label" fill={teamColor} opacity="0.9">
                #{radarCar.carIndex}
              </text>

              {/* Distance indicator */}
              <text x="10" y="8" className="radar-distance-label" fill="rgba(200, 200, 200, 0.7)">
                {distanceStr}m
              </text>
            </g>
          )
        })}

        {/* Empty radar hint */}
        {radarCars.length === 0 && (
          <text x={centerX} y={centerY + 4} textAnchor="middle" className="radar-distance-label" fill="rgba(200, 200, 200, 0.75)">
            근처 차량 없음
          </text>
        )}

        {/* Player (center) */}
        <g className="radar-player" transform={`translate(${centerX} ${centerY})`}>
          <circle cx="0" cy="0" r="8" fill="#00ff00" opacity="0.8" />
          <circle cx="0" cy="0" r="10" fill="none" stroke="#00ff00" strokeWidth="1" opacity="0.4" />
          <line
            x1="0"
            y1="0"
            x2="0"
            y2="-8"
            stroke="#00ff00"
            strokeWidth="2"
            opacity="0.8"
          />
          <text x="0" y="18" textAnchor="middle" className="radar-player-label">
            YOU
          </text>
          <text x="0" y="30" textAnchor="middle" className="radar-speed-label">
            {playerCar.speedKph.toFixed(0)} km/h
          </text>
        </g>
      </svg>

      {/* Stats */}
      {showHeaderAndStats && (
        <div className="radar-stats">
          <div className="radar-stat-item">
            <span className="stat-label">Nearby:</span>
            <span className="stat-value">{radarCars.length}</span>
          </div>
          <div className="radar-stat-item">
            <span className="stat-label">Battles:</span>
            <span className="stat-value">{radarCars.filter((c) => c.isBattle).length}</span>
          </div>
        </div>
      )}
    </div>
  )
}

// Simple team color mapping
function getTeamColorForCode(code: string): string {
  const colors: Record<string, string> = {
    // Red Bull
    VER: '#3671C6',
    PER: '#3671C6',
    RB: '#3671C6',

    // Mercedes
    HAM: '#27F4D2',
    RUS: '#27F4D2',

    // Ferrari
    LEC: '#E8002D',
    SAI: '#E8002D',

    // McLaren
    NOR: '#FF8000',
    PIA: '#FF8000',

    // Other teams with defaults
    ALO: '#229971', // Aston Martin
    STR: '#229971',
    LAN: '#64C4FF', // Williams
    ALB: '#64C4FF',
    TSU: '#1E2850', // RB
    RIC: '#1E2850',
    OCO: '#FF87BC', // Alpine
    GAS: '#FF87BC',
    BOT: '#52E252', // Kick/Sauber
    ZHO: '#52E252',
    MAG: '#B6BABD', // Haas
    HUL: '#B6BABD',
  }

  return colors[code] || '#808080'
}

export const RadarMode = memo(RadarModeComponent)
