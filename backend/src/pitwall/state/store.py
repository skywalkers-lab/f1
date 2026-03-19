from dataclasses import asdict
from threading import Lock
from pitwall.decoders.router import RoutedPacket
from pitwall.domain.strategy import StrategyEngine
from pitwall.state.minimap import MinimapTransformer
from pitwall.state.models import AppState
from pitwall.state.reducers import (
    rebuild_leaderboard,
    rebuild_pace,
    rebuild_strategy,
    reduce_car_status,
    reduce_car_telemetry,
    reduce_event,
    reduce_lap_data,
    reduce_motion,
    reduce_session,
)


class StateStore:
    def __init__(self, strategy_engine: StrategyEngine | None = None) -> None:
        self._state = AppState()
        self._lock = Lock()
        self._last_signature: tuple[int, int, int] | None = None
        self._last_frame_by_packet: dict[int, int] = {}
        self._minimap = MinimapTransformer()
        self._strategy = strategy_engine or StrategyEngine()

    def _is_stale_packet(self, packet_id: int, frame_identifier: int) -> bool:
        previous = self._last_frame_by_packet.get(packet_id)
        if previous is None:
            self._last_frame_by_packet[packet_id] = frame_identifier
            return False
        if frame_identifier < previous:
            return True
        self._last_frame_by_packet[packet_id] = frame_identifier
        return False

    def apply(self, routed: RoutedPacket) -> dict:
        with self._lock:
            self._state.ingest_stats.packets_received += 1

            if routed.decoded is None:
                self._state.ingest_stats.packets_dropped += 1
                if routed.diagnostic and routed.diagnostic.startswith("decode_error:"):
                    self._state.ingest_stats.decode_errors += 1
                self._state.ingest_stats.last_packet_type = routed.diagnostic or "dropped"
                self._state.touch()
                return asdict(self._state)

            signature = (
                routed.header.session_uid,
                routed.header.frame_identifier,
                routed.header.packet_id,
            )
            if signature == self._last_signature:
                self._state.ingest_stats.duplicate_packets += 1
                self._state.ingest_stats.last_packet_type = "duplicate_packet"
                self._state.touch()
                return asdict(self._state)
            self._last_signature = signature

            if self._is_stale_packet(routed.header.packet_id, routed.header.frame_identifier):
                self._state.ingest_stats.last_packet_type = "stale_packet"
                self._state.touch()
                return asdict(self._state)

            self._state.session_uid = routed.header.session_uid
            self._state.packet_format = routed.header.packet_format
            self._state.packet_version = routed.header.packet_version
            self._state.last_frame_identifier = routed.header.frame_identifier
            self._state.player_car_index = routed.header.player_car_index
            self._state.ingest_stats.packets_decoded += 1
            self._state.ingest_stats.last_packet_type = routed.decoded.kind

            payload = routed.decoded.payload
            if routed.decoded.kind == "motion":
                reduce_motion(self._state, self._minimap, payload, routed.header.player_car_index)
            elif routed.decoded.kind == "session":
                reduce_session(self._state, payload)
            elif routed.decoded.kind == "lap_data":
                reduce_lap_data(self._state, payload)
            elif routed.decoded.kind == "event":
                reduce_event(self._state, payload)
            elif routed.decoded.kind == "car_telemetry":
                reduce_car_telemetry(self._state, payload)
            elif routed.decoded.kind == "car_status":
                reduce_car_status(self._state, payload)

            rebuild_leaderboard(self._state)
            rebuild_pace(self._state)
            rebuild_strategy(self._state, self._strategy)

            self._state.touch()
            return asdict(self._state)

    def snapshot(self) -> dict:
        with self._lock:
            return asdict(self._state)
