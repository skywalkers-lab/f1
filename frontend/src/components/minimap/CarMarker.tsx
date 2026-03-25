import { memo } from 'react'
import { SmoothedCar } from '../../hooks/useSmoothedMinimapCars'
import { getTeamColors } from '../../lib/teamColors'

type Props = {
  car: SmoothedCar
  isPlayer: boolean
  inBattle: boolean
  relation?: 'ahead' | 'behind' | null
  label?: string | null
  driverCode?: string | null
}

function speedClass(speed: number): string {
  if (speed >= 280) return 'is-very-fast'
  if (speed >= 220) return 'is-fast'
  if (speed >= 150) return 'is-medium'
  return 'is-slow'
}

function CarMarkerComponent({ car, isPlayer, inBattle, relation = null, label = null, driverCode = null }: Props) {
  const teamColors = isPlayer ? null : driverCode ? getTeamColors(driverCode) : null
  const klass = [
    'minimap-car',
    speedClass(car.speedKph),
    isPlayer ? 'is-player' : 'is-rival',
    inBattle ? 'is-battle' : '',
    relation === 'ahead' ? 'is-ahead' : '',
    relation === 'behind' ? 'is-behind' : '',
    car.isPitting ? 'is-pitting' : '',
    car.drsActive ? 'is-drs' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const bodyStyle = teamColors ? { fill: teamColors.body } : undefined
  const cockpitStyle = teamColors ? { fill: teamColors.cockpit } : undefined
  const haloStroke = teamColors ? teamColors.halo : undefined

  return (
    <g transform={`translate(${car.x.toFixed(2)} ${car.y.toFixed(2)}) rotate(${car.headingDeg.toFixed(1)})`} className={klass}>
      <circle cx="0" cy="0" r="10.2" className="car-halo" style={haloStroke ? { stroke: haloStroke } : undefined} />
      <line x1="-1.2" y1="0" x2="9.4" y2="0" className="car-heading" />
      <polygon points="7.4,0 2.1,3.7 -1.6,4.1 -6.8,2.1 -6.8,-2.1 -1.6,-4.1 2.1,-3.7" className="car-body" style={bodyStyle} />
      <rect x="0.9" y="-1.8" width="3.2" height="3.6" rx="0.9" className="car-cockpit" style={cockpitStyle} />
      <rect x={-2.8} y={-4.5} width={2.7} height={1.1} className="car-nose" />
      {car.isPitting ? <circle cx="0" cy="0" r="8.6" className="car-pit-ring" /> : null}
      {label ? (
        <text x="11.6" y="-8.5" className="car-label" transform={`rotate(${-car.headingDeg.toFixed(1)})`}>
          {label}
        </text>
      ) : null}
    </g>
  )
}

export const CarMarker = memo(CarMarkerComponent)
