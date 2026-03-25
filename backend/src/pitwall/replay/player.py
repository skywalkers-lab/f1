import asyncio
import json
import logging
from pathlib import Path
from typing import Protocol
from pitwall.decoders.router import route_packet
from pitwall.replay.reader import read_records
from pitwall.state.store import StateStore

logger = logging.getLogger(__name__)


class Broadcaster(Protocol):
    async def broadcast(self, payload: dict) -> None: ...


class ReplayController:
    """
    Manages replay state: play, pause, seek, speed control.
    Supports both binary replay files (read_records) and JSON session data.
    """

    def __init__(self, store: StateStore, hub: Broadcaster) -> None:
        self._store = store
        self._hub = hub
        self._speed: float = 1.0
        self._paused: bool = False
        self._playing: bool = False
        self._current_index: int = 0
        self._total_frames: int = 0
        self._task: asyncio.Task | None = None
        self._session_data: dict | None = None
        self._snapshots: list[dict] = []

    @property
    def is_playing(self) -> bool:
        return self._playing

    @property
    def is_paused(self) -> bool:
        return self._paused

    @property
    def progress(self) -> dict:
        return {
            "playing": self._playing,
            "paused": self._paused,
            "speed": self._speed,
            "current_index": self._current_index,
            "total_frames": self._total_frames,
            "progress_pct": round((self._current_index / max(1, self._total_frames)) * 100, 1),
        }

    def set_speed(self, speed: float) -> None:
        self._speed = max(0.1, min(10.0, speed))

    def pause(self) -> None:
        self._paused = True

    def resume(self) -> None:
        self._paused = False

    async def seek_to_lap(self, lap: int) -> dict | None:
        """Seek to a specific lap in the session. Returns the snapshot at that point."""
        if not self._snapshots:
            return None
        for i, snap in enumerate(self._snapshots):
            if snap.get("lap", 0) >= lap:
                self._current_index = i
                await self._hub.broadcast(snap)
                return snap
        return None

    async def seek_to_index(self, index: int) -> dict | None:
        """Seek to a specific snapshot index."""
        if not self._snapshots or index < 0 or index >= len(self._snapshots):
            return None
        self._current_index = index
        snap = self._snapshots[index]
        await self._hub.broadcast(snap)
        return snap

    def stop(self) -> None:
        self._playing = False
        self._paused = False
        if self._task and not self._task.done():
            self._task.cancel()
        self._task = None

    async def play_session(self, session_data: dict) -> int:
        """
        Play a stored JSON session (from SessionManager.load_session).
        Replays snapshots with timing intervals.
        """
        self._session_data = session_data
        self._snapshots = session_data.get("snapshots", [])
        self._total_frames = len(self._snapshots)
        self._current_index = 0
        self._playing = True
        self._paused = False

        count = 0
        last_t: float | None = None

        for i, snap in enumerate(self._snapshots):
            if not self._playing:
                break

            while self._paused:
                await asyncio.sleep(0.1)
                if not self._playing:
                    break

            self._current_index = i
            t = snap.get("t", 0)
            if last_t is not None and t > last_t:
                delta = t - last_t
                await asyncio.sleep(delta / max(self._speed, 0.01))
            last_t = t
            await self._hub.broadcast(snap)
            count += 1

        self._playing = False
        logger.info(f"Session replay completed: {count} snapshots")
        return count

    def get_lap_index(self) -> list[dict]:
        """Build a lap-indexed table of content for seeking."""
        if not self._session_data:
            return []
        laps = self._session_data.get("laps", [])
        return [
            {
                "lap": l.get("lap_number", 0),
                "time_ms": l.get("lap_time_ms", 0),
                "position": l.get("position", 0),
                "compound": l.get("tyre_compound", ""),
                "fuel": l.get("fuel_remaining", 0),
                "pit_in": l.get("is_pit_in_lap", False),
            }
            for l in laps
        ]


async def replay_file(path: str, speed: float, store: StateStore, hub: Broadcaster) -> int:
    """Replay telemetry from a binary file with proper resource cleanup."""
    last_ts: float | None = None
    count = 0
    try:
        for ts, payload in read_records(path):
            if last_ts is not None:
                delta = max(0.0, ts - last_ts)
                await asyncio.sleep(delta / max(speed, 0.01))
            last_ts = ts
            routed = route_packet(payload)
            snapshot = store.apply(routed)
            if snapshot is not None:
                await hub.broadcast(snapshot)
            count += 1
    except Exception as e:
        logger.error(f"Error during replay: {type(e).__name__}: {e}")
        raise
    finally:
        logger.info(f"Replay completed: {count} packets processed from {path}")
    
    return count
