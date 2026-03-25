"""
HUD Overlay Manager — Event-driven overlay lifecycle & routing.

Inspired by pits-n-giggles' 6-layer overlay architecture:
  L1: OverlaysMgr → subscribe EventBus, manage overlays, rate-limit
  L2: WindowManager → signals/slots (Qt in p-n-g, WebSocket here)
  L3: BaseOverlay → event registry, @on_event decorator
  L4: Individual overlays → event handlers, property bindings
  L5: MFD pages → multi-page strategy display

This module implements L1-L4 as a WebSocket-first HUD server
that can be consumed by Electron overlays, OBS browser sources,
or a future Qt/PySide6 client.
"""

from __future__ import annotations

import asyncio
import logging
import time
from abc import ABC, abstractmethod
from collections import deque
from dataclasses import dataclass, field
from typing import Any, Callable

from pitwall.core.event_bus import TelemetryEventBus

logger = logging.getLogger(__name__)


# ── Overlay Base Classes ────────────────────────────────────────────────

@dataclass
class OverlayConfig:
    """Configuration for a single overlay instance."""
    overlay_id: str
    enabled: bool = True
    visible: bool = True
    opacity: float = 1.0
    position_x: int = 0
    position_y: int = 0
    width: int = 400
    height: int = 300
    ui_scale: float = 1.0
    update_interval_ms: float = 33.0  # ~30 Hz default


class BaseOverlay(ABC):
    """
    Abstract base for all HUD overlays.
    Each overlay subscribes to specific EventBus topics
    and produces a serializable view model for the HUD client.
    """

    def __init__(self, config: OverlayConfig) -> None:
        self.config = config
        self._last_update_at: float = 0.0
        self._update_count: int = 0
        self._event_handlers: dict[str, Callable] = {}
        self._view_model: dict = {}
        self._dirty: bool = False

    @property
    def overlay_id(self) -> str:
        return self.config.overlay_id

    @property
    def view_model(self) -> dict:
        """Current renderable state for this overlay."""
        return self._view_model

    @property
    def is_dirty(self) -> bool:
        """Whether the view model has changed since last read."""
        return self._dirty

    def mark_clean(self) -> None:
        """Clear the dirty flag after the composite view has been sent."""
        self._dirty = False

    def on_event(self, topic: str, data: Any) -> None:
        """Route an event to the appropriate handler."""
        handler = self._event_handlers.get(topic)
        if handler:
            handler(data)
            self._last_update_at = time.monotonic()
            self._update_count += 1
            self._dirty = True

    def register_handler(self, topic: str, handler: Callable) -> None:
        """Register an event handler for a specific topic."""
        self._event_handlers[topic] = handler

    @abstractmethod
    def compute_view(self, data: Any) -> dict:
        """Compute the view model from incoming data. Override in subclass."""
        ...

    def should_update(self) -> bool:
        """Throttle check: enough time elapsed since last update?"""
        if not self.config.enabled or not self.config.visible:
            return False
        now = time.monotonic()
        return (now - self._last_update_at) * 1000 >= self.config.update_interval_ms

    @property
    def stats(self) -> dict:
        return {
            "overlay_id": self.config.overlay_id,
            "enabled": self.config.enabled,
            "visible": self.config.visible,
            "opacity": self.config.opacity,
            "update_count": self._update_count,
            "dirty": self._dirty,
            "last_update_ago_ms": round((time.monotonic() - self._last_update_at) * 1000, 1)
            if self._last_update_at > 0 else -1,
        }


# ── Concrete Overlay Types ──────────────────────────────────────────────

class InputTelemetryOverlay(BaseOverlay):
    """Throttle/Brake/Steer graph overlay (pits-n-giggles: input_telemetry).
    60Hz update rate with 2-second rolling history buffers."""

    def __init__(self) -> None:
        super().__init__(OverlayConfig(
            overlay_id="input_telemetry",
            update_interval_ms=16,  # 60 Hz for smooth input rendering
        ))
        self.register_handler("hud.update", self._on_hud_update)
        self._history_size = 120  # ~2 seconds at 60 Hz
        self._throttle_history: deque[float] = deque(maxlen=self._history_size)
        self._brake_history: deque[float] = deque(maxlen=self._history_size)
        self._steer_history: deque[float] = deque(maxlen=self._history_size)

    def _on_hud_update(self, data: dict) -> None:
        self._throttle_history.append(data.get("throttle", 0.0))
        self._brake_history.append(data.get("brake", 0.0))
        self._steer_history.append(data.get("steer", 0.0))
        self._view_model = self.compute_view(data)

    def compute_view(self, data: Any) -> dict:
        return {
            "overlay_id": self.overlay_id,
            "speed": data.get("speed", 0),
            "gear": data.get("gear", 0),
            "rpm": data.get("rpm", 0),
            "throttle": data.get("throttle", 0.0),
            "brake": data.get("brake", 0.0),
            "steer": data.get("steer", 0.0),
            "drs": data.get("drs", False),
            "ers_deploy_mode": data.get("ers_deploy_mode", 0),
            "throttle_history": list(self._throttle_history)[-60:],
            "brake_history": list(self._brake_history)[-60:],
            "steer_history": list(self._steer_history)[-60:],
        }


class LapTimerOverlay(BaseOverlay):
    """Current/Last/Best lap + delta overlay (pits-n-giggles: lap_timer).
    Tracks sector deltas and personal best progression."""

    def __init__(self) -> None:
        super().__init__(OverlayConfig(
            overlay_id="lap_timer",
            update_interval_ms=100,  # 10 Hz sufficient for lap info
        ))
        self.register_handler("state.snapshot", self._on_snapshot)
        self._best_sectors: list[int] = [0, 0, 0]

    def _on_snapshot(self, data: dict) -> None:
        player = data.get("player", {})
        pace = data.get("pace", {})

        # Track personal best sectors for delta calculation
        s1 = player.get("sector1_ms", 0)
        s2 = player.get("sector2_ms", 0)
        s3 = player.get("sector3_ms", 0)
        if s1 > 0 and (self._best_sectors[0] == 0 or s1 < self._best_sectors[0]):
            self._best_sectors[0] = s1
        if s2 > 0 and (self._best_sectors[1] == 0 or s2 < self._best_sectors[1]):
            self._best_sectors[1] = s2
        if s3 > 0 and (self._best_sectors[2] == 0 or s3 < self._best_sectors[2]):
            self._best_sectors[2] = s3

        self._view_model = self.compute_view({
            "player": player,
            "pace": pace,
            "total_laps": data.get("total_laps", 0),
        })

    def compute_view(self, data: Any) -> dict:
        player = data.get("player", {})
        pace = data.get("pace", {})
        current_lap_ms = player.get("current_lap_ms", 0)
        last_lap_ms = player.get("last_lap_ms", 0)
        best_lap_ms = pace.get("best_lap_ms", 0)

        delta_ms = 0
        if best_lap_ms > 0 and last_lap_ms > 0:
            delta_ms = last_lap_ms - best_lap_ms

        # Sector deltas vs personal best
        sector_deltas = []
        for i, key in enumerate(("sector1_ms", "sector2_ms", "sector3_ms")):
            current = player.get(key, 0)
            best = self._best_sectors[i]
            if current > 0 and best > 0:
                sector_deltas.append(current - best)
            else:
                sector_deltas.append(0)

        return {
            "overlay_id": self.overlay_id,
            "current_lap": player.get("lap", 0),
            "total_laps": data.get("total_laps", 0),
            "current_lap_ms": current_lap_ms,
            "last_lap_ms": last_lap_ms,
            "best_lap_ms": best_lap_ms,
            "delta_ms": delta_ms,
            "sector_deltas": sector_deltas,
            "best_sectors": list(self._best_sectors),
            "position": player.get("position", 0),
        }


class TimingTowerOverlay(BaseOverlay):
    """Adjacent cars grid with gaps (pits-n-giggles: timing_tower).
    Shows top 3 + window around player position."""

    def __init__(self, visible_cars: int = 7) -> None:
        super().__init__(OverlayConfig(
            overlay_id="timing_tower",
            update_interval_ms=200,  # 5 Hz for timing
        ))
        self._visible_cars = visible_cars
        self.register_handler("state.snapshot", self._on_snapshot)

    def _on_snapshot(self, data: dict) -> None:
        self._view_model = self.compute_view(data)

    def compute_view(self, data: Any) -> dict:
        leaderboard = data.get("leaderboard", [])
        player_index = data.get("player_car_index", 0)

        player_pos = 0
        for row in leaderboard:
            if row.get("car_index") == player_index:
                player_pos = row.get("position", 0)
                break

        # Smart visible window: always show top 3, then player's neighborhood
        top3_set = set(range(1, 4))
        half = max(1, (self._visible_cars - 3) // 2)
        window_start = max(1, player_pos - half)
        window_end = window_start + self._visible_cars

        visible = []
        for r in leaderboard:
            pos = r.get("position", 0)
            if pos in top3_set or window_start <= pos < window_end:
                visible.append({
                    "position": pos,
                    "driver_code": r.get("driver_code", ""),
                    "gap_to_player_s": r.get("gap_to_player_s", 0.0),
                    "tyre_compound": r.get("tyre_compound", ""),
                    "stint_lap": r.get("stint_lap", 0),
                    "tyre_wear_pct": r.get("tyre_wear_pct", 0.0),
                    "is_pitting": r.get("is_pitting", False),
                    "last_lap_ms": r.get("last_lap_ms", 0),
                    "is_player": r.get("car_index") == player_index,
                    "pit_window_open": r.get("pit_window_open", False),
                })

        visible.sort(key=lambda x: x["position"])

        return {
            "overlay_id": self.overlay_id,
            "cars": visible,
            "player_position": player_pos,
            "total_cars": len(leaderboard),
        }


class TrackRadarOverlay(BaseOverlay):
    """Track map with car positions and DRS zones (pits-n-giggles: track_radar)."""

    def __init__(self) -> None:
        super().__init__(OverlayConfig(
            overlay_id="track_radar",
            update_interval_ms=50,  # 20 Hz for smooth position updates
        ))
        self.register_handler("state.snapshot", self._on_snapshot)

    def _on_snapshot(self, data: dict) -> None:
        self._view_model = self.compute_view(data)

    def compute_view(self, data: Any) -> dict:
        minimap = data.get("minimap", {})
        return {
            "overlay_id": self.overlay_id,
            "mode": minimap.get("mode", "live_trace"),
            "cars": minimap.get("cars", []),
            "track_trace": minimap.get("track_trace", []),
            "transform": minimap.get("transform", {}),
            "drs_zones": minimap.get("drs_zones", []),
            "sectors": minimap.get("sectors", []),
            "player_car_index": minimap.get("player_car_index", 0),
        }


class MFDOverlay(BaseOverlay):
    """Multi-Function Display with paginated data pages
    (pits-n-giggles style — 7 pages with keyboard navigation)."""

    PAGES = ("fuel", "tyre_wear", "weather", "lap_times", "strategy", "damage", "rivals")

    def __init__(self) -> None:
        super().__init__(OverlayConfig(
            overlay_id="mfd",
            update_interval_ms=500,  # 2 Hz for strategy data
        ))
        self._current_page = 0
        self._page_data: dict[str, dict] = {}
        self.register_handler("state.snapshot", self._on_snapshot)
        self.register_handler("hud.update", self._on_hud_for_damage)

    def next_page(self) -> str:
        self._current_page = (self._current_page + 1) % len(self.PAGES)
        self._dirty = True
        return self.PAGES[self._current_page]

    def prev_page(self) -> str:
        self._current_page = (self._current_page - 1) % len(self.PAGES)
        self._dirty = True
        return self.PAGES[self._current_page]

    def set_page(self, page_name: str) -> bool:
        if page_name in self.PAGES:
            self._current_page = self.PAGES.index(page_name)
            self._dirty = True
            return True
        return False

    def _on_hud_for_damage(self, data: dict) -> None:
        """Capture damage data from HUD update for the damage page."""
        self._page_data["damage"] = {
            "front_wing_damage": data.get("front_wing_damage", 0),
            "floor_damage": data.get("floor_damage", 0),
            "engine_damage": data.get("engine_damage", 0),
            "corner_cut_warnings": data.get("corner_cut_warnings", 0),
            "time_penalties_s": data.get("time_penalties_s", 0),
        }

    def _on_snapshot(self, data: dict) -> None:
        player = data.get("player", {})
        strategy = data.get("strategy", {})
        pace = data.get("pace", {})
        agg = data.get("race_aggregate", {})
        leaderboard = data.get("leaderboard", [])

        self._page_data["fuel"] = {
            "fuel_kg": player.get("fuel", 0.0),
            "fuel_delta_per_lap": player.get("fuel_delta_per_lap", 0.0),
            "laps_remaining": max(0, data.get("total_laps", 0) - player.get("lap", 0)),
            "fuel_curve": agg.get("fuel_curve", []),
            "fuel_target_per_lap": player.get("fuel_target_per_lap", 0.0),
        }
        self._page_data["tyre_wear"] = {
            "compound": player.get("tyre_compound", ""),
            "age_laps": player.get("tyres_age_laps", 0),
            "surface_temps": player.get("tyre_surface_temps_c", []),
            "inner_temps": player.get("tyre_inner_temps_c", []),
            "wear_pct": [
                player.get("tyre_fl_wear", 0),
                player.get("tyre_fr_wear", 0),
                player.get("tyre_rl_wear", 0),
                player.get("tyre_rr_wear", 0),
            ],
            "wear_curve": agg.get("tyre_wear_curve", []),
        }
        self._page_data["weather"] = {
            "weather_state": data.get("weather_state", ""),
            "track_temp_c": data.get("track_temp_c", 0),
            "air_temp_c": data.get("air_temp_c", 0),
            "rain_pct": data.get("rain_pct", 0),
            "race_control_state": data.get("race_control_state", ""),
        }
        self._page_data["lap_times"] = {
            "best_lap_ms": pace.get("best_lap_ms", 0),
            "avg_lap_ms": pace.get("avg_lap_ms", 0),
            "recent": pace.get("recent", []),
            "lap_history": agg.get("lap_history", []),
            "consistency_pct": pace.get("consistency_pct", 0),
        }
        self._page_data["strategy"] = {
            "action": strategy.get("action", ""),
            "confidence": strategy.get("confidence", ""),
            "reason": strategy.get("reason", ""),
            "candidates": strategy.get("candidates", []),
            "score": strategy.get("score", 0),
        }
        # Rivals page: top 10 + cars around player
        self._page_data["rivals"] = {
            "leaderboard": leaderboard[:10],
            "player_position": player.get("position", 0),
        }

        self._view_model = self.compute_view(data)

    def compute_view(self, data: Any) -> dict:
        current_page_name = self.PAGES[self._current_page]
        return {
            "overlay_id": self.overlay_id,
            "current_page": current_page_name,
            "page_index": self._current_page,
            "total_pages": len(self.PAGES),
            "page_data": self._page_data.get(current_page_name, {}),
            "all_pages": list(self.PAGES),
        }


class WeatherRadarOverlay(BaseOverlay):
    """Compact weather display with forecast trend for stream overlay."""

    def __init__(self) -> None:
        super().__init__(OverlayConfig(
            overlay_id="weather_radar",
            update_interval_ms=1000,  # 1 Hz — weather changes slowly
        ))
        self.register_handler("state.snapshot", self._on_snapshot)

    def _on_snapshot(self, data: dict) -> None:
        self._view_model = self.compute_view(data)

    def compute_view(self, data: Any) -> dict:
        return {
            "overlay_id": self.overlay_id,
            "weather_state": data.get("weather_state", ""),
            "track_temp_c": data.get("track_temp_c", 0),
            "air_temp_c": data.get("air_temp_c", 0),
            "rain_pct": data.get("rain_pct", 0),
            "race_control_state": data.get("race_control_state", "GREEN"),
        }


# ── Overlay Manager (L1 — Orchestrator) ────────────────────────────────

class OverlayManager:
    """
    Central HUD overlay orchestrator — subscribes to EventBus,
    manages overlay lifecycle, aggregates view models for transport.

    Event flow:
      EventBus(state.snapshot) → OverlayManager → route to overlays
      EventBus(hud.update)     → OverlayManager → route to input overlays
                                                 → get_composite_view()
                                                 → WebSocket transport
    """

    def __init__(self, event_bus: TelemetryEventBus) -> None:
        self._bus = event_bus
        self._overlays: dict[str, BaseOverlay] = {}
        self._sub_ids: list[int] = []
        self._frame_count = 0
        self._last_composite_at = 0.0
        self._composite_interval_ms = 33.0  # ~30 Hz
        self._event_count = 0

    def register_overlay(self, overlay: BaseOverlay) -> None:
        """Add an overlay to the managed set."""
        self._overlays[overlay.overlay_id] = overlay
        logger.info(f"OverlayManager: registered '{overlay.overlay_id}'")

    def register_default_overlays(self) -> None:
        """Register the standard set of HUD overlays."""
        self.register_overlay(InputTelemetryOverlay())
        self.register_overlay(LapTimerOverlay())
        self.register_overlay(TimingTowerOverlay())
        self.register_overlay(TrackRadarOverlay())
        self.register_overlay(MFDOverlay())
        self.register_overlay(WeatherRadarOverlay())

    async def start(self) -> None:
        """Subscribe to EventBus topics and start processing."""
        sid1 = await self._bus.subscribe("state.snapshot", self._on_state_snapshot)
        sid2 = await self._bus.subscribe("hud.update", self._on_hud_update)
        self._sub_ids.extend([sid1, sid2])
        logger.info(f"OverlayManager started with {len(self._overlays)} overlays")

    async def stop(self) -> None:
        """Unsubscribe from EventBus."""
        for sid in self._sub_ids:
            await self._bus.unsubscribe(sid)
        self._sub_ids.clear()
        logger.info("OverlayManager stopped")

    async def _on_state_snapshot(self, topic: str, data: dict) -> None:
        """Route snapshot events to all overlays that listen for them."""
        self._event_count += 1
        for overlay in self._overlays.values():
            if overlay.should_update():
                overlay.on_event(topic, data)

    async def _on_hud_update(self, topic: str, data: dict) -> None:
        """Route high-frequency HUD events to input overlays."""
        self._event_count += 1
        for overlay in self._overlays.values():
            if overlay.should_update():
                overlay.on_event(topic, data)

    def get_composite_view(self) -> dict:
        """
        Aggregate all overlay view models into a single payload
        suitable for WebSocket delivery to the HUD client.
        Only includes overlays that are visible and have data.
        """
        self._frame_count += 1
        overlays = {}
        for oid, overlay in self._overlays.items():
            if overlay.config.visible and overlay.config.enabled and overlay.view_model:
                overlays[oid] = overlay.view_model
                overlay.mark_clean()

        return {
            "type": "hud_composite",
            "frame": self._frame_count,
            "overlays": overlays,
            "overlay_configs": {
                oid: {
                    "visible": o.config.visible,
                    "opacity": o.config.opacity,
                    "position": [o.config.position_x, o.config.position_y],
                    "scale": o.config.ui_scale,
                }
                for oid, o in self._overlays.items()
            },
        }

    def set_overlay_visibility(self, overlay_id: str, visible: bool) -> bool:
        overlay = self._overlays.get(overlay_id)
        if overlay:
            overlay.config.visible = visible
            return True
        return False

    def set_overlay_opacity(self, overlay_id: str, opacity: float) -> bool:
        overlay = self._overlays.get(overlay_id)
        if overlay:
            overlay.config.opacity = max(0.0, min(1.0, opacity))
            return True
        return False

    def set_all_visibility(self, visible: bool) -> None:
        for overlay in self._overlays.values():
            overlay.config.visible = visible

    def navigate_mfd(self, direction: str) -> str | None:
        """Navigate MFD overlay pages."""
        mfd = self._overlays.get("mfd")
        if not isinstance(mfd, MFDOverlay):
            return None
        if direction == "next":
            return mfd.next_page()
        elif direction == "prev":
            return mfd.prev_page()
        return None

    def set_mfd_page(self, page_name: str) -> bool:
        """Set MFD to a specific page by name."""
        mfd = self._overlays.get("mfd")
        if isinstance(mfd, MFDOverlay):
            return mfd.set_page(page_name)
        return False

    @property
    def stats(self) -> dict:
        return {
            "overlays": {oid: o.stats for oid, o in self._overlays.items()},
            "frame_count": self._frame_count,
            "overlay_count": len(self._overlays),
            "event_count": self._event_count,
        }
