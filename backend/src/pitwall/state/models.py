from dataclasses import dataclass, field
from datetime import datetime, timezone


@dataclass
class IngestStats:
    packets_received: int = 0
    packets_decoded: int = 0
    packets_dropped: int = 0
    last_packet_type: str = ""


@dataclass
class PlayerState:
    lap: int = 0
    position: int = 0
    tyre_compound: str = "UNKNOWN"
    fuel: float = 0.0
    ers: float = 0.0


@dataclass
class MinimapState:
    mode: str = "live_trace"
    player_car_index: int = 0
    cars: list[dict] = field(default_factory=list)
    track_trace: list[dict] = field(default_factory=list)
    transform: dict = field(
        default_factory=lambda: {"min_x": -1.0, "max_x": 1.0, "min_z": -1.0, "max_z": 1.0}
    )


@dataclass
class AppState:
    session_uid: int = 0
    packet_format: int = 0
    packet_version: int = 0
    last_frame_identifier: int = 0
    session_type: str = "UNKNOWN"
    track: str = "UNKNOWN"
    race_control_state: str = "GREEN"
    player_car_index: int = 0
    player: PlayerState = field(default_factory=PlayerState)
    minimap: MinimapState = field(default_factory=MinimapState)
    last_event_summary: str = ""
    ingest_stats: IngestStats = field(default_factory=IngestStats)
    last_update_iso: str = ""

    def touch(self) -> None:
        self.last_update_iso = datetime.now(timezone.utc).isoformat()
