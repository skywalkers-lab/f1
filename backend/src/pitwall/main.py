import asyncio
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from pitwall.api.ws import WebSocketHub, ROOM_RACE_TABLE, ROOM_STREAM_OVERLAY, ROOM_HUD
from pitwall.config.settings import load_settings
from pitwall.core.event_bus import TelemetryEventBus, get_event_bus
from pitwall.core.transport import WebSocketTransport, EventBusBridge
from pitwall.core.models import HudViewModel, OverlayViewModel
from pitwall.domain.strategy import RaceFeatures, StrategyEngine
from pitwall.ingest.udp import run_udp_listener
from pitwall.logging.raw_log import RawPacketLogger
from pitwall.ml.model import ContextualBanditModel
from pitwall.ml.service import FeedbackSample, StrategyLearningService
from pitwall.replay.player import replay_file, ReplayController
from pitwall.state.store import StateStore
from pitwall.storage.session_recorder import SessionRecorder, SessionManager
from pitwall.setup.engine import SetupEngine
from pitwall.analysis.post_race import PostRaceAnalyser
from pitwall.hud.engine import HudEngine
from pitwall.hud.overlay_manager import OverlayManager

logger = logging.getLogger(__name__)

settings = load_settings()
hub = WebSocketHub()
logger_packet = RawPacketLogger(settings.raw_log_path)

actions = ("PIT_NOW", "PIT_IN_1", "PIT_IN_2", "STAY_OUT")

# Load ML model with error handling
ml_model = None
try:
    ml_model = ContextualBanditModel.load(
        path=settings.ml_model_path,
        actions=actions,
        ridge_lambda=settings.ml_ridge_lambda,
    )
    logger.info(f"ML model loaded successfully from {settings.ml_model_path}")
except Exception as e:
    logger.error(f"Failed to load ML model: {type(e).__name__}: {e}")
    logger.warning("Using default ML model (untrained)")
    ml_model = ContextualBanditModel(actions=actions, ridge_lambda=settings.ml_ridge_lambda)

strategy_engine = StrategyEngine(
    alpha=settings.ml_alpha,
    ml_model=ml_model if settings.ml_enabled else None,
)
store = StateStore(strategy_engine=strategy_engine)
learning_service = StrategyLearningService(ml_model)

# Session recording & analysis
session_recorder = SessionRecorder(storage_dir="./data/sessions")
session_manager = SessionManager(storage_dir="./data/sessions")
setup_engine = SetupEngine()
post_race_analyser = PostRaceAnalyser()
hud_engine = HudEngine()
replay_controller = ReplayController(store, hub)

# ── Event Bus & Transport Layer ──────────────────────────────────────────
# Central event bus for decoupled telemetry delivery (replaces polling loops)
event_bus = get_event_bus()
event_bridge = EventBusBridge(event_bus)

# WebSocket transport: maps EventBus topics → WS rooms with throttling
ws_transport = WebSocketTransport(
    bus=event_bus,
    hub=hub,
    topic_room_map={
        "frontend.race_table": ROOM_RACE_TABLE,
        "frontend.stream_overlay": ROOM_STREAM_OVERLAY,
        "hud.update": ROOM_HUD,
    },
    throttle_ms={
        ROOM_RACE_TABLE: 100,       # 10 Hz for full dashboard
        ROOM_STREAM_OVERLAY: 50,    # 20 Hz for stream overlay
        ROOM_HUD: 33,              # 30 Hz for HUD
    },
)

# HUD Overlay Manager — event-driven overlay lifecycle
overlay_manager = OverlayManager(event_bus)
overlay_manager.register_default_overlays()


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


async def _hud_compute_subscriber(topic: str, snapshot: dict) -> None:
    """EventBus subscriber: computes HUD overlay data from state snapshots.
    Replaces the old polling _hud_broadcast_loop with event-driven delivery.

    Pipeline:
      state.snapshot → HudEngine.compute() → merge with OverlayManager composite
      → publish to hud.overlay → WebSocketTransport → /ws/hud clients
    """
    try:
        # 1. Compute HUD analytical state (penalty, damage, pit decision, rivals)
        hud_payload = hud_engine.compute(snapshot)

        # 2. Merge in real-time input telemetry from HudViewModel
        vm = HudViewModel.from_snapshot(snapshot)
        hud_payload["speed"] = vm.speed
        hud_payload["throttle"] = vm.throttle
        hud_payload["brake"] = vm.brake
        hud_payload["steer"] = vm.steer
        hud_payload["gear"] = vm.gear
        hud_payload["rpm"] = vm.rpm
        hud_payload["drs"] = vm.drs
        hud_payload["ers_deploy_mode"] = vm.ers_deploy_mode
        hud_payload["type"] = "hud"

        # 3. Merge OverlayManager composite view (overlay-specific view models)
        composite = overlay_manager.get_composite_view()
        hud_payload["overlays"] = composite.get("overlays", {})
        hud_payload["overlay_frame"] = composite.get("frame", 0)

        await event_bus.publish("hud.overlay", hud_payload)
    except Exception as e:
        logger.error(f"HUD compute subscriber error: {type(e).__name__}: {e}")


# ── Snapshot callback for session recording & setup analysis ──

_last_session_uid: int = 0
_last_lap: int = 0


def _on_snapshot(snapshot: dict) -> None:
    """Called on every decoded snapshot. Feeds session recorder and setup engine."""
    global _last_session_uid, _last_lap

    session_uid = snapshot.get("session_uid", 0)
    session_type = snapshot.get("session_type", "UNKNOWN")
    player = snapshot.get("player", {})
    current_lap = player.get("lap", 0)

    # Auto-start session recording when a race begins
    if session_uid != _last_session_uid and session_uid != 0:
        if session_recorder.is_active:
            session_recorder.end_session()
        session_recorder.start_session(
            session_uid=session_uid,
            track=snapshot.get("track", "UNKNOWN"),
            session_type=session_type,
            total_laps=snapshot.get("total_laps", 0),
            weather_state=snapshot.get("weather_state", "WEATHER_0"),
            player_car_index=snapshot.get("player_car_index", 0),
        )
        _last_session_uid = session_uid

    # Auto-end: detect race finished (lap == total_laps and position stable)
    total_laps = snapshot.get("total_laps", 0)
    if (session_recorder.is_active and total_laps > 0
            and current_lap > total_laps and _last_lap <= total_laps):
        session_recorder.end_session()

    _last_lap = current_lap

    # Feed the active session recorder
    session_recorder.record_state(snapshot)

    # Feed setup engine with compact snapshot for balance analysis
    setup_engine.ingest_snapshot({
        "speed": player.get("speed", 0),
        "throttle": player.get("throttle", 0),
        "brake": player.get("brake", 0),
        "gear": player.get("gear", 0),
        "tyre_surface_temps": player.get("tyre_surface_temps_c", [0, 0, 0, 0]),
        "tyre_inner_temps": player.get("tyre_inner_temps_c", [0, 0, 0, 0]),
        "brake_temps": player.get("brake_temps_c", [0, 0, 0, 0]),
    })


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("═" * 52)
    logger.info("  F1 25 PIT WALL — Backend starting")
    logger.info(f"  UDP listener  : {settings.udp_host}:{settings.udp_port}")
    logger.info(f"  ML enabled    : {settings.ml_enabled}")
    logger.info(f"  Replay mode   : {settings.replay_mode}")
    logger.info(f"  Event Bus     : enabled (topic-based routing)")
    logger.info("═" * 52)

    # Start EventBus transports
    await ws_transport.start()

    # Start Overlay Manager
    await overlay_manager.start()

    # Subscribe HUD compute pipeline to state snapshots
    hud_sub_id = await event_bus.subscribe("state.snapshot", _hud_compute_subscriber)

    # Wire HUD overlay output to WebSocket HUD room
    async def _hud_overlay_to_ws(topic: str, data: dict) -> None:
        await hub.broadcast_to_room(ROOM_HUD, data)

    hud_overlay_sub_id = await event_bus.subscribe("hud.overlay", _hud_overlay_to_ws)

    transport = await run_udp_listener(
        settings.udp_host, settings.udp_port, store, hub, logger_packet,
        on_snapshot=_on_snapshot, event_bridge=event_bridge,
    )
    logger.info(f"UDP listener bound to {settings.udp_host}:{settings.udp_port} — waiting for F1 25 telemetry")
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
        
        # Save any active recording session
        if session_recorder.is_active:
            try:
                session_recorder.end_session()
                logger.info("Active session recording saved on shutdown")
            except Exception as e:
                logger.error(f"Failed to save session recording: {e}")
        
        # Shutdown EventBus and transports
        await overlay_manager.stop()
        await ws_transport.stop()
        await event_bus.unsubscribe(hud_sub_id)
        await event_bus.unsubscribe(hud_overlay_sub_id)
        await event_bus.shutdown()
        
        # Gracefully cancel tasks
        tasks_to_cancel = [heartbeat_task]
        if replay_task is not None:
            tasks_to_cancel.append(replay_task)
        
        for task in tasks_to_cancel:
            task.cancel()
        
        # Wait for cancellation to complete
        try:
            await asyncio.gather(*tasks_to_cancel, return_exceptions=True)
        except Exception as e:
            logger.warning(f"Error during task cancellation: {e}")
        
        # Save model before shutdown
        if settings.ml_enabled:
            try:
                learning_service.save(settings.ml_model_path)
                logger.info(f"ML model saved to {settings.ml_model_path}")
            except Exception as e:
                logger.error(f"Failed to save ML model: {type(e).__name__}: {e}")


app = FastAPI(title="Pit Wall Backend", lifespan=lifespan)

# Add CORS middleware to allow cross-origin requests
_ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://localhost:8765",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:8765",
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_ALLOWED_ORIGINS if not os.getenv("PITWALL_CORS_ALLOW_ALL") else ["*"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

_FRONTEND_DIST = Path(__file__).resolve().parents[3] / "frontend" / "dist"
if _FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=str(_FRONTEND_DIST / "assets")), name="frontend-assets")


@app.get("/", response_model=None)
def index() -> FileResponse | dict:
    index_file = _FRONTEND_DIST / "index.html"
    if index_file.exists():
        return FileResponse(str(index_file))
    return {"ok": True, "message": "frontend dist not found; run frontend build first"}


@app.get("/health")
def health() -> dict:
    return {"ok": True}


@app.get("/debug")
def debug_info() -> dict:
    """Return diagnostic information about the running system."""
    snap = store.snapshot()
    ingest = snap.get("ingest_stats", {})
    bus_metrics = event_bus.metrics
    return {
        "ok": True,
        "udp": {
            "host": settings.udp_host,
            "port": settings.udp_port,
            "packets_received": ingest.get("packets_received", 0),
            "packets_decoded": ingest.get("packets_decoded", 0),
            "packets_dropped": ingest.get("packets_dropped", 0),
            "decode_errors": ingest.get("decode_errors", 0),
            "duplicate_packets": ingest.get("duplicate_packets", 0),
            "out_of_order_packets": ingest.get("out_of_order_packets", 0),
            "last_packet_type": ingest.get("last_packet_type", ""),
        },
        "websocket": hub.stats,
        "event_bus": {
            "total_published": bus_metrics.total_published,
            "total_delivered": bus_metrics.total_delivered,
            "total_dropped": bus_metrics.total_dropped,
            "subscribers_active": bus_metrics.subscribers_active,
            "publish_latency_us": round(bus_metrics.publish_latency_ema_us, 1),
        },
        "transport": ws_transport.stats,
        "session": {
            "track": snap.get("track", ""),
            "session_type": snap.get("session_type", ""),
            "total_laps": snap.get("total_laps", 0),
        },
        "last_update": snap.get("last_update_iso", ""),
        "ml_enabled": settings.ml_enabled,
    }


@app.get("/event-bus/stats")
def event_bus_stats() -> dict:
    """Return detailed EventBus subscriber diagnostics."""
    return {
        "ok": True,
        "metrics": {
            "total_published": event_bus.metrics.total_published,
            "total_delivered": event_bus.metrics.total_delivered,
            "total_dropped": event_bus.metrics.total_dropped,
            "subscribers_active": event_bus.metrics.subscribers_active,
            "publish_latency_ema_us": round(event_bus.metrics.publish_latency_ema_us, 1),
        },
        "subscribers": event_bus.get_subscriber_stats(),
        "bridge": event_bridge.stats,
        "transport": ws_transport.stats,
    }


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
    """Start replaying a telemetry file with path validation."""
    try:
        # Validate speed parameter
        speed = max(0.1, min(10.0, speed))

        # Validate and sanitize path to prevent traversal attacks
        replay_path = Path(path).resolve()
        
        # Restrict replay files to the data directory
        allowed_base = Path("./data").resolve()
        if not replay_path.is_relative_to(allowed_base):
            logger.warning(f"Replay path outside allowed directory: {replay_path}")
            return {"ok": False, "error": "Access denied — replay files must be in the data directory"}
        
        # Ensure path exists and is readable
        if not replay_path.exists():
            logger.warning(f"Replay file not found: {replay_path}")
            return {"ok": False, "error": "File not found"}
        
        if not replay_path.is_file():
            logger.warning(f"Replay path is not a file: {replay_path}")
            return {"ok": False, "error": "Path is not a file"}
        
        logger.info(f"Starting replay: {replay_path} (speed: {speed}x)")
        processed = await replay_file(str(replay_path), speed, store, hub)
        logger.info(f"Replay completed: {processed} packets processed")
        return {"ok": True, "processed": processed}
    except Exception as e:
        logger.error(f"Replay failed: {type(e).__name__}: {e}")
        return {"ok": False, "error": "Replay failed"}


@app.post("/replay/session/{filename}")
async def replay_session(filename: str, speed: float = 1.0) -> dict:
    """Replay a stored JSON session with seek support."""
    if "/" in filename or "\\" in filename or ".." in filename:
        return {"ok": False, "error": "Invalid filename"}
    data = session_manager.load_session(filename)
    if not data:
        return {"ok": False, "error": "Session not found"}
    replay_controller.set_speed(max(0.1, min(10.0, speed)))
    count = await replay_controller.play_session(data)
    return {"ok": True, "processed": count}


@app.post("/replay/pause")
def replay_pause() -> dict:
    """Pause the current replay."""
    replay_controller.pause()
    return {"ok": True, **replay_controller.progress}


@app.post("/replay/resume")
def replay_resume() -> dict:
    """Resume the paused replay."""
    replay_controller.resume()
    return {"ok": True, **replay_controller.progress}


@app.post("/replay/stop")
def replay_stop() -> dict:
    """Stop the current replay."""
    replay_controller.stop()
    return {"ok": True}


@app.post("/replay/seek/lap/{lap}")
async def replay_seek_lap(lap: int) -> dict:
    """Seek to a specific lap in the replay."""
    snap = await replay_controller.seek_to_lap(lap)
    return {"ok": snap is not None, **replay_controller.progress}


@app.post("/replay/speed/{speed}")
def replay_set_speed(speed: float) -> dict:
    """Set replay speed multiplier."""
    replay_controller.set_speed(speed)
    return {"ok": True, "speed": replay_controller.progress["speed"]}


@app.get("/replay/progress")
def replay_progress() -> dict:
    """Get current replay progress."""
    return {"ok": True, **replay_controller.progress}


@app.get("/replay/laps")
def replay_lap_index() -> dict:
    """Get lap index for the current replay session."""
    return {"ok": True, "laps": replay_controller.get_lap_index()}


# ── Session Recording API ──────────────────────────────

@app.post("/sessions/start")
def sessions_start() -> dict:
    """Start recording the current race session."""
    snap = store.snapshot()
    session_recorder.start_session(
        session_uid=snap.get("session_uid", 0),
        track=snap.get("track", "UNKNOWN"),
        session_type=snap.get("session_type", "UNKNOWN"),
        total_laps=snap.get("total_laps", 0),
        weather_state=snap.get("weather_state", "WEATHER_0"),
        player_car_index=snap.get("player_car_index", 0),
    )
    return {"ok": True, "session_uid": snap.get("session_uid", 0)}


@app.post("/sessions/stop")
def sessions_stop() -> dict:
    """Stop recording and save the current session."""
    path = session_recorder.end_session()
    if path:
        return {"ok": True, "path": path}
    return {"ok": False, "error": "No active session"}


@app.get("/sessions/status")
def sessions_status() -> dict:
    """Check session recording status."""
    return {
        "active": session_recorder.is_active,
        "session_uid": session_recorder.session_uid,
    }


@app.get("/sessions/list")
def sessions_list() -> dict:
    """List all stored race sessions."""
    return {"ok": True, "sessions": session_manager.list_sessions()}


@app.get("/sessions/{filename}")
def sessions_load(filename: str) -> dict:
    """Load a complete stored session."""
    # Prevent path traversal in filename
    if "/" in filename or "\\" in filename or ".." in filename:
        return {"ok": False, "error": "Invalid filename"}
    data = session_manager.load_session(filename)
    if data:
        return {"ok": True, "data": data}
    return {"ok": False, "error": "Session not found"}


@app.delete("/sessions/{filename}")
def sessions_delete(filename: str) -> dict:
    """Delete a stored session."""
    if "/" in filename or "\\" in filename or ".." in filename:
        return {"ok": False, "error": "Invalid filename"}
    deleted = session_manager.delete_session(filename)
    return {"ok": deleted}


@app.get("/sessions/{filename}/export")
def sessions_export(filename: str) -> dict:
    """Export a session for download."""
    if "/" in filename or "\\" in filename or ".." in filename:
        return {"ok": False, "error": "Invalid filename"}
    data = session_manager.export_session(filename)
    if data:
        return {"ok": True, "data": data}
    return {"ok": False, "error": "Session not found"}


# ── #49: Batch export to CSV/Parquet ──────────────────

@app.get("/sessions/{filename}/export/csv")
def sessions_export_csv(filename: str):
    """Export session data as CSV for data science workflows."""
    import csv
    import io
    from fastapi.responses import StreamingResponse

    if "/" in filename or "\\" in filename or ".." in filename:
        return {"ok": False, "error": "Invalid filename"}
    data = session_manager.load_session(filename)
    if not data:
        return {"ok": False, "error": "Session not found"}

    snapshots = data.get("snapshots", [])
    if not snapshots:
        return {"ok": False, "error": "No snapshots in session"}

    output = io.StringIO()
    writer = csv.writer(output)

    # Header
    writer.writerow([
        "lap", "session_time", "position", "driver_code", "car_index",
        "gap_to_leader_s", "last_lap_ms", "best_lap_ms",
        "tyre_compound", "tyre_wear_pct", "is_pitting", "stint_lap",
    ])

    for snap in snapshots:
        player = snap.get("player", {})
        lap = player.get("lap", 0)
        session_time = snap.get("session_time", 0)
        for row in snap.get("leaderboard", []):
            writer.writerow([
                lap,
                session_time,
                row.get("position", 0),
                row.get("driver_code", ""),
                row.get("car_index", 0),
                row.get("gap_to_leader_s", ""),
                row.get("last_lap_ms", ""),
                row.get("best_lap_ms", ""),
                row.get("tyre_compound", ""),
                row.get("tyre_wear_pct", ""),
                row.get("is_pitting", False),
                row.get("stint_lap", ""),
            ])

    output.seek(0)
    safe_name = filename.replace(".json", "").replace(".gz", "")
    return StreamingResponse(
        output,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}.csv"'},
    )


# ── Post-Race Analysis API ─────────────────────────────

@app.get("/analysis/{filename}")
def analysis_report(filename: str) -> dict:
    """Generate a full post-race analysis report for a stored session."""
    data = session_manager.load_session(filename)
    if not data:
        return {"ok": False, "error": "Session not found"}
    report = post_race_analyser.analyse(data)
    return {"ok": True, "report": report}


# ── Vehicle Setup API ──────────────────────────────────

@app.get("/setup/recommendation")
def setup_recommendation() -> dict:
    """Get current setup recommendation based on live telemetry."""
    snap = store.snapshot()
    track_id = snap.get("track", "TRACK_UNKNOWN")
    return {"ok": True, **setup_engine.to_dict(track_id)}


@app.get("/setup/preset/{track_id}")
def setup_preset(track_id: str) -> dict:
    """Get the base setup preset for a circuit."""
    preset = setup_engine.get_preset(track_id)
    return {"ok": True, "preset": preset}


@app.post("/setup/apply")
def setup_apply(setup: dict) -> dict:
    """Record a user-applied setup."""
    setup_engine.apply_setup(setup)
    return {"ok": True}


@app.get("/setup/balance")
def setup_balance() -> dict:
    """Get current vehicle balance analysis."""
    from dataclasses import asdict
    balance = setup_engine.get_balance()
    return {"ok": True, "balance": asdict(balance)}


@app.get("/hud")
def hud_state() -> dict:
    """Get current computed HUD state for driver overlay."""
    snap = store.snapshot()
    return {"ok": True, "hud": hud_engine.compute(snap)}


@app.get("/hud/composite")
def hud_composite() -> dict:
    """Get composite view from all active HUD overlays."""
    return {"ok": True, **overlay_manager.get_composite_view()}


@app.get("/hud/overlays")
def hud_overlay_list() -> dict:
    """List all registered HUD overlays with their status."""
    return {"ok": True, **overlay_manager.stats}


@app.post("/hud/overlay/{overlay_id}/visibility")
def hud_set_visibility(overlay_id: str, visible: bool = True) -> dict:
    """Toggle overlay visibility."""
    ok = overlay_manager.set_overlay_visibility(overlay_id, visible)
    return {"ok": ok}


@app.post("/hud/overlay/{overlay_id}/opacity")
def hud_set_opacity(overlay_id: str, opacity: float = 1.0) -> dict:
    """Set overlay opacity (0.0 - 1.0)."""
    ok = overlay_manager.set_overlay_opacity(overlay_id, max(0.0, min(1.0, opacity)))
    return {"ok": ok}


@app.post("/hud/mfd/navigate")
def hud_mfd_navigate(direction: str = "next") -> dict:
    """Navigate MFD pages (next/prev)."""
    page = overlay_manager.navigate_mfd(direction)
    return {"ok": page is not None, "current_page": page}


@app.post("/hud/toggle-all")
def hud_toggle_all(visible: bool = True) -> dict:
    """Toggle all overlay visibility at once."""
    overlay_manager.set_all_visibility(visible)
    return {"ok": True, "visible": visible}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    """WebSocket endpoint for real-time telemetry streaming."""
    try:
        await hub.connect(websocket, role="viewer", room=ROOM_RACE_TABLE)
        await websocket.send_json(store.snapshot())
        try:
            while True:
                msg = await websocket.receive_text()
                # Handle client commands
                try:
                    import json
                    cmd = json.loads(msg)
                    if cmd.get("type") == "spectator_focus":
                        car_index = int(cmd.get("car_index", -1))
                        if 0 <= car_index < 22:
                            await hub.set_client_focus(websocket, car_index)
                            new_state = store.set_spectator_focus(car_index)
                            await websocket.send_json(new_state)
                    elif cmd.get("type") == "reset_focus":
                        new_state = store.set_spectator_focus(-1)
                        await websocket.send_json(new_state)
                    elif cmd.get("type") == "join_room":
                        room = cmd.get("room", ROOM_RACE_TABLE)
                        await hub.set_client_room(websocket, room)
                except (json.JSONDecodeError, ValueError, KeyError):
                    pass  # Ignore malformed commands
        except Exception as e:
            logger.debug(f"WebSocket receive error: {type(e).__name__}: {e}")
            raise
    except Exception as e:
        logger.error(f"WebSocket endpoint error: {type(e).__name__}: {e}")
    finally:
        await hub.disconnect(websocket)


@app.websocket("/ws/hud")
async def websocket_hud_endpoint(websocket: WebSocket) -> None:
    """High-frequency WebSocket for in-game HUD overlay (~30Hz).
    Receives composite HudState from OverlayManager + input telemetry.
    Supports overlay control commands from the client.
    """
    try:
        use_msgpack = "msgpack" in (websocket.query_params.get("encoding", "") or "")
        await hub.connect(websocket, role="hud", room=ROOM_HUD, use_msgpack=use_msgpack)
        # Send initial composite HUD state
        composite = overlay_manager.get_composite_view()
        await websocket.send_json(composite)
        try:
            while True:
                msg = await websocket.receive_text()
                try:
                    import json
                    cmd = json.loads(msg)
                    cmd_type = cmd.get("type", "")
                    if cmd_type == "set_visibility":
                        overlay_id = cmd.get("overlay_id", "")
                        visible = cmd.get("visible", True)
                        overlay_manager.set_overlay_visibility(overlay_id, visible)
                    elif cmd_type == "set_opacity":
                        overlay_id = cmd.get("overlay_id", "")
                        opacity = float(cmd.get("opacity", 1.0))
                        overlay_manager.set_overlay_opacity(overlay_id, opacity)
                    elif cmd_type == "toggle_all":
                        visible = cmd.get("visible", True)
                        overlay_manager.set_all_visibility(visible)
                    elif cmd_type == "mfd_navigate":
                        direction = cmd.get("direction", "next")
                        page = overlay_manager.navigate_mfd(direction)
                        await websocket.send_json({"type": "mfd_page", "page": page})
                    elif cmd_type == "get_composite":
                        composite = overlay_manager.get_composite_view()
                        await websocket.send_json(composite)
                except (json.JSONDecodeError, ValueError, KeyError):
                    pass
        except Exception as e:
            logger.debug(f"HUD WebSocket receive error: {type(e).__name__}: {e}")
            raise
    except Exception as e:
        logger.error(f"HUD WebSocket endpoint error: {type(e).__name__}: {e}")
    finally:
        await hub.disconnect(websocket)


@app.websocket("/ws/overlay")
async def websocket_overlay_endpoint(websocket: WebSocket) -> None:
    """Medium-frequency WebSocket for stream overlays (~20Hz).
    Sends compact race state: leaderboard + player + minimap.
    Designed for OBS browser source with transparent background.
    """
    try:
        use_msgpack = "msgpack" in (websocket.query_params.get("encoding", "") or "")
        await hub.connect(websocket, role="overlay", room=ROOM_STREAM_OVERLAY, use_msgpack=use_msgpack)
        # Send initial compact state
        snap = store.snapshot()
        player = snap.get("player", {})
        initial = {
            "type": "overlay",
            "player": player,
            "leaderboard": snap.get("leaderboard", []),
            "minimap": snap.get("minimap", {}),
            "race_control_state": snap.get("race_control_state", ""),
            "weather_state": snap.get("weather_state", ""),
            "total_laps": snap.get("total_laps", 0),
            "track": snap.get("track", ""),
            "session_type": snap.get("session_type", ""),
            "driver_codes": snap.get("driver_codes", {}),
            "last_event_summary": snap.get("last_event_summary", ""),
        }
        await websocket.send_json(initial)
        try:
            while True:
                await websocket.receive_text()
        except Exception as e:
            logger.debug(f"Overlay WebSocket receive error: {type(e).__name__}: {e}")
            raise
    except Exception as e:
        logger.error(f"Overlay WebSocket endpoint error: {type(e).__name__}: {e}")
    finally:
        await hub.disconnect(websocket)


# ── Feed Health & Spectator API ────────────────────────

@app.get("/feed/health")
def feed_health() -> dict:
    """Get current feed health score and diagnostics."""
    snap = store.snapshot()
    return {
        "ok": True,
        "feed_health": snap.get("feed_health", {}),
        "ingest_stats": snap.get("ingest_stats", {}),
    }


@app.get("/race/aggregate")
def race_aggregate() -> dict:
    """Get race-level aggregated state (stints, fuel curve, tyre wear, etc.)."""
    snap = store.snapshot()
    return {
        "ok": True,
        "aggregate": snap.get("race_aggregate", {}),
    }


@app.post("/spectator/focus/{car_index}")
def spectator_focus(car_index: int) -> dict:
    """Switch spectator focus to a specific driver."""
    if not (0 <= car_index < 22):
        return {"ok": False, "error": "Invalid car index"}
    new_state = store.set_spectator_focus(car_index)
    return {"ok": True, "player_car_index": new_state.get("player_car_index")}


@app.get("/spectator/drivers")
def spectator_drivers() -> dict:
    """List available drivers for spectator selection."""
    snap = store.snapshot()
    spectator = snap.get("spectator", {})
    return {
        "ok": True,
        "drivers": spectator.get("available_drivers", []),
        "current_focus": snap.get("player_car_index", 0),
    }


@app.get("/hud/state")
def hud_state_rest() -> dict:
    """REST fallback: return current computed HUD state."""
    return hud_engine.compute(store.snapshot())
