"""
Race Session Recorder — captures all telemetry data for an entire race session.

Each race session is identified by session_uid and stored as a structured JSON
dataset with time-ordered snapshots, lap events, strategy decisions, and
aggregated metrics.
"""
import hashlib
import json
import logging
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from threading import Lock
from typing import Any

logger = logging.getLogger(__name__)

# Maximum snapshots kept in memory before auto-flush
_MAX_MEMORY_SNAPSHOTS = 600  # ~10 min at 1 snapshot/s


@dataclass
class LapRecord:
    lap_number: int
    lap_time_ms: int
    position: int
    tyre_compound: str
    tyre_age: int
    tyre_wear_pct: float
    fuel_remaining: float
    ers_level_norm: float
    sector_times_ms: list[int] = field(default_factory=list)
    is_pit_in_lap: bool = False
    is_pit_out_lap: bool = False
    timestamp: float = 0.0


@dataclass
class PitEvent:
    lap: int
    timestamp: float
    event_type: str  # "PIT_IN" | "PIT_OUT"
    tyre_compound_before: str = ""
    tyre_compound_after: str = ""
    position_before: int = 0
    position_after: int = 0
    pit_duration_ms: int = 0


@dataclass
class StrategyDecision:
    lap: int
    timestamp: float
    action: str
    score: float
    confidence: str
    reason: str
    key_inputs: dict = field(default_factory=dict)
    candidates: list[dict] = field(default_factory=list)


@dataclass
class PositionChange:
    lap: int
    timestamp: float
    old_position: int
    new_position: int
    event: str = ""  # "overtake", "undercut", "pit_loss", etc.


@dataclass
class SessionMetadata:
    session_uid: int = 0
    track: str = "UNKNOWN"
    session_type: str = "UNKNOWN"
    total_laps: int = 0
    weather_state: str = "WEATHER_0"
    start_time: float = 0.0
    end_time: float = 0.0
    duration_s: float = 0.0
    final_position: int = 0
    total_pit_stops: int = 0
    best_lap_ms: int = 0
    player_car_index: int = 0


@dataclass
class RaceSessionData:
    """Complete race session dataset."""
    metadata: SessionMetadata = field(default_factory=SessionMetadata)
    laps: list[LapRecord] = field(default_factory=list)
    pit_events: list[PitEvent] = field(default_factory=list)
    strategy_decisions: list[StrategyDecision] = field(default_factory=list)
    position_changes: list[PositionChange] = field(default_factory=list)
    snapshots: list[dict] = field(default_factory=list)
    leaderboard_history: list[dict] = field(default_factory=list)
    checksum: str = ""


class SessionRecorder:
    """
    Records telemetry data during a live race session.
    Thread-safe — called from the UDP listener thread.
    """

    def __init__(self, storage_dir: str = "./data/sessions") -> None:
        self._storage_dir = Path(storage_dir)
        self._storage_dir.mkdir(parents=True, exist_ok=True)
        self._lock = Lock()
        self._active = False
        self._session_uid: int = 0
        self._data = RaceSessionData()
        self._last_lap: int = 0
        self._last_position: int = 0
        self._last_pitting: bool = False
        self._last_compound: str = ""
        self._last_snapshot_time: float = 0.0
        self._snapshot_interval: float = 1.0  # 1 snapshot per second
        self._pit_in_time: float = 0.0

    @property
    def is_active(self) -> bool:
        return self._active

    @property
    def session_uid(self) -> int:
        return self._session_uid

    def start_session(self, session_uid: int, track: str, session_type: str,
                      total_laps: int, weather_state: str, player_car_index: int) -> None:
        """Begin recording a new race session."""
        with self._lock:
            if self._active and self._session_uid != session_uid:
                # Auto-close previous session
                self._finalize_and_save()

            self._active = True
            self._session_uid = session_uid
            self._data = RaceSessionData()
            self._data.metadata = SessionMetadata(
                session_uid=session_uid,
                track=track,
                session_type=session_type,
                total_laps=total_laps,
                weather_state=weather_state,
                start_time=time.time(),
                player_car_index=player_car_index,
            )
            self._last_lap = 0
            self._last_position = 0
            self._last_pitting = False
            self._last_compound = ""
            self._last_snapshot_time = 0.0
            self._pit_in_time = 0.0
            logger.info(f"Session recording started: {track} ({session_type}) uid={session_uid}")

    def record_state(self, state_dict: dict) -> None:
        """Record a state snapshot and extract events."""
        if not self._active or state_dict is None:
            return

        with self._lock:
            now = time.time()
            player = state_dict.get("player", {})
            current_lap = player.get("lap", 0)
            current_position = player.get("position", 0)
            is_pitting = False

            # Check leaderboard for pit status
            leaderboard = state_dict.get("leaderboard", [])
            player_car_index = state_dict.get("player_car_index", 0)
            for entry in leaderboard:
                if entry.get("car_index") == player_car_index:
                    is_pitting = entry.get("is_pitting", False)
                    break

            # ── Lap completion detection ──
            if current_lap > self._last_lap and self._last_lap > 0:
                lap_time_ms = player.get("last_lap_ms", 0)
                self._data.laps.append(LapRecord(
                    lap_number=self._last_lap,
                    lap_time_ms=lap_time_ms,
                    position=current_position,
                    tyre_compound=player.get("tyre_compound", "UNKNOWN"),
                    tyre_age=player.get("tyres_age_laps", 0),
                    tyre_wear_pct=0.0,  # derived from leaderboard
                    fuel_remaining=player.get("fuel", 0.0),
                    ers_level_norm=player.get("ers", 0.0),
                    is_pit_in_lap=self._last_pitting,
                    is_pit_out_lap=is_pitting and not self._last_pitting,
                    timestamp=now,
                ))

            # ── Pit event detection ──
            if is_pitting and not self._last_pitting:
                self._pit_in_time = now
                self._data.pit_events.append(PitEvent(
                    lap=current_lap,
                    timestamp=now,
                    event_type="PIT_IN",
                    tyre_compound_before=player.get("tyre_compound", ""),
                    position_before=current_position,
                ))
            elif not is_pitting and self._last_pitting:
                pit_duration = int((now - self._pit_in_time) * 1000) if self._pit_in_time > 0 else 0
                self._data.pit_events.append(PitEvent(
                    lap=current_lap,
                    timestamp=now,
                    event_type="PIT_OUT",
                    tyre_compound_after=player.get("tyre_compound", ""),
                    position_after=current_position,
                    pit_duration_ms=pit_duration,
                ))

            # ── Position change detection ──
            if current_position != self._last_position and self._last_position > 0 and current_position > 0:
                event = ""
                if current_position < self._last_position:
                    event = "gained"
                elif current_position > self._last_position:
                    event = "lost" if not self._last_pitting else "pit_loss"
                self._data.position_changes.append(PositionChange(
                    lap=current_lap,
                    timestamp=now,
                    old_position=self._last_position,
                    new_position=current_position,
                    event=event,
                ))

            # ── Strategy decision recording ──
            strategy = state_dict.get("strategy", {})
            if strategy.get("action") and strategy.get("confidence"):
                # Record strategy every lap change or significant confidence shift
                if current_lap > self._last_lap:
                    self._data.strategy_decisions.append(StrategyDecision(
                        lap=current_lap,
                        timestamp=now,
                        action=strategy["action"],
                        score=strategy.get("score", 0.0),
                        confidence=strategy.get("confidence", "low"),
                        reason=strategy.get("reason", ""),
                        key_inputs=strategy.get("key_inputs", {}),
                        candidates=[
                            {"action": c.get("action", ""), "score": c.get("score", 0), "reason": c.get("reason", "")}
                            for c in strategy.get("candidates", [])
                        ],
                    ))

            # ── Periodic state snapshot ──
            if now - self._last_snapshot_time >= self._snapshot_interval:
                self._last_snapshot_time = now
                # Compact snapshot — exclude minimap trace for storage efficiency
                compact = {
                    "t": now,
                    "lap": current_lap,
                    "pos": current_position,
                    "speed": player.get("speed", 0),
                    "throttle": player.get("throttle", 0),
                    "brake": player.get("brake", 0),
                    "gear": player.get("gear", 0),
                    "rpm": player.get("rpm", 0),
                    "fuel": player.get("fuel", 0),
                    "ers": player.get("ers", 0),
                    "tyre": player.get("tyre_compound", ""),
                    "tyre_age": player.get("tyres_age_laps", 0),
                    "drs": player.get("drs_enabled", False),
                    "brake_temps": player.get("brake_temps_c", []),
                    "tyre_surface_temps": player.get("tyre_surface_temps_c", []),
                    "tyre_inner_temps": player.get("tyre_inner_temps_c", []),
                    "engine_temp": player.get("engine_temp_c", 0),
                    "weather": state_dict.get("weather_state", ""),
                    "track_temp": state_dict.get("track_temp_c", 0),
                    "air_temp": state_dict.get("air_temp_c", 0),
                    "race_control": state_dict.get("race_control_state", ""),
                }
                self._data.snapshots.append(compact)

                # Periodic leaderboard snapshot (every 5 seconds)
                if len(self._data.snapshots) % 5 == 0 and leaderboard:
                    lb_snap = {
                        "t": now,
                        "lap": current_lap,
                        "entries": [
                            {
                                "pos": e.get("position", 0),
                                "code": e.get("driver_code", ""),
                                "gap": e.get("gap_to_player_s", 0),
                                "tyre": e.get("tyre_compound", ""),
                                "pit": e.get("is_pitting", False),
                                "wear": e.get("tyre_wear_pct", 0),
                            }
                            for e in leaderboard[:22]
                        ],
                    }
                    self._data.leaderboard_history.append(lb_snap)

                # Memory pressure relief
                if len(self._data.snapshots) > _MAX_MEMORY_SNAPSHOTS:
                    self._flush_snapshots_to_disk()

            self._last_lap = current_lap
            self._last_position = current_position
            self._last_pitting = is_pitting
            self._last_compound = player.get("tyre_compound", "")

    def end_session(self) -> str | None:
        """End the active session, save to disk, and return the file path."""
        with self._lock:
            if not self._active:
                return None
            return self._finalize_and_save()

    def _finalize_and_save(self) -> str:
        """Finalize session data and persist to disk. Must be called with lock held."""
        self._data.metadata.end_time = time.time()
        self._data.metadata.duration_s = self._data.metadata.end_time - self._data.metadata.start_time
        self._data.metadata.total_pit_stops = sum(1 for e in self._data.pit_events if e.event_type == "PIT_IN")

        # Best lap
        if self._data.laps:
            valid_laps = [l for l in self._data.laps if l.lap_time_ms > 0]
            if valid_laps:
                self._data.metadata.best_lap_ms = min(l.lap_time_ms for l in valid_laps)

        # Final position
        if self._data.laps:
            self._data.metadata.final_position = self._data.laps[-1].position

        # Save
        path = self._save_to_disk()
        self._active = False
        self._data = RaceSessionData()
        logger.info(f"Session saved: {path}")
        return path

    def _flush_snapshots_to_disk(self) -> None:
        """Flush accumulated snapshots to a partial file to manage memory."""
        # Keep last 100 snapshots in memory, write the rest
        overflow = self._data.snapshots[:-100]
        self._data.snapshots = self._data.snapshots[-100:]

        partial_dir = self._storage_dir / "partial"
        partial_dir.mkdir(exist_ok=True)
        partial_path = partial_dir / f"{self._session_uid}_part_{int(time.time())}.json"
        partial_path.write_text(json.dumps(overflow, separators=(",", ":")))

    def _save_to_disk(self) -> str:
        """Serialize and save the complete session with integrity checksum."""
        # Merge any partial snapshot files
        partial_dir = self._storage_dir / "partial"
        if partial_dir.exists():
            all_snapshots = []
            for pf in sorted(partial_dir.glob(f"{self._session_uid}_part_*.json")):
                try:
                    all_snapshots.extend(json.loads(pf.read_text()))
                    pf.unlink()
                except Exception as e:
                    logger.warning(f"Failed to load partial file {pf}: {e}")
            all_snapshots.extend(self._data.snapshots)
            self._data.snapshots = all_snapshots

        # Build serializable dict
        data_dict = {
            "metadata": asdict(self._data.metadata),
            "laps": [asdict(l) for l in self._data.laps],
            "pit_events": [asdict(e) for e in self._data.pit_events],
            "strategy_decisions": [asdict(d) for d in self._data.strategy_decisions],
            "position_changes": [asdict(c) for c in self._data.position_changes],
            "snapshots": self._data.snapshots,
            "leaderboard_history": self._data.leaderboard_history,
        }

        # Compute checksum before adding it
        content_for_hash = json.dumps(data_dict, sort_keys=True, separators=(",", ":"))
        checksum = hashlib.sha256(content_for_hash.encode("utf-8")).hexdigest()
        data_dict["checksum"] = checksum

        # Filename: {track}_{session_type}_{timestamp}.json
        ts = int(self._data.metadata.start_time)
        track_safe = self._data.metadata.track.replace(" ", "_")
        stype_safe = self._data.metadata.session_type.replace(" ", "_")
        filename = f"{track_safe}_{stype_safe}_{ts}.json"
        filepath = self._storage_dir / filename

        # Atomic write: write to temp, then rename
        tmp_path = filepath.with_suffix(".tmp")
        tmp_path.write_text(json.dumps(data_dict, separators=(",", ":")))
        tmp_path.rename(filepath)

        return str(filepath)


class SessionManager:
    """Manages stored race sessions — list, load, delete, export."""

    def __init__(self, storage_dir: str = "./data/sessions") -> None:
        self._storage_dir = Path(storage_dir)
        self._storage_dir.mkdir(parents=True, exist_ok=True)

    def list_sessions(self) -> list[dict]:
        """Return metadata for all stored sessions, newest first."""
        sessions = []
        for f in sorted(self._storage_dir.glob("*.json"), reverse=True):
            try:
                raw = json.loads(f.read_text())
                meta = raw.get("metadata", {})
                sessions.append({
                    "filename": f.name,
                    "track": meta.get("track", "UNKNOWN"),
                    "session_type": meta.get("session_type", "UNKNOWN"),
                    "total_laps": meta.get("total_laps", 0),
                    "start_time": meta.get("start_time", 0),
                    "duration_s": meta.get("duration_s", 0),
                    "final_position": meta.get("final_position", 0),
                    "best_lap_ms": meta.get("best_lap_ms", 0),
                    "total_pit_stops": meta.get("total_pit_stops", 0),
                    "file_size_bytes": f.stat().st_size,
                })
            except Exception as e:
                logger.warning(f"Failed to read session {f.name}: {e}")
        return sessions

    def load_session(self, filename: str) -> dict | None:
        """Load a complete session dataset. Validates checksum integrity."""
        safe_name = Path(filename).name  # Prevent path traversal
        filepath = self._storage_dir / safe_name
        if not filepath.exists() or not filepath.is_file():
            return None

        raw = json.loads(filepath.read_text())
        stored_checksum = raw.pop("checksum", "")

        # Verify integrity
        content_for_hash = json.dumps(raw, sort_keys=True, separators=(",", ":"))
        computed_checksum = hashlib.sha256(content_for_hash.encode("utf-8")).hexdigest()
        raw["checksum"] = stored_checksum
        raw["integrity_valid"] = (computed_checksum == stored_checksum)

        if not raw["integrity_valid"]:
            logger.warning(f"Checksum mismatch for session {filename}")

        return raw

    def delete_session(self, filename: str) -> bool:
        """Delete a stored session file."""
        safe_name = Path(filename).name
        filepath = self._storage_dir / safe_name
        if filepath.exists() and filepath.is_file():
            filepath.unlink()
            logger.info(f"Deleted session: {filename}")
            return True
        return False

    def export_session(self, filename: str) -> dict | None:
        """Export session data (same as load but flagged for export)."""
        data = self.load_session(filename)
        if data:
            data["exported"] = True
            data["export_time"] = time.time()
        return data
