import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket
from pitwall.api.ws import WebSocketHub
from pitwall.config.settings import load_settings
from pitwall.ingest.udp import run_udp_listener
from pitwall.logging.raw_log import RawPacketLogger
from pitwall.replay.player import replay_file
from pitwall.state.store import StateStore

settings = load_settings()
store = StateStore()
hub = WebSocketHub()
logger = RawPacketLogger(settings.raw_log_path)


async def _heartbeat_loop() -> None:
    while True:
        await asyncio.sleep(2.0)
        await hub.heartbeat()


@asynccontextmanager
async def lifespan(app: FastAPI):
    transport = await run_udp_listener(settings.udp_host, settings.udp_port, store, hub, logger)
    heartbeat_task = asyncio.create_task(_heartbeat_loop())
    replay_task = None
    if settings.replay_mode and settings.replay_path:
        replay_task = asyncio.create_task(
            replay_file(settings.replay_path, settings.replay_speed, store, hub)
        )
    try:
        yield
    finally:
        transport.close()
        heartbeat_task.cancel()
        if replay_task is not None:
            replay_task.cancel()


app = FastAPI(title="Pit Wall Backend", lifespan=lifespan)


@app.get("/health")
def health() -> dict:
    return {"ok": True}


@app.get("/state")
def state() -> dict:
    return store.snapshot()


@app.post("/replay/start")
async def replay_start(path: str, speed: float = 1.0) -> dict:
    processed = await replay_file(path, speed, store, hub)
    return {"ok": True, "processed": processed}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    await hub.connect(websocket)
    await websocket.send_json(store.snapshot())
    try:
        while True:
            await websocket.receive_text()
    except Exception:
        await hub.disconnect(websocket)
