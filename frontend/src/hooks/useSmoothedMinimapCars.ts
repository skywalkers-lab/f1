import { useEffect, useMemo, useRef } from 'react'
import { AppState } from '../lib/types'
import { Projector, sanitizeWorldPoint } from '../lib/minimapProjection'

export type SmoothedCar = {
  car_index: number
  x: number
  y: number
  headingDeg: number
  speedKph: number
  isPitting: boolean
  drsActive: boolean
  lapRatio: number | null
}

type InternalCarState = {
  x: number
  y: number
  headingDeg: number
  speedKph: number
}

const EMA_ALPHA = 0.36
const MAX_WORLD_JUMP = 250

function sanitizeHeading(car: AppState['minimap']['cars'][number], dx: number, dz: number, prevHeading: number): number {
  if (Number.isFinite(car.heading_deg)) {
    return Number(car.heading_deg)
  }
  if (Number.isFinite(car.vx) && Number.isFinite(car.vz) && (Math.abs(car.vx ?? 0) > 0.01 || Math.abs(car.vz ?? 0) > 0.01)) {
    return (Math.atan2(-(car.vz ?? 0), car.vx ?? 0) * 180) / Math.PI
  }
  if (Math.abs(dx) > 0.001 || Math.abs(dz) > 0.001) {
    return (Math.atan2(-dz, dx) * 180) / Math.PI
  }
  return prevHeading
}

function ema(prev: number, next: number, alpha: number): number {
  return prev + (next - prev) * alpha
}

export function useSmoothedMinimapCars(cars: AppState['minimap']['cars'], projector: Projector | null): SmoothedCar[] {
  const ref = useRef(new Map() as Map<number, InternalCarState>)
  const nextStateRef = useRef(new Map() as Map<number, InternalCarState>)

  const output = useMemo(() => {
    if (!projector) return []

    const nextState = new Map<number, InternalCarState>()
    const result: SmoothedCar[] = []

    cars.forEach((car) => {
      const world = sanitizeWorldPoint({ x: car.x, y: car.y })
      if (!world) return

      const prev = ref.current.get(car.car_index)
      const prevX = prev?.x ?? world.x
      const prevY = prev?.y ?? world.z
      const dx = world.x - prevX
      const dz = world.z - prevY
      const jump = Math.hypot(dx, dz)

      const trustedX = jump > MAX_WORLD_JUMP ? prevX : world.x
      const trustedY = jump > MAX_WORLD_JUMP ? prevY : world.z
      const smoothX = ema(prevX, trustedX, EMA_ALPHA)
      const smoothY = ema(prevY, trustedY, EMA_ALPHA)
      const headingDeg = sanitizeHeading(car, trustedX - prevX, trustedY - prevY, prev?.headingDeg ?? 0)
      const speedKph = Number.isFinite(car.speed_kph) ? Number(car.speed_kph) : prev?.speedKph ?? 0

      nextState.set(car.car_index, {
        x: smoothX,
        y: smoothY,
        headingDeg,
        speedKph,
      })

      const screen = projector.toScreen({ x: smoothX, z: smoothY })
      result.push({
        car_index: car.car_index,
        x: screen.x,
        y: screen.y,
        headingDeg,
        speedKph,
        isPitting: !!car.is_pitting,
        drsActive: !!car.drs_active,
        lapRatio: Number.isFinite(car.lap_distance_ratio) ? Math.max(0, Math.min(1, Number(car.lap_distance_ratio))) : null,
      })
    })

    nextStateRef.current = nextState
    return result
  }, [cars, projector])

  useEffect(() => {
    ref.current = nextStateRef.current
  })

  return output
}
