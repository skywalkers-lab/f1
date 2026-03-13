from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket
from pitwall.api.ws import WebSocketHub
from pitwall.config.settings import load_settings
from pitwall.ingest.udp import run_udp_listener
from pitwall.logging.raw_log import RawPacketLogger
from pitwall.state.store import StateStore

settings = load_settings()
store = StateStore()
hub = WebSocketHub()
logger = RawPacketLogger(settings.raw_log_path)


@asynccontextmanager
async def lifespan(app: FastAPI):
    transport = await run_udp_listener(settings.udp_host, settings.udp_port, store, hub, logger)
    try:
        yield
    finally:
        transport.close()


app = FastAPI(title="Pit Wall Backend", lifespan=lifespan)


@app.get("/health")
def health() -> dict:
    return {"ok": True}


@app.get("/state")
def state() -> dict:
    return store.snapshot()


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    await hub.connect(websocket)
    await websocket.send_json(store.snapshot())
    try:
        while True:
            await websocket.receive_text()
    except Exception:
        await hub.disconnect(websocket)
