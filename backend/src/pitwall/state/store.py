from dataclasses import asdict
from threading import Lock
from pitwall.decoders.router import RoutedPacket
from pitwall.domain.strategy import StrategyEngine
from pitwall.ingest.stabilizer import PacketStabilizer
from pitwall.state.aggregator import StateAggregator
from pitwall.state.minimap import MinimapTransformer
from pitwall.state.models import AppState, FeedHealthState


class _NullStabilizer:
    """Bypass stabilizer that passes every packet through immediately.
    Used by StateStore(_test_mode=True) so tests don't depend on the 100ms
    reorder-buffer timeout firing between packet submissions."""

    _EMPTY_HEALTH = {
        "score": 100.0, "packet_loss_pct": 0.0, "avg_jitter_ms": 0.0,
        "max_jitter_ms": 0.0, "gap_rate": 0.0, "interpolation_pct": 0.0,
        "out_of_order_pct": 0.0, "uptime_s": 0.0,
    }
    _EMPTY_STATS = {
        "packets_received": 0, "packets_decoded": 0, "packets_dropped": 0,
        "duplicate_packets": 0, "out_of_order_packets": 0, "gaps_detected": 0,
        "max_gap_frames": 0, "interpolated_frames": 0, "decode_errors": 0,
        "last_packet_type": "",
    }

    def process(self, routed):  # type: ignore[override]
        return [(routed, False)]

    def get_health_dict(self) -> dict:
        return self._EMPTY_HEALTH

    def get_extended_stats(self) -> dict:
        return self._EMPTY_STATS
from pitwall.state.reducers import (
    rebuild_leaderboard,
    rebuild_pace,
    rebuild_strategy,
    reduce_car_damage,
    reduce_car_status,
    reduce_car_telemetry,
    reduce_event,
    reduce_lap_data,
    reduce_motion,
    reduce_participants,
    reduce_session,
    reduce_session_history,
)


class StateStore:
    def __init__(self, strategy_engine: StrategyEngine | None = None, _test_mode: bool = False) -> None:
        self._state = AppState()
        self._lock = Lock()
        self._last_signature: tuple[int, int, int] | None = None
        self._last_frame_by_packet: dict[tuple[int, int], int] = {}
        self._minimap = MinimapTransformer()
        self._strategy = strategy_engine or StrategyEngine()
        self._stabilizer = _NullStabilizer() if _test_mode else PacketStabilizer()
        self._aggregator = StateAggregator()
        self._last_player_lap: int = 0
        self._last_fuel_kg: float = 0.0
        self._cached_snapshot: dict | None = None
        self._snapshot_dirty: bool = True

    def _is_stale_packet(self, session_uid: int, packet_id: int, frame_identifier: int) -> bool:
        key = (session_uid, packet_id)
        previous = self._last_frame_by_packet.get(key)
        if previous is None:
            self._last_frame_by_packet[key] = frame_identifier
            return False
        if frame_identifier < previous:
            return True
        self._last_frame_by_packet[key] = frame_identifier
        return False

    def _safe_player_car_index(self, player_car_index: int, secondary_player_car_index: int) -> int:
        if 0 <= player_car_index < 22:
            return player_car_index
        if 0 <= secondary_player_car_index < 22:
            return secondary_player_car_index
        current = self._state.player_car_index
        if 0 <= current < 22:
            return current
        return 0

    def apply(self, routed: RoutedPacket) -> dict | None:
        """Apply a routed packet through stabilizer → state and return snapshot."""
        # Pass through stabilizer for reorder/dedup/health
        stabilized = self._stabilizer.process(routed)

        # Always sync stabilizer stats into state so callers see counters
        # even when the packet itself was dropped/reordered.
        self._sync_stabilizer_stats()

        if not stabilized:
            return None

        result = None
        for packet, is_interpolated in stabilized:
            result = self._apply_single(packet)

        # Update cached snapshot when we produced a result
        if result is not None:
            with self._lock:
                self._cached_snapshot = asdict(self._state)
                self._snapshot_dirty = False
                result = self._cached_snapshot

        return result

    def _sync_stabilizer_stats(self) -> None:
        """Merge stabilizer health / extended stats into state."""
        health = self._stabilizer.get_health_dict()
        ext = self._stabilizer.get_extended_stats()
        with self._lock:
            self._state.feed_health = FeedHealthState(**health)
            self._state.ingest_stats.packets_received = ext["packets_received"]
            self._state.ingest_stats.packets_decoded = ext["packets_decoded"]
            self._state.ingest_stats.packets_dropped = ext["packets_dropped"]
            self._state.ingest_stats.duplicate_packets = ext["duplicate_packets"]
            self._state.ingest_stats.out_of_order_packets = ext["out_of_order_packets"]
            self._state.ingest_stats.gaps_detected = ext["gaps_detected"]
            self._state.ingest_stats.max_gap_frames = ext["max_gap_frames"]
            self._state.ingest_stats.interpolated_frames = ext["interpolated_frames"]
            self._snapshot_dirty = True

    def _apply_single(self, routed: RoutedPacket) -> dict | None:
        """Apply a single stabilized packet to the state."""
        with self._lock:
            if routed.decoded is None:
                self._state.ingest_stats.last_packet_type = routed.diagnostic or "dropped"
                return None

            signature = (
                routed.header.session_uid,
                routed.header.frame_identifier,
                routed.header.packet_id,
            )
            if signature == self._last_signature:
                self._state.ingest_stats.last_packet_type = "duplicate_packet"
                return None
            self._last_signature = signature

            if self._is_stale_packet(
                routed.header.session_uid,
                routed.header.packet_id,
                routed.header.frame_identifier,
            ):
                self._state.ingest_stats.last_packet_type = "stale_packet"
                return None

            self._state.session_uid = routed.header.session_uid
            self._state.packet_format = routed.header.packet_format
            self._state.packet_version = routed.header.packet_version
            self._state.last_frame_identifier = routed.header.frame_identifier
            self._state.player_car_index = self._safe_player_car_index(
                routed.header.player_car_index,
                routed.header.secondary_player_car_index,
            )
            self._state.ingest_stats.last_packet_type = routed.decoded.kind

            payload = routed.decoded.payload
            if routed.decoded.kind == "motion":
                reduce_motion(self._state, self._minimap, payload, self._state.player_car_index)
            elif routed.decoded.kind == "session":
                reduce_session(self._state, payload)
            elif routed.decoded.kind == "lap_data":
                reduce_lap_data(self._state, payload)
                # Feed aggregator with opponent data
                for entry in payload.cars:
                    if entry.car_index != self._state.player_car_index:
                        self._aggregator.on_opponent_update(
                            entry.car_index, entry.car_position,
                            entry.current_lap_num, entry.last_lap_time_ms,
                            entry.delta_to_race_leader_ms,
                        )
            elif routed.decoded.kind == "event":
                reduce_event(self._state, payload)
            elif routed.decoded.kind == "participants":
                reduce_participants(self._state, payload)
                # Update spectator available drivers
                self._state.spectator.available_drivers = [
                    {"car_index": idx, "name": self._state.driver_names.get(idx, ""),
                     "code": self._state.driver_codes.get(idx, f"C{idx:02d}")}
                    for idx in self._state.active_car_indices
                ]
            elif routed.decoded.kind == "car_telemetry":
                reduce_car_telemetry(self._state, payload)
            elif routed.decoded.kind == "car_status":
                reduce_car_status(self._state, payload)
                # Track fuel burn between consecutive status packets
                current_fuel = self._state.player.fuel
                if self._last_fuel_kg > 0 and current_fuel < self._last_fuel_kg:
                    burned = self._last_fuel_kg - current_fuel
                    # Smooth into a rolling estimate (weight new sample 50%)
                    if self._state.player.fuel_delta_per_lap > 0:
                        self._state.player.fuel_delta_per_lap = round(
                            0.5 * self._state.player.fuel_delta_per_lap + 0.5 * burned, 3
                        )
                    else:
                        self._state.player.fuel_delta_per_lap = round(burned, 3)
                self._last_fuel_kg = current_fuel
            elif routed.decoded.kind == "car_damage":
                reduce_car_damage(self._state, payload)
            elif routed.decoded.kind == "session_history":
                reduce_session_history(self._state, payload)

            # Lap transition detection for aggregator
            current_lap = self._state.player.lap
            if current_lap > self._last_player_lap and self._last_player_lap > 0:
                player_row = next(
                    (r for r in self._state.leaderboard if r.car_index == self._state.player_car_index),
                    None,
                )
                self._aggregator.on_lap_change(
                    new_lap=current_lap,
                    lap_time_ms=self._state.player.last_lap_ms,
                    tyre_compound=self._state.player.tyre_compound,
                    tyre_age=self._state.player.tyres_age_laps,
                    tyre_wear_pct=player_row.tyre_wear_pct if player_row else 0.0,
                    fuel_kg=self._state.player.fuel,
                    ers_norm=min(1.0, self._state.player.ers / 4_000_000.0) if self._state.player.ers else 0.0,
                    position=self._state.player.position,
                    gap_ahead_s=abs(next(
                        (r.gap_to_player_s for r in self._state.leaderboard
                         if r.position == self._state.player.position - 1), 2.0)),
                    gap_behind_s=abs(next(
                        (r.gap_to_player_s for r in self._state.leaderboard
                         if r.position == self._state.player.position + 1), 2.0)),
                    weather_state=self._state.weather_state,
                )
                # Update fuel delta from aggregator
                if self._aggregator.aggregate.fuel_delta_per_lap > 0:
                    self._state.player.fuel_delta_per_lap = self._aggregator.aggregate.fuel_delta_per_lap
            self._last_player_lap = current_lap

            # Pit detection
            player_car = self._state.cars.get(self._state.player_car_index)
            if player_car and player_car.is_pitting:
                self._aggregator.on_pit_stop()

            # Safety car tracking
            if self._state.race_control_state.endswith("_3"):
                self._aggregator.on_safety_car("SC")
            elif self._state.race_control_state.endswith("_2"):
                self._aggregator.on_safety_car("VSC")

            rebuild_leaderboard(self._state)
            rebuild_pace(self._state)
            rebuild_strategy(self._state, self._strategy)

            # Sync aggregate state to model
            agg = self._aggregator.to_dict()
            self._state.race_aggregate.total_laps_completed = agg["total_laps_completed"]
            self._state.race_aggregate.fuel_delta_per_lap = agg["fuel_delta_per_lap"]
            self._state.race_aggregate.best_lap_ms = agg["best_lap_ms"]
            self._state.race_aggregate.best_lap_number = agg["best_lap_number"]
            self._state.race_aggregate.avg_pace_ms = agg["avg_pace_ms"]
            self._state.race_aggregate.pace_trend = agg["pace_trend"]
            self._state.race_aggregate.total_pit_stops = agg["total_pit_stops"]
            self._state.race_aggregate.safety_car_laps = agg["safety_car_laps"]
            self._state.race_aggregate.vsc_laps = agg["vsc_laps"]
            self._state.race_aggregate.fuel_curve = agg["fuel_curve"]
            self._state.race_aggregate.tyre_wear_curve = agg["tyre_wear_curve"]
            self._state.race_aggregate.lap_history = agg["lap_history"]

            self._state.touch()
            self._cached_snapshot = asdict(self._state)
            self._snapshot_dirty = False
            return self._cached_snapshot

    def set_spectator_focus(self, car_index: int) -> dict:
        """Switch spectator focus to a different driver."""
        with self._lock:
            if 0 <= car_index < 22 and car_index in self._state.cars:
                self._state.spectator.focused_car_index = car_index
                self._state.spectator.mode = "spectator"
                self._state.player_car_index = car_index
                # Rebuild derived state for new focus
                rebuild_leaderboard(self._state)
                rebuild_pace(self._state)
                self._state.touch()
                self._cached_snapshot = asdict(self._state)
                self._snapshot_dirty = False
            return self._cached_snapshot or asdict(self._state)

    def snapshot(self) -> dict:
        """Return a snapshot of the current application state.
        Uses a cached copy when available to avoid redundant asdict() deep copies."""
        with self._lock:
            if self._cached_snapshot is not None and not self._snapshot_dirty:
                return self._cached_snapshot
            self._cached_snapshot = asdict(self._state)
            self._snapshot_dirty = False
            return self._cached_snapshot
