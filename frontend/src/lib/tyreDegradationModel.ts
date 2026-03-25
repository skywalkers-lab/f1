import type { TyreWearPoint } from './tyreHistoryManager'

export type CanonicalCompound = 'SOFT' | 'MEDIUM' | 'HARD' | 'INTER' | 'WET'

export type CompoundPhysics = {
  baseWearRate: number
  stablePenaltyCoeff: number
  compoundBias: number
  cliffThreshold: number
  cliffExponent: number
  warmupLaps: number
  warmupPenaltyMs: number
}

const PHYSICS: Record<CanonicalCompound, CompoundPhysics> = {
  SOFT: {
    baseWearRate: 0.028,
    stablePenaltyCoeff: 1400,
    compoundBias: 1.0,
    cliffThreshold: 0.74,
    cliffExponent: 1.85,
    warmupLaps: 1,
    warmupPenaltyMs: 280,
  },
  MEDIUM: {
    baseWearRate: 0.021,
    stablePenaltyCoeff: 1250,
    compoundBias: 0.96,
    cliffThreshold: 0.79,
    cliffExponent: 1.8,
    warmupLaps: 1,
    warmupPenaltyMs: 320,
  },
  HARD: {
    baseWearRate: 0.016,
    stablePenaltyCoeff: 1120,
    compoundBias: 0.93,
    cliffThreshold: 0.84,
    cliffExponent: 1.75,
    warmupLaps: 2,
    warmupPenaltyMs: 430,
  },
  INTER: {
    baseWearRate: 0.019,
    stablePenaltyCoeff: 1180,
    compoundBias: 0.97,
    cliffThreshold: 0.81,
    cliffExponent: 1.78,
    warmupLaps: 1,
    warmupPenaltyMs: 300,
  },
  WET: {
    baseWearRate: 0.017,
    stablePenaltyCoeff: 1100,
    compoundBias: 0.95,
    cliffThreshold: 0.83,
    cliffExponent: 1.72,
    warmupLaps: 1,
    warmupPenaltyMs: 280,
  },
}

export function resolveCompound(raw: string | undefined): CanonicalCompound {
  const value = (raw ?? '').toUpperCase()
  if (value.includes('SOFT') || value === 'C5' || value === 'C4') return 'SOFT'
  if (value.includes('MEDIUM') || value === 'C3') return 'MEDIUM'
  if (value.includes('HARD') || value === 'C2' || value === 'C1') return 'HARD'
  if (value.includes('INTER')) return 'INTER'
  if (value.includes('WET')) return 'WET'
  return 'MEDIUM'
}

export function getCompoundPhysics(compound: CanonicalCompound): CompoundPhysics {
  return PHYSICS[compound]
}

export function estimateWearSlopeFromHistory(points: TyreWearPoint[] | undefined, fallbackCompound: CanonicalCompound): number {
  if (!points || points.length < 2) return PHYSICS[fallbackCompound].baseWearRate

  const recent = points.slice(-6)
  let weightedDelta = 0
  let weightedLaps = 0

  for (let i = 1; i < recent.length; i++) {
    const prev = recent[i - 1]
    const curr = recent[i]
    const dLap = Math.max(0.01, curr.lap - prev.lap)
    const dWear = Math.max(0, curr.wear - prev.wear)
    const weight = i
    weightedDelta += dWear * weight
    weightedLaps += dLap * weight
  }

  const slope = weightedLaps > 0 ? weightedDelta / weightedLaps : PHYSICS[fallbackCompound].baseWearRate
  return Math.max(0.005, Math.min(0.08, slope))
}
