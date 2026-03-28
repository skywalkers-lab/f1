import { decode } from '@msgpack/msgpack'
import { AppState } from './types'

export type RelayMessage =
  | AppState
  | { type: string; payload?: AppState; eventId?: number; meta?: { eventId?: number } }

export function decodeRelayMessage(raw: unknown): RelayMessage | null {
  try {
    if (typeof raw === 'string') {
      return JSON.parse(raw) as RelayMessage
    }

    if (raw instanceof ArrayBuffer) {
      return decode(new Uint8Array(raw)) as RelayMessage
    }

    if (raw instanceof Blob) {
      return null
    }
  } catch {
    return null
  }

  return null
}
