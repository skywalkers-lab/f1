/**
 * Centralised environment configuration.
 *
 * All environment-dependent values are read once at module load and exposed as
 * typed, validated constants.  Components should import from here rather than
 * reading `import.meta.env` directly.
 */

type Environment = 'development' | 'production' | 'test'

function detectEnv(): Environment {
  const raw = (import.meta.env.MODE ?? '').toLowerCase()
  if (raw === 'test') return 'test'
  if (import.meta.env.PROD) return 'production'
  return 'development'
}

export const ENV: Environment = detectEnv()
export const IS_DEV = ENV === 'development'
export const IS_PROD = ENV === 'production'

/** WebSocket relay URL override (set in .env or Vite config). */
export const WS_RELAY_URL: string = (import.meta.env.VITE_WS_RELAY_URL as string | undefined) ?? ''

/** REST relay base URL override. */
export const RELAY_API_BASE: string = (import.meta.env.VITE_RELAY_API_BASE as string | undefined) ?? ''

/** Explicit session id (useful for multi-session deployments). */
export const SESSION_ID: string =
  new URLSearchParams(window.location.search).get('sessionId') ??
  new URLSearchParams(window.location.search).get('session') ??
  (import.meta.env.VITE_SESSION_ID as string | undefined) ??
  'public'

/** Default demo mode from env (can also come from URL). */
export const DEFAULT_DEMO_MODE: string = (import.meta.env.VITE_DEFAULT_DEMO_MODE as string | undefined) ?? ''

/** Max WebSocket reconnection delay (ms). */
export const WS_MAX_RETRY_MS = 5000

/** Stale-poll interval when WS is silent (ms). */
export const STALE_POLL_INTERVAL_MS = 1200

/** Silence threshold before stale-poll kicks in (ms). */
export const STALE_SILENCE_MS = 1800

/** State update cadence tiers (ms). */
export const CADENCE_FAST_MS = 100
export const CADENCE_MEDIUM_MS = 400
