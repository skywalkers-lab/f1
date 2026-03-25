# Web Realtime Pitwall Platform Architecture

## Goals

- Deliver a browser-first pitwall experience via a single URL.
- Decouple local UDP ingestion from web delivery.
- Support multi-user spectator sessions with deterministic realtime behavior.
- Preserve graceful behavior during stream interruptions.

## High-Level Topology

1. UDP Ingestion Edge (local PC or cloud VM)
2. Realtime Relay Service (WebSocket + SSE + REST)
3. Static Frontend CDN (Vercel/Netlify/Cloudflare Pages)

Data flow:

1. F1 25 emits UDP packets to ingestion edge.
2. Ingestion edge decodes packets and builds AppState snapshots.
3. Bridge publishes snapshots to relay using WSS.
4. Relay applies ordering/dedup stabilization and throttled fan-out.
5. Browser subscribes to relay stream by sessionId.

## Session and Multi-User Model

- Every stream is partitioned by sessionId.
- One or more bridges can publish to a session.
- Many viewers can subscribe to the same session for spectator mode.
- URL contract: ?sessionId=<race-id>

Suggested session naming:

- public
- race-2026-aus-q
- team-red-sim-1

## Stabilization Rules

Applied in relay on every bridge frame:

- Out-of-order guard: reject frame when seq <= lastSeq (per source).
- Duplicate guard: reject frame when frameId == lastFrameId.
- Reverse frame guard: reject frame when frameId < lastFrameId.
- Broadcast throttle: merge and fan-out at STREAM_HZ (default 15Hz).

## Client Stream Consumption Model

- Primary transport: WebSocket `/ws?role=viewer&sessionId=...`
- Fallback transport: SSE `/events?sessionId=...`
- Snapshot fallback: GET `/state?sessionId=...` polling when stream is stale
- React-side rendering guard:
  - requestAnimationFrame batching
  - component memoization
  - cadence-based state partitions for expensive views

## Strategy Engine Placement

Recommended split:

- Server-side:
  - expensive strategy scoring and model updates
  - feedback ingestion and long-horizon calculations
- Client-side:
  - lightweight derived metrics and visual overlays
  - interaction-local transforms (zoom/pan/focus)

This keeps deterministic strategy outputs shared among all viewers while preserving responsive UI.

## Deployment Blueprint

Frontend:

- Platform: Vercel / Netlify / Cloudflare Pages
- Build: npm run build
- Output: dist
- TLS: HTTPS (required for secure browser contexts)

Relay/Realtime Service:

- Platform: Railway / Render / Fly.io / ECS
- Runtime: Node.js
- Expose:
  - GET /health
  - GET /state
  - GET /events
  - WS /ws
- TLS: WSS mandatory in production

Bridge:

- Runs near game host (same LAN/PC preferred)
- Connects outbound to relay WSS
- No inbound public exposure required

## Configuration Model

Build-time (frontend public):

- VITE_WS_RELAY_URL
- VITE_RELAY_API_BASE
- VITE_SESSION_ID

Runtime server:

- BRIDGE_TOKENS
- CORS_ORIGIN
- STREAM_HZ
- MAX_STATE_AGE_MS
- DEFAULT_SESSION_ID

Security rule:

- Never place bridge tokens or private keys in frontend environment variables.

## Reliability and UX Signals

Expose these indicators in UI:

- Link status: connecting / connected / stale / disconnected
- State age (ms/s)
- Feed reliability score (decode/drop/duplicate based)
- Session id and source metadata

Graceful degradation policy:

- If websocket fails, keep stale snapshot with warning state.
- Attempt reconnection with backoff and endpoint rotation.
- Keep interactive UI alive even when data stream is unavailable.

## Operational Checklist

- Set strict bridge tokens.
- Restrict CORS origins in production.
- Enforce HTTPS/WSS.
- Monitor /health and session metrics.
- Persist strategy feedback artifacts on durable storage.

## Future Extensions

- JWT-based viewer access control per session.
- Replay mode from stored snapshots.
- Stream compression and delta encoding.
- Region-based relays with nearest-edge routing.
