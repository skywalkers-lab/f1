from dataclasses import dataclass, field
from datetime import datetime, timezone


@dataclass
class IngestStats:
    packets_received: int = 0
    packets_decoded: int = 0
    packets_dropped: int = 0
    duplicate_packets: int = 0
    decode_errors: int = 0
    out_of_order_packets: int = 0
    gaps_detected: int = 0
    max_gap_frames: int = 0
    interpolated_frames: int = 0
    last_packet_type: str = ""


@dataclass
class FeedHealthState:
    score: float = 100.0
    packet_loss_pct: float = 0.0
    avg_jitter_ms: float = 0.0
    max_jitter_ms: float = 0.0
    gap_rate: float = 0.0
    interpolation_pct: float = 0.0
    out_of_order_pct: float = 0.0
    uptime_s: float = 0.0


@dataclass
class StintSummary:
    stint_number: int = 0
    start_lap: int = 0
    end_lap: int = 0
    compound: str = "UNK"
    lap_count: int = 0
    avg_lap_ms: int = 0
    best_lap_ms: int = 0
    degradation_rate_ms_per_lap: float = 0.0
    total_wear_pct: float = 0.0
    initial_fuel_kg: float = 0.0
    final_fuel_kg: float = 0.0
    is_active: bool = True


@dataclass
class RaceAggregate:
    total_laps_completed: int = 0
    stints: list[StintSummary] = field(default_factory=list)
    fuel_delta_per_lap: float = 0.0
    best_lap_ms: int = 0
    best_lap_number: int = 0
    avg_pace_ms: int = 0
    pace_trend: str = "stable"
    total_pit_stops: int = 0
    safety_car_laps: int = 0
    vsc_laps: int = 0
    fuel_curve: list[dict] = field(default_factory=list)
    tyre_wear_curve: list[dict] = field(default_factory=list)
    lap_history: list[dict] = field(default_factory=list)


@dataclass
class SpectatorState:
    """Spectator / multi-client state."""
    focused_car_index: int = -1
    mode: str = "player"  # player | spectator
    available_drivers: list[dict] = field(default_factory=list)


@dataclass
class PlayerState:
    lap: int = 0
    position: int = 0
    tyre_compound: str = "UNKNOWN"
    fuel: float = 0.0
    ers: float = 0.0
    tyres_age_laps: int = 0
    speed: int = 0
    throttle: float = 0.0
    brake: float = 0.0
    gear: int = 0
    rpm: int = 0
    drs_enabled: bool = False
    brake_temps_c: list[int] = field(default_factory=lambda: [0, 0, 0, 0])
    tyre_surface_temps_c: list[int] = field(default_factory=lambda: [0, 0, 0, 0])
    tyre_inner_temps_c: list[int] = field(default_factory=lambda: [0, 0, 0, 0])
    engine_temp_c: int = 0
    time_penalties_s: int = 0
    total_warnings: int = 0
    corner_cut_warnings: int = 0
    last_lap_ms: int = 0
    current_lap_ms: int = 0
    fuel_delta_per_lap: float = 0.0
    front_wing_damage: int = 0


@dataclass
class CarRaceState:
    car_index: int
    position: int = 0
    current_lap: int = 0
    last_lap_ms: int = 0
    current_lap_ms: int = 0
    tyre_compound: str = "UNK"
    is_pitting: bool = False
    delta_to_front_ms: int = 0
    delta_to_leader_ms: int = 0
    penalties_s: int = 0
    total_warnings: int = 0
    corner_cut_warnings: int = 0
    tyres_age_laps: int = 0
    tyre_wear_pct: float = 0.0


@dataclass
class LeaderboardRow:
    position: int
    car_index: int
    driver_code: str
    gap_to_player_s: float
    tyre_compound: str
    is_pitting: bool
    last_lap_ms: int
    driver_name: str = ""
    stint_lap: int = 0
    tyre_wear_pct: float = 0.0


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
class StrategyCandidateState:
    action: str
    score: float
    reason: str


@dataclass
class StrategyState:
    action: str = "STAY_OUT"
    score: float = 0.0
    confidence: str = "low"
    reason: str = "No recommendation yet"
    key_inputs: dict = field(default_factory=dict)
    candidates: list[StrategyCandidateState] = field(default_factory=list)


@dataclass
class MinimapState:
    mode: str = "live_trace"
    player_car_index: int = 0
    cars: list[dict] = field(default_factory=list)
    track_trace: list[dict] = field(default_factory=list)
    transform: dict = field(
        default_factory=lambda: {"min_x": -1.0, "max_x": 1.0, "min_z": -1.0, "max_z": 1.0}
    )
    drs_zones: list[dict] = field(default_factory=list)


@dataclass
class AppState:
    session_uid: int = 0
    packet_format: int = 0
    packet_version: int = 0
    last_frame_identifier: int = 0
    session_type: str = "UNKNOWN"
    track: str = "UNKNOWN"
    weather_state: str = "WEATHER_0"
    total_laps: int = 0
    race_control_state: str = "GREEN"
    track_temp_c: int = 0
    air_temp_c: int = 0
    player_car_index: int = 0
    player: PlayerState = field(default_factory=PlayerState)
    cars: dict[int, CarRaceState] = field(default_factory=dict)
    driver_names: dict[int, str] = field(default_factory=dict)
    driver_codes: dict[int, str] = field(default_factory=dict)
    active_car_indices: list[int] = field(default_factory=list)
    leaderboard: list[LeaderboardRow] = field(default_factory=list)
    pace: PaceSummary = field(default_factory=PaceSummary)
    strategy: StrategyState = field(default_factory=StrategyState)
    minimap: MinimapState = field(default_factory=MinimapState)
    last_event_summary: str = ""
    ingest_stats: IngestStats = field(default_factory=IngestStats)
    feed_health: FeedHealthState = field(default_factory=FeedHealthState)
    race_aggregate: RaceAggregate = field(default_factory=RaceAggregate)
    spectator: SpectatorState = field(default_factory=SpectatorState)
    last_update_iso: str = ""

    def touch(self) -> None:
        self.last_update_iso = datetime.now(timezone.utc).isoformat()
