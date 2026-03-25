# F1 Telemetry Dashboard - Comprehensive Code Review

**Date**: March 20, 2026  
**Scope**: Full-stack review of Python/FastAPI backend, React/TypeScript frontend, configuration, and data flow patterns

---

## Executive Summary

This codebase has **24 identified issues** across backend, frontend, configuration, and data flow layers. Critical issues include:
- **Unhandled async tasks** in UDP listener (potential zombie processes)
- **Silent exception swallowing** in WebSocket broadcast
- **Missing CORS configuration** for cross-origin requests
- **JSON parsing without error handling** in WebSocket client
- **Resource leaks** from uncanceled timers and untracked WebSocket connections

---

## 🔴 CRITICAL ISSUES

### 1. **Backend: Unhandled Async Task in UDP Listener**
- **File**: [backend/src/pitwall/ingest/udp.py](backend/src/pitwall/ingest/udp.py#L14)
- **Severity**: CRITICAL
- **Issue**: `asyncio.create_task()` called in synchronous `datagram_received()` callback without supervision
- **Code**:
  ```python
  def datagram_received(self, data: bytes, addr) -> None:
      self.logger.append(data)
      routed = route_packet(data)
      snapshot = self.store.apply(routed)
      asyncio.create_task(self.hub.broadcast(snapshot))  # ⚠️ No await, no error handling
  ```
- **Risk**: 
  - Broadcast failures silently fail (no exception propagation)
  - High-frequency UDP packets create task accumulation if broadcast lags
  - Memory leak under packet loss conditions
- **Fix**: Use `asyncio.ensure_future()` with try-except, or refactor to async method

---

### 2. **Backend: WebSocket Broadcast Exception Swallowing Without Logging**
- **File**: [backend/src/pitwall/api/ws.py](backend/src/pitwall/api/ws.py#L18-L22)
- **Severity**: CRITICAL
- **Issue**: Exceptions in broadcast are caught but not logged, making debugging impossible
- **Code**:
  ```python
  async def broadcast(self, payload: dict) -> None:
      async with self._lock:
          clients = list(self._clients)
      for client in clients:
          try:
              await client.send_json(payload)
          except Exception:  # ⚠️ Silent failure - no logging
              await self.disconnect(client)
  ```
- **Risk**: 
  - Cannot diagnose why clients disconnect
  - Could be connection errors, serialization errors, or malformed payloads
  - No observability into system health
- **Fix**: Add structured logging with exception details

---

### 3. **Frontend: Unprotected JSON Parsing in WebSocket Handler**
- **File**: [frontend/src/lib/ws.ts](frontend/src/lib/ws.ts#L125-L136)
- **Severity**: CRITICAL
- **Issue**: `JSON.parse()` in `onmessage` callback without try-catch
- **Code**:
  ```typescript
  ws.onmessage = (ev) => {
      const data = JSON.parse(ev.data) as  // ⚠️ Can throw SyntaxError
        | AppState
        | { type: string; payload?: AppState }
      // ... rest of handler
  }
  ```
- **Risk**: 
  - Single malformed message crashes entire connection handler
  - WebSocket becomes unresponsive until reconnect
  - Player loses live telemetry during critical race moments
- **Fix**: Wrap in try-catch with error reporting

---

### 4. **Backend: No CORS Configuration**
- **File**: [backend/src/pitwall/main.py](backend/src/pitwall/main.py#L105)
- **Severity**: CRITICAL (Security + Functionality)
- **Issue**: FastAPI app has no CORS middleware configured
- **Code**:
  ```python
  app = FastAPI(title="Pit Wall Backend", lifespan=lifespan)
  # ⚠️ No CORSMiddleware added
  ```
- **Risk**: 
  - Frontend on different origin cannot access backend (unless accidentally proxied)
  - Test harnesses, external dashboards blocked by browser CORS
  - Production deployment across domains will fail
- **Fix**: Add `CORSMiddleware` with appropriate allowed origins

---

### 5. **Backend: Unbounded WebSocket Client Connections**
- **File**: [backend/src/pitwall/api/ws.py](backend/src/pitwall/api/ws.py#L7)
- **Severity**: CRITICAL (DoS/Memory)
- **Issue**: `_clients` set has no max size or eviction policy
- **Code**:
  ```python
  class WebSocketHub:
      def __init__(self) -> None:
          self._clients: set[WebSocket] = set()  # ⚠️ No size limit
      
      async def connect(self, websocket: WebSocket) -> None:
          await websocket.accept()
          async with self._lock:
              self._clients.add(websocket)  # ⚠️ Can grow indefinitely
  ```
- **Risk**: 
  - Malicious clients can exhaust server memory by connecting repeatedly
  - Broadcast time increases linearly with client count
  - No protection against connection storms
- **Fix**: Add max connections limit, implement client tracking/eviction

---

### 6. **Backend: Missing ML Model Load Error Handling**
- **File**: [backend/src/pitwall/main.py](backend/src/pitwall/main.py#L22-L27)
- **Severity**: CRITICAL
- **Issue**: Model loading fails silently if file is corrupted or missing
- **Code**:
  ```python
  ml_model = ContextualBanditModel.load(
      path=settings.ml_model_path,
      actions=actions,
      ridge_lambda=settings.ml_ridge_lambda,
  )  # ⚠️ No exception handling - app crashes if load fails
  ```
- **Risk**: 
  - Corrupted model file crashes entire backend on startup
  - No fallback to default model
  - Undeployable state without manual file deletion
- **Fix**: Wrap in try-except, use default model on failure, log clearly

---

## 🟠 HIGH SEVERITY ISSUES

### 7. **Backend: WebSocket Endpoint Missing Error Logging**
- **File**: [backend/src/pitwall/main.py](backend/src/pitwall/main.py#L205-L212)
- **Severity**: HIGH
- **Issue**: General exception catch in WebSocket endpoint has no logging
- **Code**:
  ```python
  @app.websocket("/ws")
  async def websocket_endpoint(websocket: WebSocket) -> None:
      await hub.connect(websocket)
      await websocket.send_json(store.snapshot())
      try:
          while True:
              await websocket.receive_text()
      except Exception:  # ⚠️ No error context
          await hub.disconnect(websocket)
  ```
- **Risk**: 
  - Cannot diagnose abnormal client disconnections
  - Protocol violations, network errors indistinguishable
- **Fix**: Log exception with client info and exception type

---

### 8. **Backend: Settings Default to Localhost Only**
- **File**: [backend/src/pitwall/config/settings.py](backend/src/pitwall/config/settings.py#L8)
- **Severity**: HIGH (Configuration/Deployment)
- **Issue**: `ws_host` defaults to `"127.0.0.1"` instead of `"0.0.0.0"`
- **Code**:
  ```python
  ws_host: str = "127.0.0.1"  # ⚠️ Not accessible outside localhost
  ```
- **Risk**: 
  - Frontend on different machine cannot connect even if both are running
  - Docker container cannot be accessed from host by default
  - Production deployments confused why no external connections work
- **Fix**: Default to `"0.0.0.0"` with security warnings in docs

---

### 9. **Frontend: Unguarded fetch() in Stale Poll**
- **File**: [frontend/src/lib/ws.ts](frontend/src/lib/ws.ts#L76-L82)
- **Severity**: HIGH
- **Issue**: `fetch()` in `startStalePoll()` is unguarded; network errors are silently swallowed
- **Code**:
  ```typescript
  stalePollTimer = window.setInterval(async () => {
      const snapshot = await fetchSnapshot(activeApiBase)  // ⚠️ Can throw or reject
      if (snapshot) {
          lastStateAt = Date.now()
          queueState(snapshot)
      }
  }, 1200)
  ```
- **Risk**: 
  - Network errors don't propagate; UI never reflects connection problems
  - Stale poll silently gives up if backend becomes unreachable
- **Fix**: Wrap fetch in try-catch, update connection status on error

---

### 10. **Frontend: JSON.parse() in Stale Poll Without Error Handling**
- **File**: [frontend/src/lib/ws.ts](frontend/src/lib/ws.ts#L27-L31)
- **Severity**: HIGH
- **Issue**: Indirect JSON parse in fetch response chain lacks error handling
- **Code**:
  ```typescript
  async function fetchSnapshot(apiBase: string): Promise<AppState | null> {
      try {
          const resp = await fetch(`${apiBase}/state`, { cache: 'no-store' })
          if (!resp.ok) return null
          return (await resp.json()) as AppState  // ⚠️ JSON.parse wrapped but no validation
      } catch {
          return null
      }
  }
  ```
- **Risk**: 
  - If backend returns invalid JSON, parse fails silently
  - Stale poll won't update even if backend functional
- **Fix**: Validate response structure or add typed JSON parser

---

### 11. **Backend: Raw Log File Write Without Error Handling**
- **File**: [backend/src/pitwall/logging/raw_log.py](backend/src/pitwall/logging/raw_log.py#L10-L12)
- **Severity**: HIGH (Data Loss)
- **Issue**: File append operations have no error handling for disk full, permissions, etc.
- **Code**:
  ```python
  def append(self, payload: bytes) -> None:
      with self.path.open("ab") as f:
          f.write(RECORD_HEADER.pack(time.time(), len(payload)))
          f.write(payload)  # ⚠️ Can fail silently if disk full
  ```
- **Risk**: 
  - Telemetry data loss if disk fills (no exception propagates)
  - UDP listener continues silently dropping data
  - No way to detect logging failures
- **Fix**: Add try-except with error reporting, implement fallback

---

### 12. **Backend: /replay/start Endpoint Missing Path Validation**
- **File**: [backend/src/pitwall/main.py](backend/src/pitwall/main.py#L200-L203)
- **Severity**: HIGH (Security/Stability)
- **Issue**: File path from user input used directly; no validation or sanitization
- **Code**:
  ```python
  @app.post("/replay/start")
  async def replay_start(path: str, speed: float = 1.0) -> dict:
      processed = await replay_file(path, speed, store, hub)  # ⚠️ Unsanitized path
      return {"ok": True, "processed": processed}
  ```
- **Risk**: 
  - Path traversal vulnerability (e.g., `../../../etc/passwd`)
  - Can read arbitrary files on system
  - Replay malformed files with no error handling
- **Fix**: Validate path is within allowed directory, add try-catch around replay

---

### 13. **Backend: Task Cancellation Without Await**
- **File**: [backend/src/pitwall/main.py](backend/src/pitwall/main.py#L108-111)
- **Severity**: HIGH (Resource Management)
- **Issue**: Heartbeat and replay tasks canceled in finally block without awaiting cancellation
- **Code**:
  ```python
  finally:
      transport.close()
      heartbeat_task.cancel()  # ⚠️ Not awaited
      if replay_task is not None:
          replay_task.cancel()  # ⚠️ Not awaited
  ```
- **Risk**: 
  - Tasks don't terminate cleanly; cleanup code may not run
  - Resources (file handles, connections) may not be released
  - Warnings or errors suppressed by exception swallowing
- **Fix**: Gather and await task cancellation properly

---

### 14. **Frontend: Memory Leak in useTelemetryTrendBuffer**
- **File**: [frontend/src/hooks/useTelemetryTrendBuffer.ts](frontend/src/hooks/useTelemetryTrendBuffer.ts#L12-19)
- **Severity**: HIGH (Memory)
- **Issue**: RAF callback not canceled if component unmounts mid-request
- **Code**:
  ```typescript
  useEffect(() => {
      if (!state) return
      // ... collect sample ...
      if (rafId !== null) return
      rafId = window.requestAnimationFrame(() => {
          setPoints(pointsRef.current)
          rafId = null
      })
  }, [state, options.maxPoints, options.windowMs])  // ⚠️ RAF may fire after unmount
  ```
- **Risk**: 
  - If component unmounts between RAF and callback, setState occurs on unmounted component
  - Memory leak: RAF runs in background repeatedly
  - React warning: "Can't perform a React state update on an unmounted component"
- **Fix**: Ensure RAF is canceled in effect cleanup

---

### 15. **Backend: No Type Hints on Repository Method Returns**
- **File**: [backend/src/pitwall/state/store.py](backend/src/pitwall/state/store.py#L28)
- **Severity**: HIGH (Maintainability)
- **Issue**: Key methods missing return type hints
- **Code**:
  ```python
  def apply(self, routed: RoutedPacket) -> dict:  # ⚠️ Returns 'dict', not AppState
  def snapshot(self) -> dict:  # ⚠️ Returns 'dict', not AppState
  ```
- **Risk**: 
  - Type checker can't validate downstream code
  - Consumers don't know structure of returned dict
  - Refactoring risks breaking code silently
- **Fix**: Use proper type hints: `-> AppState | dict` or create return type

---

## 🟡 MEDIUM SEVERITY ISSUES

### 16. **Frontend: useCadencedState Cleanup Timing Issue**
- **File**: [frontend/src/App.tsx](frontend/src/App.tsx#L70-77)
- **Severity**: MEDIUM
- **Issue**: Multiple cadenced hooks create overlapping intervals; cleanup order ambiguous
- **Code**:
  ```typescript
  function useCadencedState<T>(value: T, ms: number): T {
      const [cadenced, setCadenced] = useState<T>(value)
      const latestRef = useRef(value)

      useEffect(() => {
          latestRef.current = value
      }, [value])

      useEffect(() => {
          const id = window.setInterval(() => setCadenced(latestRef.current), ms)
          return () => window.clearInterval(id)
      }, [ms])
  ```
- **Risk**: 
  - Race conditions if `value` changes during interval callback
  - Multiple instances compete for same closure
- **Fix**: Use `useCallback` for closure stability

---

### 17. **Backend: Settings Environment Variables Without Validation**
- **File**: [backend/src/pitwall/config/settings.py](backend/src/pitwall/config/settings.py#L18-31)
- **Severity**: MEDIUM
- **Issue**: No validation that env vars are within reasonable bounds
- **Code**:
  ```python
  ml_ridge_lambda=float(os.getenv("PITWALL_ML_RIDGE_LAMBDA", "1.5")),
  ml_alpha=float(os.getenv("PITWALL_ML_ALPHA", "0.7")),
  ```
- **Risk**: 
  - Invalid values (negative, NaN, infinity) accepted silently
  - No bounds checking (e.g., `alpha` should be 0-1)
  - Bad config silently breaks model at runtime
- **Fix**: Add validation in Settings.__post_init__() or load_settings()

---

### 18. **Frontend: Missing Event Listener at Document Root**
- **File**: [frontend/src/App.tsx](frontend/src/App.tsx#L295-326)
- **Severity**: MEDIUM
- **Issue**: Scroll and resize listeners added to window but component refs may become stale
- **Code**:
  ```typescript
  useEffect(() => {
      function updateActiveSection() {
          const sections = sectionTargets
              .map((target) => ({ id: target.id, node: sectionRefs.current[target.id] }))
              .filter((entry): entry is { id: string; node: HTMLElement } => !!entry.node)
          // ⚠️ Refs might be stale between re-renders
      }
      updateActiveSection()
      window.addEventListener('scroll', updateActiveSection, { passive: true })
      window.addEventListener('resize', updateActiveSection)
      return () => {
          window.removeEventListener('scroll', updateActiveSection)
          window.removeEventListener('resize', updateActiveSection)
      }
  }, [sectionTargets])
  ```
- **Risk**: 
  - Cache invalidation issues if deps array wrong
  - scroll/resize fired but refs haven't updated yet
- **Fix**: Add dependency on sectionRefs or use React.useCallback

---

### 19. **Backend: No Connection Timeout on UDP Socket**
- **File**: [backend/src/pitwall/ingest/udp.py](backend/src/pitwall/ingest/udp.py#L16-21)
- **Severity**: MEDIUM (Stability)
- **Issue**: UDP server has no timeout for inactive connections
- **Code**:
  ```python
  async def run_udp_listener(host: str, port: int, ...):
      loop = asyncio.get_running_loop()
      transport, _ = await loop.create_datagram_endpoint(
          lambda: UDPServerProtocol(store, hub, logger), local_addr=(host, port)
      )  # ⚠️ No activity monitoring
      return transport
  ```
- **Risk**: 
  - Stale connections accumulate if broadcast backs up
  - No mechanism to detect dead transports
- **Fix**: Add heartbeat/timeout monitoring on transport

---

### 20. **Frontend: No Health Check Retry Logic**
- **File**: [frontend/src/lib/ws.ts](frontend/src/lib/ws.ts#L85-100)
- **Severity**: MEDIUM
- **Issue**: Failed fetchSnapshot() is retried infinitely at fixed interval
- **Code**:
  ```typescript
  stalePollTimer = window.setInterval(async () => {
      if (closed) return
      const now = Date.now()
      if (now - lastStateAt < 1800) return
      const snapshot = await fetchSnapshot(activeApiBase)  // ⚠️ Retries every 1.2s
      if (snapshot) {
          lastStateAt = Date.now()
          queueState(snapshot)
      }
  }, 1200)
  ```
- **Risk**: 
  - Hammers backend if it's temporarily down
  - No exponential backoff; contributes to server load
  - Could trigger rate limiting
- **Fix**: Implement exponential backoff on failed polls

---

### 21. **Backend: Replay File Resource Not Closed on Error**
- **File**: [backend/src/pitwall/replay/player.py](backend/src/pitwall/replay/player.py#L9-18)
- **Severity**: MEDIUM (Resource Leak)
- **Issue**: Replay doesn't handle errors on `read_records()` generator
- **Code**:
  ```python
  async def replay_file(path: str, speed: float, store: StateStore, hub: Broadcaster) -> int:
      last_ts: float | None = None
      count = 0
      for ts, payload in read_records(path):  # ⚠️ If exception raised, file not closed
          # ...
  ```
- **Risk**: 
  - File handle leaks if route_packet or store.apply fails
  - Generator cleanup not guaranteed
- **Fix**: Use `try-finally` or context manager

---

### 22. **Frontend: No Loading State for Initial Connection**
- **File**: [frontend/src/lib/ws.ts](frontend/src/lib/ws.ts#L87-92)
- **Severity**: MEDIUM (UX)
- **Issue**: First fetchSnapshot after connect has no timeout or error indication
- **Code**:
  ```typescript
  ws.onopen = () => {
      retryMs = 500
      activeApiBase = API_CANDIDATES[endpointCursor % API_CANDIDATES.length]
      onStatus('connected')
      fetchSnapshot(activeApiBase).then((snapshot) => {  // ⚠️ No timeout, no error handler
          if (snapshot && !closed) {
              lastStateAt = Date.now()
              queueState(snapshot)
          }
      })
      startStalePoll()
  }
  ```
- **Risk**: 
  - If /state endpoint hangs, no UI feedback
  - Race condition: Promise might resolve after disconnect
- **Fix**: Add timeout and error handler with UI feedback

---

### 23. **Backend: State Reducer Methods Lack Error Boundaries**
- **File**: [backend/src/pitwall/state/reducers.py](backend/src/pitwall/state/reducers.py) (not shown but referenced)
- **Severity**: MEDIUM
- **Issue**: All reducer functions called without try-catch in apply()
- **Impact**: Single malformed packet can crash state update loop
- **Fix**: Wrap each reducer in try-except or validate packet structure upstream

---

## 🟢 LOW SEVERITY ISSUES

### 24. **Frontend: Potential Memory Leak in LeaderboardRow RAF**
- **File**: [frontend/src/components/leaderboard/LeaderboardRow.tsx](frontend/src/components/leaderboard/LeaderboardRow.tsx#L63)
- **Severity**: LOW (Memory)
- **Issue**: RAF in component without visible cleanup
- **Code**:
  ```typescript
  requestAnimationFrame(() => {
      // Some animation or DOM manipulation
  })
  ```
- **Risk**: 
  - If multiple LeaderboardRow instances, multiple RAF callbacks
  - Could accumulate if list is large
- **Fix**: Capture RAF ID and cancel on unmount

---

## 📋 CONFIGURATION & DEPLOYMENT ISSUES

### 25. **Missing Production Dependencies Documentation**
- **File**: [backend/pyproject.toml](backend/pyproject.toml)
- **Severity**: MEDIUM (Deployment)
- **Issue**: No distinction between dev and production dependencies
- **Current**:
  ```toml
  dependencies = [
    "fastapi>=0.115.0",
    "uvicorn[standard]>=0.30.0",
    "pydantic>=2.8.0"
  ]
  ```
- **Risk**: 
  - Production doesn't know which packages are optional
  - Dev tools (pytest) not listed but expected to be available
  - No guidance on production middleware/server setup
- **Fix**: Add [project.optional-dependencies] with dev group, document deployment

---

### 26. **Frontend: Vite Config Doesn't Validate Required Env Vars**
- **File**: [frontend/vite.config.ts](frontend/vite.config.ts)
- **Severity**: LOW (Configuration)
- **Issue**: No validation that VITE_WS_RELAY_URL is set if not using default
- **Risk**: 
  - Build succeeds but deployed frontend can't connect
  - Confusing error at runtime
- **Fix**: Add build-time validation for required env vars

---

### 27. **Backend: No Graceful Shutdown Hook**
- **File**: [backend/src/pitwall/main.py](backend/src/pitwall/main.py#L105-112)
- **Severity**: MEDIUM (Operations)
- **Issue**: Lifespan cleanup doesn't wait for pending broadcasts/replays
- **Risk**: 
  - In-flight broadcasts lost on shutdown
  - Model not saved if training in progress
- **Fix**: Implement graceful shutdown with timeout and forced cleanup

---

## 📊 SUMMARY TABLE

| Issue | File | Severity | Type | Impact |
|-------|------|----------|------|--------|
| Unhandled async task | ingest/udp.py | CRITICAL | Resource | Memory leak, zombie processes |
| Exception swallowing | api/ws.py | CRITICAL | Observability | No error insights |
| Unprotected JSON parse | lib/ws.ts | CRITICAL | Stability | Connection crash on bad data |
| No CORS | main.py | CRITICAL | Security | Cross-origin failures |
| Unbounded connections | api/ws.py | CRITICAL | DoS | Memory exhaustion |
| ML load error | main.py | CRITICAL | Stability | Startup failure |
| WS error logging | main.py | HIGH | Observability | Cannot diagnose issues |
| Localhost only | settings.py | HIGH | Deployment | Docker/network failures |
| Unguarded fetch | lib/ws.ts | HIGH | Stability | Silent failures |
| Path traversal | main.py | HIGH | Security | Arbitrary file read |
| Task cancellation | main.py | HIGH | Resource | Cleanup failures |
| Trend buffer memory leak | hooks/useT... | HIGH | Memory | React warnings |
| Type hints missing | state/store.py | HIGH | Maintainability | Refactoring risks |
| Cadenced state race | App.tsx | MEDIUM | Stability | Value corruption |
| Env var validation | settings.py | MEDIUM | Stability | Invalid config acceptance |
| Event listener staleness | App.tsx | MEDIUM | Logic | Wrong scroll behavior |
| No UDP timeout | ingest/udp.py | MEDIUM | Stability | Connection stale |
| No retry backoff | lib/ws.ts | MEDIUM | Performance | Server hammering |
| Replay resource leak | replay/player.py | MEDIUM | Resource | File handle leak |
| No init timeout | lib/ws.ts | MEDIUM | UX | Hanging UI |
| Reducer errors | state/reducers.py | MEDIUM | Stability | Silent failure |
| RAF cleanup | components/leaderboard | LOW | Memory | Accumulation over time |
| Dev vs prod deps | pyproject.toml | MEDIUM | Deployment | Unclear requirements |
| Env var validation | vite.config.ts | LOW | Deployment | Runtime errors |
| Graceful shutdown | main.py | MEDIUM | Operations | Data loss on restart |

---

## 🔧 RECOMMENDED FIXES (Priority Order)

### Immediate (Next Sprint)
1. **[CRITICAL]** Add error handling to UDP broadcast task
2. **[CRITICAL]** Protect JSON.parse in WebSocket handler
3. **[CRITICAL]** Add CORS middleware with proper origins
4. **[CRITICAL]** Implement max connections limit on WebSocket hub
5. **[HIGH]** Wrap ML model load in try-except with fallback
6. **[HIGH]** Add logging to WebSocket error paths
7. **[HIGH]** Validate file paths in /replay/start endpoint

### Short Term (1-2 Weeks)
8. Change `ws_host` default to `"0.0.0.0"`
9. Add structur logging infrastructure (Python logging, frontend console bundles)
10. Fix RAF cleanup in useTelemetryTrendBuffer
11. Add retry backoff logic to stale poll
12. Implement connection timeout on UDP transport

### Medium Term (1 Month)
13. Create comprehensive test suite for edge cases
14. Document env var requirements and validation
15. Implement graceful shutdown protocol
16. Add health check endpoints for external monitoring
17. Type state reducers properly

---

## 📚 Additional Recommendations

### Testing
- [ ] Add integration tests for UDP → WebSocket → Browser flow
- [ ] Test malformed packet handling at each layer
- [ ] Test connection limits and cleanup under load
- [ ] Test file I/O error scenarios (disk full, permissions)

### Observability
- [ ] Add structured logging (Python `logging`, TypeScript console + Sentry)
- [ ] Instrument async task lifecycle
- [ ] Track WebSocket connection metrics (active, peak, disconnects)
- [ ] Monitor broadcast latency percentiles

### Documentation
- [ ] Environment variable reference with defaults and validation rules
- [ ] Architecture diagram showing error handling boundaries
- [ ] Deployment checklist for production
- [ ] Troubleshooting guide for common failures

### Security Review
- [ ] Input validation whitelist for all URL parameters
- [ ] Rate limiting on /ml/feedback and /ml/train/batch
- [ ] CSRF protection on state-changing endpoints
- [ ] Consider authentication for feedback endpoints

