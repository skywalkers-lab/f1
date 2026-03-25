import { clamp } from './utils.js'

const COMPOUNDS = ['SOFT', 'MEDIUM', 'HARD']
const ERS_MODES = ['PUSH', 'BALANCED', 'HARVEST']
const FUEL_MODES = ['NORMAL', 'SAVE']
const PIT_DELAYS = [0, 1, 2]

function actionId(parts) {
  return [
    parts.type,
    parts.pitDelayLaps,
    parts.compound,
    parts.ersMode,
    parts.fuelMode,
  ].join(':')
}

export function buildActionSpace() {
  const actions = []

  for (const pitDelayLaps of PIT_DELAYS) {
    for (const compound of COMPOUNDS) {
      for (const ersMode of ERS_MODES) {
        for (const fuelMode of FUEL_MODES) {
          const parts = {
            type: 'PIT',
            pitDelayLaps,
            compound,
            ersMode,
            fuelMode,
          }
          actions.push({ id: actionId(parts), ...parts })
        }
      }
    }
  }

  for (const ersMode of ERS_MODES) {
    for (const fuelMode of FUEL_MODES) {
      const parts = {
        type: 'STAY',
        pitDelayLaps: -1,
        compound: 'KEEP',
        ersMode,
        fuelMode,
      }
      actions.push({ id: actionId(parts), ...parts })
    }
  }

  return actions
}

export function parseActionId(id) {
  const [type, pitDelayRaw, compound, ersMode, fuelMode] = String(id || '').split(':')
  if (!type || !ersMode || !fuelMode) return null

  return {
    id,
    type,
    pitDelayLaps: clamp(Number(pitDelayRaw), -1, 4),
    compound: compound || 'KEEP',
    ersMode,
    fuelMode,
  }
}
