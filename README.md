# Pit Wall MVP

## Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -e .[dev]
uvicorn pitwall.main:app --host 127.0.0.1 --port 8765
```

### Optional replay mode at startup

```bash
PITWALL_REPLAY_MODE=true PITWALL_REPLAY_PATH=./data/raw_packets.log PITWALL_REPLAY_SPEED=2.0 uvicorn pitwall.main:app --host 127.0.0.1 --port 8765
```

### Trigger replay via API

```bash
curl -X POST "http://127.0.0.1:8765/replay/start?path=./data/raw_packets.log&speed=2.0"
```

## Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend expects backend WebSocket at `ws://127.0.0.1:8765/ws` with auto-reconnect + heartbeat support.

## Tests

```bash
cd backend
pytest
```

## A/B/C upgrades implemented

- A: Lap/session/status parsing was expanded, leaderboard + pace now derived in backend state.
- B: Explainable strategy engine now scores candidate race action and emits confidence/reason/key inputs.
- C: WebSocket heartbeat/reconnect and replay execution path were added with replay regression tests.
