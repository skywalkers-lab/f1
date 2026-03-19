import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket
from pydantic import BaseModel, Field
from pitwall.api.ws import WebSocketHub
from pitwall.config.settings import load_settings
from pitwall.domain.strategy import RaceFeatures, StrategyEngine
from pitwall.ingest.udp import run_udp_listener
from pitwall.logging.raw_log import RawPacketLogger
from pitwall.ml.model import ContextualBanditModel
from pitwall.ml.service import FeedbackSample, StrategyLearningService
from pitwall.replay.player import replay_file
from pitwall.state.store import StateStore

settings = load_settings()
hub = WebSocketHub()
logger = RawPacketLogger(settings.raw_log_path)

actions = ("PIT_NOW", "PIT_IN_1", "PIT_IN_2", "STAY_OUT")
ml_model = ContextualBanditModel.load(
    path=settings.ml_model_path,
    actions=actions,
    ridge_lambda=settings.ml_ridge_lambda,
)
strategy_engine = StrategyEngine(
    alpha=settings.ml_alpha,
    ml_model=ml_model if settings.ml_enabled else None,
)
store = StateStore(strategy_engine=strategy_engine)
learning_service = StrategyLearningService(ml_model)


class FeedbackFeaturesDto(BaseModel):
    laps_remaining: int = 0
    stint_length: int = 0
    tyre_compound: str = "C3"
    tyre_age: int = 0
    tyre_wear_mean: float = 0.0
    fuel_remaining: float = 0.0
    fuel_delta_per_lap: float = 0.0
    ers_level_norm: float = 0.0
    gap_ahead_s: float = 2.0
    gap_behind_s: float = 2.0
    relative_pace_s: float = 0.0
    traffic_density: float = 0.0
    pit_window_status: str = "CLOSED"
    sc_vsc_status: str = "GREEN"
    weather_state: str = "WEATHER_0"
    player_position: int = 1
    track_id: str = "TRACK_UNKNOWN"
    base_lap_time_s: float = 89.0


class FeedbackDto(BaseModel):
    action: str
    reward: float = Field(description="Positive reward means better outcome")
    weight: float = 1.0
    features: FeedbackFeaturesDto | None = None


class FeedbackBatchDto(BaseModel):
    samples: list[FeedbackDto]


def _features_from_dto(dto: FeedbackFeaturesDto) -> RaceFeatures:
    return RaceFeatures(
        laps_remaining=max(0, dto.laps_remaining),
        stint_length=max(0, dto.stint_length),
        tyre_compound=dto.tyre_compound,
        tyre_age=max(0, dto.tyre_age),
        tyre_wear_mean=min(1.0, max(0.0, dto.tyre_wear_mean)),
        fuel_remaining=max(0.0, dto.fuel_remaining),
        fuel_delta_per_lap=max(0.0, dto.fuel_delta_per_lap),
        ers_level_norm=min(1.0, max(0.0, dto.ers_level_norm)),
        gap_ahead_s=max(0.0, dto.gap_ahead_s),
        gap_behind_s=max(0.0, dto.gap_behind_s),
        relative_pace_s=dto.relative_pace_s,
        traffic_density=min(1.0, max(0.0, dto.traffic_density)),
        pit_window_status=dto.pit_window_status,
        sc_vsc_status=dto.sc_vsc_status,
        weather_state=dto.weather_state,
        player_position=min(22, max(1, dto.player_position)),
        track_id=dto.track_id,
        base_lap_time_s=max(10.0, dto.base_lap_time_s),
    )


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
        if settings.ml_enabled:
            learning_service.save(settings.ml_model_path)


app = FastAPI(title="Pit Wall Backend", lifespan=lifespan)


@app.get("/health")
def health() -> dict:
    return {"ok": True}


@app.get("/state")
def state() -> dict:
    return store.snapshot()


@app.get("/ml/status")
def ml_status() -> dict:
    return {
        "enabled": settings.ml_enabled,
        "alpha": settings.ml_alpha,
        "model_path": settings.ml_model_path,
        "model": learning_service.status(),
    }


@app.post("/ml/feedback")
def ml_feedback(payload: FeedbackDto) -> dict:
    features = _features_from_dto(payload.features) if payload.features is not None else None
    applied = learning_service.add_feedback(
        FeedbackSample(
            action=payload.action,
            reward=payload.reward,
            weight=payload.weight,
            features=features,
        ),
        fallback_snapshot=store.snapshot(),
    )
    return {
        "ok": applied,
        "status": learning_service.status(),
    }


@app.post("/ml/train/batch")
def ml_train_batch(payload: FeedbackBatchDto) -> dict:
    samples = [
        FeedbackSample(
            action=item.action,
            reward=item.reward,
            weight=item.weight,
            features=_features_from_dto(item.features) if item.features is not None else None,
        )
        for item in payload.samples
    ]
    learned = learning_service.train_feedback_batch(samples, fallback_snapshot=store.snapshot())
    return {
        "ok": True,
        "learned": learned,
        "received": len(payload.samples),
        "status": learning_service.status(),
    }


@app.post("/ml/model/save")
def ml_save() -> dict:
    learning_service.save(settings.ml_model_path)
    return {"ok": True, "path": settings.ml_model_path}


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
