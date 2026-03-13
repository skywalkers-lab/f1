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
    last_lap_ms: int = 0
    current_lap_ms: int = 0


@dataclass
class CarRaceState:
    car_index: int
    position: int = 0
    current_lap: int = 0
    last_lap_ms: int = 0
    current_lap_ms: int = 0
    tyre_compound: str = "UNK"
    is_pitting: bool = False


@dataclass
class LeaderboardRow:
    position: int
    car_index: int
    driver_code: str
    gap_to_player_s: float
    tyre_compound: str
    is_pitting: bool
    last_lap_ms: int


@dataclass
class PaceSample:
    lap: int
    lap_time_ms: int


@dataclass
class PaceSummary:
    best_lap_ms: int = 0
    avg_lap_ms: int = 0
    consistency_pct: float = 0.0
    recent: list[PaceSample] = field(default_factory=list)


@dataclass
class StrategyState:
    action: str = "STAY_OUT"
    score: float = 0.0
    confidence: str = "low"
    reason: str = "No recommendation yet"
    key_inputs: dict = field(default_factory=dict)


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
    cars: dict[int, CarRaceState] = field(default_factory=dict)
    leaderboard: list[LeaderboardRow] = field(default_factory=list)
    pace: PaceSummary = field(default_factory=PaceSummary)
    strategy: StrategyState = field(default_factory=StrategyState)
    minimap: MinimapState = field(default_factory=MinimapState)
    last_event_summary: str = ""
    ingest_stats: IngestStats = field(default_factory=IngestStats)
    last_update_iso: str = ""

    def touch(self) -> None:
        self.last_update_iso = datetime.now(timezone.utc).isoformat()
