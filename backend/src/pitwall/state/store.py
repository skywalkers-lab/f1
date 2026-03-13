from dataclasses import asdict
from threading import Lock
from pitwall.decoders.router import RoutedPacket
from pitwall.state.minimap import MinimapTransformer
from pitwall.state.models import AppState


class StateStore:
    def __init__(self) -> None:
        self._state = AppState()
        self._lock = Lock()
        self._last_signature: tuple[int, int, int] | None = None
        self._minimap = MinimapTransformer()

    def apply(self, routed: RoutedPacket) -> dict:
        with self._lock:
            self._state.ingest_stats.packets_received += 1

            if routed.decoded is None:
                self._state.ingest_stats.packets_dropped += 1
                self._state.ingest_stats.last_packet_type = routed.diagnostic or "dropped"
                self._state.touch()
                return asdict(self._state)

            signature = (
                routed.header.session_uid,
                routed.header.frame_identifier,
                routed.header.packet_id,
            )
            if signature == self._last_signature:
                self._state.ingest_stats.last_packet_type = "duplicate_packet"
                self._state.touch()
                return asdict(self._state)
            self._last_signature = signature

            self._state.session_uid = routed.header.session_uid
            self._state.packet_format = routed.header.packet_format
            self._state.packet_version = routed.header.packet_version
            self._state.last_frame_identifier = routed.header.frame_identifier
            self._state.player_car_index = routed.header.player_car_index
            self._state.ingest_stats.packets_decoded += 1
            self._state.ingest_stats.last_packet_type = routed.decoded.kind

            payload = routed.decoded.payload
            if routed.decoded.kind == "motion":
                minimap_dict = self._minimap.update(payload.cars, routed.header.player_car_index)
                self._state.minimap.mode = minimap_dict["mode"]
                self._state.minimap.player_car_index = minimap_dict["player_car_index"]
                self._state.minimap.cars = minimap_dict["cars"]
                self._state.minimap.track_trace = minimap_dict["track_trace"]
                self._state.minimap.transform = minimap_dict["transform"]
            elif routed.decoded.kind == "session":
                self._state.track = f"TRACK_{payload.track_id}"
                self._state.session_type = f"SESSION_{payload.session_type}"
                self._state.race_control_state = f"SC_{payload.safety_car_status}"
            elif routed.decoded.kind == "lap_data":
                self._state.player.position = payload.player.car_position
                self._state.player.lap = payload.player.current_lap_num
            elif routed.decoded.kind == "event":
                self._state.last_event_summary = payload.event_code
            elif routed.decoded.kind == "car_telemetry":
                self._state.player.ers = payload.player.ers_store_energy
            elif routed.decoded.kind == "car_status":
                self._state.player.fuel = payload.player.fuel_in_tank
                self._state.player.ers = payload.player.ers_store_energy
                self._state.player.tyre_compound = f"C{payload.player.visual_tyre_compound}"

            self._state.touch()
            return asdict(self._state)

    def snapshot(self) -> dict:
        with self._lock:
            return asdict(self._state)
