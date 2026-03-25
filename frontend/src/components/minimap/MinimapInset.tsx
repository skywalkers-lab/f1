import { memo, useMemo } from 'react'
import { SmoothedCar } from '../../hooks/useSmoothedMinimapCars'
import { buildPath, buildRibbonPath, ScreenPoint, slicePathAroundRatio } from '../../lib/minimapProjection'
import type { TrackLookup } from '../../lib/trackDefinition'
import { buildSlicePathD, buildTrackPathD, buildTrackRibbonD } from '../../lib/trackProjection'
import { CarMarker } from './CarMarker'

type Props = {
  trace: ScreenPoint[]
  cars: SmoothedCar[]
  playerCar: SmoothedCar | null
  playerIdx: number
  aheadCarIndex: number | null
  behindCarIndex: number | null
  battleCars: Set<number>
  driverCodes: Record<number, string>
  trackLookup?: TrackLookup | null
}

const INSET_X = 348
const INSET_Y = 16
const INSET_W = 156
const INSET_H = 122
const INSET_ZOOM = 2.7

function InsetComponent({ trace, cars, playerCar, playerIdx, aheadCarIndex, behindCarIndex, battleCars, driverCodes, trackLookup }: Props) {
  const trackBodyPath = useMemo(() => {
    if (trackLookup) return buildTrackRibbonD(trackLookup, 7.2)
    return buildRibbonPath(trace, 7.2)
  }, [trace, trackLookup])
  const baselinePath = useMemo(() => {
    if (trackLookup) return buildTrackPathD(trackLookup)
    return buildPath(trace.filter((_, i) => i % 3 === 0))
  }, [trace, trackLookup])
  const focusPath = useMemo(() => {
    if (!playerCar || playerCar.lapRatio === null) return ''
    if (trackLookup) return buildSlicePathD(trackLookup, Math.max(0, playerCar.lapRatio - 0.08), Math.min(1, playerCar.lapRatio + 0.15))
    return buildPath(slicePathAroundRatio(trace, playerCar.lapRatio, 0.08, 0.15))
  }, [trace, playerCar, trackLookup])

  const localCars = useMemo(() => {
    if (!playerCar) return []
    return cars.filter((car) => {
      if (car.car_index === playerIdx || car.car_index === aheadCarIndex || car.car_index === behindCarIndex) return true
      if (battleCars.has(car.car_index)) return true
      return Math.hypot(car.x - playerCar.x, car.y - playerCar.y) <= 42
    })
  }, [cars, playerCar, playerIdx, aheadCarIndex, behindCarIndex, battleCars])

  if (!playerCar || trace.length < 2) return null

  const translateX = INSET_W / 2 - playerCar.x * INSET_ZOOM
  const translateY = INSET_H / 2 - playerCar.y * INSET_ZOOM

  return (
    <g className="minimap-inset-shell" transform={`translate(${INSET_X} ${INSET_Y})`}>
      <defs>
        <clipPath id="minimapInsetClip">
          <rect x="0" y="0" width={INSET_W} height={INSET_H} rx="10" ry="10" />
        </clipPath>
      </defs>

      <rect x="0" y="0" width={INSET_W} height={INSET_H} rx="10" ry="10" className="minimap-inset-bg" />
      <text x="12" y="18" className="minimap-inset-title">
        LOCAL WINDOW
      </text>

      <g clipPath="url(#minimapInsetClip)">
        <g transform={`translate(${translateX.toFixed(2)} ${translateY.toFixed(2)}) scale(${INSET_ZOOM})`}>
          {trackBodyPath ? <path d={trackBodyPath} className="minimap-inset-track" /> : null}
          {baselinePath ? <path d={baselinePath} className="minimap-inset-baseline" /> : null}
          {focusPath ? <path d={focusPath} className="minimap-inset-focus" /> : null}

          {localCars.map((car) => {
            const relation = car.car_index === aheadCarIndex ? 'ahead' : car.car_index === behindCarIndex ? 'behind' : null
            const code = driverCodes[car.car_index] ?? `#${car.car_index}`
            const label = car.car_index === playerIdx ? 'YOU' : relation === 'ahead' ? `A ${code}` : relation === 'behind' ? `B ${code}` : battleCars.has(car.car_index) ? code : null

            return (
              <CarMarker
                key={`inset-${car.car_index}`}
                car={car}
                isPlayer={car.car_index === playerIdx}
                inBattle={battleCars.has(car.car_index)}
                relation={relation}
                label={label}
                driverCode={driverCodes[car.car_index] ?? null}
              />
            )
          })}
        </g>
      </g>
    </g>
  )
}

export const MinimapInset = memo(InsetComponent)