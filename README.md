# Pit Wall MVP

## Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -e .[dev]
uvicorn pitwall.main:app --host 127.0.0.1 --port 8765
```

## Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend expects backend WebSocket at `ws://127.0.0.1:8765/ws`.

## Tests

```bash
cd backend
pytest
```

## Phase 4 MVP plan update: circuit minimap

- Motion packet (`packet_id=0`) is now part of decoder priority and updates normalized world positions for up to 22 cars.
- Minimap pipeline is separated into:
  1. raw motion decoder (`decoders/packets.py::decode_motion`)
  2. normalized car world positions (`decoders/models.py::MotionPacket`)
  3. minimap coordinate transform (`state/minimap.py::MinimapTransformer`)
  4. frontend minimap renderer (`frontend/src/components/MinimapPanel.tsx`)
- First implementation uses `live_trace` mode and builds track outline dynamically from sampled `m_worldPositionX`/`m_worldPositionZ` values.
- UI explicitly shows minimap source mode (`live_trace` vs future `prebuilt_map`) and renders partial trace + car dots even when outline is incomplete.
