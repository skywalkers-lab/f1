"""
Transport abstraction layer — unified interface for WebSocket and potential ZeroMQ delivery.

Inspired by pits-n-giggles' dual-channel architecture:
  • Socket.IO → Web frontend (race-table, stream-overlay rooms)
  • ZeroMQ Pub/Sub → HUD overlay (low-latency local IPC)

This module provides a common interface so consumers don't care about transport.
The EventBus publishes internally; transports subscribe to EventBus topics
and relay data to external consumers.
"""

from __future__ import annotations

import asyncio
import logging
import time
from abc import ABC, abstractmethod
from typing import Any

from pitwall.core.event_bus import TelemetryEventBus
from pitwall.core.models import HudViewModel, OverlayViewModel

logger = logging.getLogger(__name__)


class TelemetryTransport(ABC):
    """Abstract transport — sends telemetry data to external consumers."""

    def __init__(self, name: str) -> None:
        self.name = name
        self._running = False
        self._messages_sent = 0
        self._messages_dropped = 0
        self._last_send_at = 0.0

    @abstractmethod
    async def start(self) -> None:
        """Initialize transport resources."""
        ...

    @abstractmethod
    async def stop(self) -> None:
        """Shutdown transport resources."""
        ...

    @abstractmethod
    async def send(self, topic: str, data: Any) -> bool:
        """Send data on a topic. Returns True if delivered."""
        ...

    @property
    def stats(self) -> dict:
        return {
            "name": self.name,
            "running": self._running,
            "messages_sent": self._messages_sent,
            "messages_dropped": self._messages_dropped,
        }


class WebSocketTransport(TelemetryTransport):
    """
    Transport that bridges EventBus topics → WebSocket rooms.

    Maps event bus topics to WebSocket broadcast rooms with per-room throttling,
    matching pits-n-giggles' room-based architecture (race-table, stream-overlay, hud).
    """

    def __init__(
        self,
        bus: TelemetryEventBus,
        hub: Any,  # WebSocketHub
        topic_room_map: dict[str, str] | None = None,
        throttle_ms: dict[str, float] | None = None,
    ) -> None:
        super().__init__("websocket")
        self._bus = bus
        self._hub = hub
        self._sub_ids: list[int] = []
        self._topic_room_map = topic_room_map or {}
        self._throttle_ms = throttle_ms or {}
        self._room_last_sent: dict[str, float] = {}

    async def start(self) -> None:
        self._running = True

        # Subscribe to configured topics
        for topic, room in self._topic_room_map.items():
            sid = await self._bus.subscribe(topic, self._make_handler(room))
            self._sub_ids.append(sid)

        logger.info(f"WebSocketTransport started with {len(self._sub_ids)} topic bindings")

    async def stop(self) -> None:
        self._running = False
        for sid in self._sub_ids:
            await self._bus.unsubscribe(sid)
        self._sub_ids.clear()
        logger.info("WebSocketTransport stopped")

    async def send(self, topic: str, data: Any) -> bool:
        room = self._topic_room_map.get(topic)
        if not room:
            return False
        try:
            await self._hub.broadcast_to_room(room, data)
            self._messages_sent += 1
            return True
        except Exception as e:
            logger.error(f"WebSocketTransport send error: {e}")
            self._messages_dropped += 1
            return False

    def _make_handler(self, room: str):
        """Create a throttled handler for a specific room."""
        min_interval = self._throttle_ms.get(room, 0) / 1000.0

        async def handler(topic: str, data: Any) -> None:
            now = time.monotonic()
            last = self._room_last_sent.get(room, 0.0)
            if now - last < min_interval:
                return
            self._room_last_sent[room] = now
            try:
                await self._hub.broadcast_to_room(room, data)
                self._messages_sent += 1
            except Exception as e:
                logger.error(f"WebSocketTransport [{room}] error: {e}")
                self._messages_dropped += 1

        return handler


class EventBusBridge:
    """
    Bridges the StateStore's snapshot output into EventBus topics.

    Decomposes each snapshot into domain-specific topics using ViewModels,
    enabling targeted delivery to different consumer types (HUD, overlay, dashboard).

    Uses batch publish for efficiency — a single snapshot produces multiple
    topic publishes in one atomic operation.
    """

    def __init__(self, bus: TelemetryEventBus) -> None:
        self._bus = bus
        self._snapshot_count = 0
        self._last_session_uid = 0
        self._last_lap = 0

    async def on_snapshot(self, snapshot: dict) -> None:
        """
        Called when a new state snapshot is available.
        Decomposes the snapshot into domain-specific topics using ViewModels.
        """
        self._snapshot_count += 1
        messages = self._decompose(snapshot)
        await self._bus.publish_batch(messages)

    def on_snapshot_sync(self, snapshot: dict) -> None:
        """Synchronous version for use from UDP callback context."""
        self._snapshot_count += 1
        messages = self._decompose(snapshot)
        self._bus.publish_batch_sync(messages)

    def _decompose(self, snapshot: dict) -> list[tuple[str, Any]]:
        """Decompose a full snapshot into targeted topic messages."""
        messages: list[tuple[str, Any]] = []

        # 1. Full snapshot for general consumers (strategy engine, session recorder)
        messages.append(("state.snapshot", snapshot))

        # 2. HUD-specific payload via HudViewModel
        hud_vm = HudViewModel.from_snapshot(snapshot)
        messages.append(("hud.update", hud_vm.to_dict()))

        # 3. Stream overlay payload via OverlayViewModel
        overlay_vm = OverlayViewModel.from_snapshot(snapshot)
        messages.append(("frontend.stream_overlay", overlay_vm.to_dict()))

        # 4. Full race table payload (all data for dashboard)
        messages.append(("frontend.race_table", snapshot))

        # 5. Session lifecycle events
        session_uid = snapshot.get("session_uid", 0)
        if session_uid != self._last_session_uid and session_uid != 0:
            messages.append(("session.start", {
                "session_uid": session_uid,
                "track": snapshot.get("track", ""),
                "session_type": snapshot.get("session_type", ""),
            }))
            self._last_session_uid = session_uid

        player = snapshot.get("player", {})
        current_lap = player.get("lap", 0)
        if current_lap > self._last_lap and self._last_lap > 0:
            messages.append(("session.lap_change", {
                "lap": current_lap,
                "last_lap_ms": player.get("last_lap_ms", 0),
                "position": player.get("position", 0),
            }))
        self._last_lap = current_lap

        return messages

    @property
    def stats(self) -> dict:
        return {"snapshots_bridged": self._snapshot_count}
