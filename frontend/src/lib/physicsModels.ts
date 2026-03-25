// #30 — Tyre thermal model split by front/rear axle bias
// #31 — Fuel model auto-calibration per track and weather

// ═══════════════════════════════════════════════════════════════
// #30: Tyre thermal model — front/rear axle bias
// ═══════════════════════════════════════════════════════════════

export type AxleThermalState = {
  frontTemp: number  // °C estimate
  rearTemp: number   // °C estimate
  frontWear: number  // 0-1
  rearWear: number   // 0-1
  balance: 'FRONT_LIMITED' | 'REAR_LIMITED' | 'BALANCED'
  degradationRateFront: number  // %/lap
  degradationRateRear: number   // %/lap
  estimatedLapsToGrain: number
  estimatedLapsToBlister: number
}

type ThermalHistory = {
  lap: number
  frontWear: number
  rearWear: number
  brakeTemp: number
}

const _thermalHistory: ThermalHistory[] = []

const OPTIMAL_TEMP = { front: 100, rear: 105 } // nominal °C
const GRAIN_THRESHOLD = 80   // °C below which graining occurs
const BLISTER_THRESHOLD = 130 // °C above which blistering occurs

export function updateAxleThermalModel(
  lap: number,
  tyreTempFL: number, tyreTempFR: number,
  tyreTempRL: number, tyreTempRR: number,
  wearFL: number, wearFR: number,
  wearRL: number, wearRR: number,
  brakeTemp: number,
): AxleThermalState {
  const frontTemp = (tyreTempFL + tyreTempFR) / 2
  const rearTemp = (tyreTempRL + tyreTempRR) / 2
  const frontWear = (wearFL + wearFR) / 200 // convert to 0-1
  const rearWear = (wearRL + wearRR) / 200

  _thermalHistory.push({ lap, frontWear, rearWear, brakeTemp })
  if (_thermalHistory.length > 60) _thermalHistory.shift()

  // Compute degradation rates
  let degFront = 0
  let degRear = 0
  if (_thermalHistory.length >= 3) {
    const recent = _thermalHistory.slice(-5)
    const firstF = recent[0]
    const lastF = recent[recent.length - 1]
    const lapSpan = lastF.lap - firstF.lap
    if (lapSpan > 0) {
      degFront = ((lastF.frontWear - firstF.frontWear) / lapSpan) * 100
      degRear = ((lastF.rearWear - firstF.rearWear) / lapSpan) * 100
    }
  }

  // Balance determination
  let balance: AxleThermalState['balance'] = 'BALANCED'
  if (Math.abs(degFront - degRear) > 0.3) {
    balance = degFront > degRear ? 'FRONT_LIMITED' : 'REAR_LIMITED'
  }

  // Estimate laps to undertemp (graining) / overtemp (blistering)
  const tempDriftPerLap = _thermalHistory.length >= 3
    ? (frontTemp - OPTIMAL_TEMP.front) / Math.max(1, lap)
    : 0

  const lapsToGrain = frontTemp > GRAIN_THRESHOLD && tempDriftPerLap < 0
    ? Math.ceil((frontTemp - GRAIN_THRESHOLD) / Math.abs(tempDriftPerLap))
    : 99

  const lapsToBlister = rearTemp < BLISTER_THRESHOLD && tempDriftPerLap > 0
    ? Math.ceil((BLISTER_THRESHOLD - rearTemp) / Math.abs(tempDriftPerLap))
    : 99

  return {
    frontTemp: Math.round(frontTemp * 10) / 10,
    rearTemp: Math.round(rearTemp * 10) / 10,
    frontWear: Math.round(frontWear * 1000) / 1000,
    rearWear: Math.round(rearWear * 1000) / 1000,
    balance,
    degradationRateFront: Math.round(degFront * 100) / 100,
    degradationRateRear: Math.round(degRear * 100) / 100,
    estimatedLapsToGrain: Math.min(99, Math.max(0, lapsToGrain)),
    estimatedLapsToBlister: Math.min(99, Math.max(0, lapsToBlister)),
  }
}

export function getThermalHistory(): ThermalHistory[] {
  return [..._thermalHistory]
}

// ═══════════════════════════════════════════════════════════════
// #31: Fuel model auto-calibration per track and weather
// ═══════════════════════════════════════════════════════════════

export type FuelCalibration = {
  trackId: number
  weather: 'dry' | 'wet' | 'mixed'
  calibratedConsumptionKgPerLap: number
  confidence: number // 0-1
  samplesUsed: number
  predictedFuelAtEnd: number
  surplusDeficitKg: number
  recommendation: 'LIFT_AND_COAST' | 'NOMINAL' | 'PUSH_AVAILABLE'
}

type FuelSample = {
  lap: number
  fuelKg: number
  weather: 'dry' | 'wet' | 'mixed'
}

const _fuelSamples: Map<string, FuelSample[]> = new Map()

function fuelKey(trackId: number, weather: string): string {
  return `${trackId}_${weather}`
}

export function recordFuelSample(
  trackId: number,
  lap: number,
  fuelKg: number,
  weather: 'dry' | 'wet' | 'mixed',
): void {
  const key = fuelKey(trackId, weather)
  const samples = _fuelSamples.get(key) ?? []
  samples.push({ lap, fuelKg, weather })
  if (samples.length > 80) samples.shift()
  _fuelSamples.set(key, samples)
}

export function calibrateFuelModel(
  trackId: number,
  currentLap: number,
  currentFuelKg: number,
  totalLaps: number,
  weather: 'dry' | 'wet' | 'mixed',
  targetFuelKg = 0.5, // minimum fuel at end
): FuelCalibration {
  const key = fuelKey(trackId, weather)
  const samples = _fuelSamples.get(key) ?? []

  // Default consumption estimate (no data)
  let consumptionPerLap = 1.75 // kg/lap baseline
  let confidence = 0.2
  let samplesUsed = 0

  if (samples.length >= 3) {
    // Compute consumption from consecutive samples
    const consumptions: number[] = []
    for (let i = 1; i < samples.length; i++) {
      const lapDiff = samples[i].lap - samples[i - 1].lap
      if (lapDiff > 0) {
        const fuelDiff = samples[i - 1].fuelKg - samples[i].fuelKg
        consumptions.push(fuelDiff / lapDiff)
      }
    }

    if (consumptions.length > 0) {
      // Weighted average (recent samples weighted more)
      let weightSum = 0
      let valSum = 0
      for (let i = 0; i < consumptions.length; i++) {
        const w = 1 + i * 0.5
        weightSum += w
        valSum += consumptions[i] * w
      }
      consumptionPerLap = valSum / weightSum
      samplesUsed = consumptions.length

      // Weather adjustment
      if (weather === 'wet') consumptionPerLap *= 1.12
      if (weather === 'mixed') consumptionPerLap *= 1.06

      confidence = Math.min(0.95, 0.4 + samplesUsed * 0.05)
    }
  }

  const lapsRemaining = Math.max(0, totalLaps - currentLap)
  const predictedAtEnd = currentFuelKg - (consumptionPerLap * lapsRemaining)
  const delta = predictedAtEnd - targetFuelKg

  let recommendation: FuelCalibration['recommendation'] = 'NOMINAL'
  if (delta < -2.0) recommendation = 'LIFT_AND_COAST'
  else if (delta > 3.0) recommendation = 'PUSH_AVAILABLE'

  return {
    trackId,
    weather,
    calibratedConsumptionKgPerLap: Math.round(consumptionPerLap * 1000) / 1000,
    confidence: Math.round(confidence * 100) / 100,
    samplesUsed,
    predictedFuelAtEnd: Math.round(predictedAtEnd * 100) / 100,
    surplusDeficitKg: Math.round(delta * 100) / 100,
    recommendation,
  }
}
