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

## Online Learning Model

Backend now includes a trainable contextual bandit model for strategy recommendations.

### Environment variables

- `PITWALL_ML_ENABLED=true|false`
- `PITWALL_ML_ALPHA=0.7` (blend ratio between simulator and ML)
- `PITWALL_ML_MODEL_PATH=./data/strategy_model.json`
- `PITWALL_ML_RIDGE_LAMBDA=1.5`

### APIs

- `GET /ml/status`: model metadata and sample count
- `POST /ml/feedback`: add one user feedback sample (single online update)
- `POST /ml/train/batch`: train with multiple samples in one request
- `POST /ml/model/save`: persist model to disk

When features are omitted in feedback payloads, backend uses current live `/state` snapshot to build features automatically.

## A/B/C upgrades implemented

- A: Lap/session/status parsing was expanded, leaderboard + pace now derived in backend state.
- B: Explainable strategy engine now scores candidate race action and emits confidence/reason/key inputs.
- C: WebSocket heartbeat/reconnect and replay execution path were added with replay regression tests.
