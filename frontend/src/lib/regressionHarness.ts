// #50 — End-to-end regression harness for UDP→UI deterministic snapshots
//
// This module provides a test harness that can:
// 1. Replay recorded UDP packets through the bridge parser
// 2. Capture AppState snapshots at defined checkpoints
// 3. Compare snapshots against golden baselines for regression detection

import type { AppState } from '../lib/types'

export type RegressionSnapshot = {
  checkpointId: string
  lap: number
  frameId: number
  timestamp: number
  leaderboardHash: string
  playerState: {
    position: number
    lap: number
    speed: number
    gear: number
    tyreCompound: string
  }
  leaderboardLength: number
  topThreeDrivers: string[]
}

export type RegressionResult = {
  checkpointId: string
  passed: boolean
  diffs: string[]
}

/**
 * Take a deterministic snapshot of current AppState for regression comparison.
 */
export function captureSnapshot(checkpointId: string, state: AppState): RegressionSnapshot {
  const sorted = [...state.leaderboard].sort((a, b) => a.position - b.position)

  // Deterministic hash of leaderboard state
  const hashInput = sorted
    .map(r => `${r.car_index}:${r.position}:${r.driver_code}`)
    .join('|')
  const hash = simpleHash(hashInput)

  return {
    checkpointId,
    lap: state.player.lap,
    frameId: (state as Record<string, unknown>).frame_id as number ?? 0,
    timestamp: Date.now(),
    leaderboardHash: hash,
    playerState: {
      position: state.player.position,
      lap: state.player.lap,
      speed: Math.round(state.player.speed),
      gear: state.player.gear,
      tyreCompound: state.player.tyre_compound,
    },
    leaderboardLength: state.leaderboard.length,
    topThreeDrivers: sorted.slice(0, 3).map(r => r.driver_code),
  }
}

/**
 * Compare a captured snapshot against a golden baseline.
 */
export function compareSnapshots(
  captured: RegressionSnapshot,
  golden: RegressionSnapshot,
): RegressionResult {
  const diffs: string[] = []

  if (captured.leaderboardHash !== golden.leaderboardHash) {
    diffs.push(`leaderboard hash mismatch: ${captured.leaderboardHash} vs ${golden.leaderboardHash}`)
  }
  if (captured.leaderboardLength !== golden.leaderboardLength) {
    diffs.push(`leaderboard length: ${captured.leaderboardLength} vs ${golden.leaderboardLength}`)
  }
  if (captured.playerState.position !== golden.playerState.position) {
    diffs.push(`player position: ${captured.playerState.position} vs ${golden.playerState.position}`)
  }
  if (captured.playerState.lap !== golden.playerState.lap) {
    diffs.push(`player lap: ${captured.playerState.lap} vs ${golden.playerState.lap}`)
  }

  const topCaptured = captured.topThreeDrivers.join(',')
  const topGolden = golden.topThreeDrivers.join(',')
  if (topCaptured !== topGolden) {
    diffs.push(`top 3 order: [${topCaptured}] vs [${topGolden}]`)
  }

  return {
    checkpointId: captured.checkpointId,
    passed: diffs.length === 0,
    diffs,
  }
}

/**
 * Run a full regression suite given an array of checkpoint snapshots and baselines.
 */
export function runRegressionSuite(
  captured: RegressionSnapshot[],
  golden: RegressionSnapshot[],
): { passed: number; failed: number; results: RegressionResult[] } {
  const goldenMap = new Map(golden.map(g => [g.checkpointId, g]))
  const results: RegressionResult[] = []

  for (const snap of captured) {
    const baseline = goldenMap.get(snap.checkpointId)
    if (!baseline) {
      results.push({ checkpointId: snap.checkpointId, passed: false, diffs: ['no golden baseline found'] })
      continue
    }
    results.push(compareSnapshots(snap, baseline))
  }

  return {
    passed: results.filter(r => r.passed).length,
    failed: results.filter(r => !r.passed).length,
    results,
  }
}

/**
 * Simple non-cryptographic hash for deterministic snapshot comparison.
 */
function simpleHash(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32-bit integer
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/**
 * Export snapshots as JSON for golden baseline storage.
 */
export function serializeBaseline(snapshots: RegressionSnapshot[]): string {
  return JSON.stringify(snapshots, null, 2)
}

/**
 * Import golden baseline from JSON.
 */
export function deserializeBaseline(json: string): RegressionSnapshot[] {
  return JSON.parse(json) as RegressionSnapshot[]
}
