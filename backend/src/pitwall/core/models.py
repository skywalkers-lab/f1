"""
Unified Telemetry Domain Models — shared across HUD, Frontend, and Backend.

Inspired by pits-n-giggles' hf_types (high-frequency data structures) and
the shared state architecture between HUD overlays and web frontend.

Three-tier data model:
  Raw Packet → Domain Model (this file) → View Model (per consumer)
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum


# ── Enums ───────────────────────────────────────────────────────────────

class TyreCompound(str, Enum):
    SOFT = "SOFT"
    MEDIUM = "MEDIUM"
    HARD = "HARD"
    INTER = "INTER"
    WET = "WET"
    UNKNOWN = "UNKNOWN"

    @classmethod
    def from_visual(cls, visual_id: int) -> TyreCompound:
        _MAP = {16: cls.SOFT, 17: cls.MEDIUM, 18: cls.HARD, 7: cls.INTER, 8: cls.WET}
        return _MAP.get(visual_id, cls.UNKNOWN)


class DrsStatus(str, Enum):
    UNAVAILABLE = "UNAVAILABLE"
    AVAILABLE = "AVAILABLE"
    ACTIVE = "ACTIVE"


class RaceControlFlag(str, Enum):
    GREEN = "GREEN"
    YELLOW = "YELLOW"
    DOUBLE_YELLOW = "DOUBLE_YELLOW"
    RED = "RED"
    SC = "SC"
    VSC = "VSC"
    CHEQUERED = "CHEQUERED"


class SessionType(str, Enum):
    PRACTICE_1 = "FP1"
    PRACTICE_2 = "FP2"
    PRACTICE_3 = "FP3"
    QUALIFYING = "Q"
    SPRINT = "SPRINT"
    RACE = "RACE"
    TIME_TRIAL = "TT"
    UNKNOWN = "UNKNOWN"


class PitStatus(str, Enum):
    NONE = "NONE"
    PITTING = "PITTING"
    IN_PIT_AREA = "IN_PIT_AREA"


# ── Core Telemetry Data Models ──────────────────────────────────────────


@dataclass(slots=True)
class MotionData:
    """Per-car motion data at world coordinates (~20Hz)."""
    car_index: int = 0
    world_x: float = 0.0
    world_y: float = 0.0
    world_z: float = 0.0
    velocity_x: float = 0.0
    velocity_y: float = 0.0
    velocity_z: float = 0.0
    yaw: float = 0.0
    pitch: float = 0.0
    roll: float = 0.0
    speed_kph: float = 0.0
    heading_deg: float = 0.0


@dataclass(slots=True)
class MotionFrame:
    """A full frame of motion data for all cars."""
    frame_id: int = 0
    session_uid: int = 0
    timestamp_s: float = 0.0
    cars: list[MotionData] = field(default_factory=list)
    player_car_index: int = 0


@dataclass(slots=True)
class CarTelemetry:
    """Real-time car telemetry (speed, inputs, temps)."""
    car_index: int = 0
    speed_kph: int = 0
    throttle: float = 0.0
    brake: float = 0.0
    steer: float = 0.0
    gear: int = 0
    rpm: int = 0
    drs: DrsStatus = DrsStatus.UNAVAILABLE
    engine_temp_c: int = 0
    brake_temps_c: tuple[int, int, int, int] = (0, 0, 0, 0)
    tyre_surface_temps_c: tuple[int, int, int, int] = (0, 0, 0, 0)
    tyre_inner_temps_c: tuple[int, int, int, int] = (0, 0, 0, 0)
    tyre_pressures_psi: tuple[float, float, float, float] = (0.0, 0.0, 0.0, 0.0)


@dataclass(slots=True)
class InputTelemetry:
    """Extracted input channels for HUD overlay rendering."""
    throttle: float = 0.0
    brake: float = 0.0
    steer: float = 0.0
    speed_kph: int = 0
    gear: int = 0
    rpm: int = 0
    drs: DrsStatus = DrsStatus.UNAVAILABLE
    ers_deploy_pct: float = 0.0
    ers_harvest_pct: float = 0.0

    @classmethod
    def from_car_telemetry(cls, ct: CarTelemetry) -> InputTelemetry:
        return cls(
            throttle=ct.throttle,
            brake=ct.brake,
            steer=ct.steer,
            speed_kph=ct.speed_kph,
            gear=ct.gear,
            rpm=ct.rpm,
            drs=ct.drs,
        )


@dataclass(slots=True)
class LapData:
    """Per-car lap timing data."""
    car_index: int = 0
    position: int = 0
    current_lap: int = 0
    last_lap_ms: int = 0
    best_lap_ms: int = 0
    current_lap_ms: int = 0
    sector1_ms: int = 0
    sector2_ms: int = 0
    sector3_ms: int = 0
    delta_to_leader_ms: int = 0
    delta_to_front_ms: int = 0
    lap_distance: float = 0.0
    total_distance: float = 0.0
    pit_status: PitStatus = PitStatus.NONE
    penalties_s: int = 0
    total_warnings: int = 0
    corner_cut_warnings: int = 0


@dataclass(slots=True)
class CarStatus:
    """Car status data (fuel, ERS, tyres, flags)."""
    car_index: int = 0
    tyre_compound: TyreCompound = TyreCompound.UNKNOWN
    tyre_visual_compound: int = 0
    tyres_age_laps: int = 0
    fuel_kg: float = 0.0
    fuel_capacity_kg: float = 0.0
    ers_joules: float = 0.0
    ers_deploy_mode: int = 0
    ers_harvested_this_lap: float = 0.0
    ers_deployed_this_lap: float = 0.0
    drs_allowed: bool = False
    pit_limiter_on: bool = False
    vehicle_fia_flags: int = 0
    anti_lock_brakes: bool = False
    traction_control: int = 0


@dataclass(slots=True)
class CarDamage:
    """Per-car damage state."""
    car_index: int = 0
    front_wing_damage: int = 0
    rear_wing_damage: int = 0
    floor_damage: int = 0
    diffuser_damage: int = 0
    sidepod_damage: int = 0
    engine_damage: int = 0
    gearbox_damage: int = 0
    tyres_damage: tuple[int, int, int, int] = (0, 0, 0, 0)
    brakes_damage: tuple[int, int, int, int] = (0, 0, 0, 0)


@dataclass(slots=True)
class SessionHistoryEntry:
    """Per-lap timing from session history packet."""
    car_index: int = 0
    lap_number: int = 0
    lap_time_ms: int = 0
    sector1_ms: int = 0
    sector2_ms: int = 0
    sector3_ms: int = 0
    is_valid: bool = True


@dataclass(slots=True)
class WeatherForecast:
    """Weather forecast entry."""
    time_offset_minutes: int = 0
    weather_id: int = 0
    track_temp_c: int = 0
    air_temp_c: int = 0
    rain_probability: int = 0


# ── Composite Race State ────────────────────────────────────────────────


@dataclass
class RaceState:
    """
    Full race state snapshot — single source of truth.
    This is the Domain Model layer that both HUD and Frontend consume.
    """
    session_uid: int = 0
    session_type: SessionType = SessionType.UNKNOWN
    track_id: str = "UNKNOWN"
    track_name: str = ""
    total_laps: int = 0
    current_lap: int = 0

    # Flags & conditions
    race_control: RaceControlFlag = RaceControlFlag.GREEN
    weather_id: int = 0
    track_temp_c: int = 0
    air_temp_c: int = 0
    rain_pct: int = 0
    forecasts: list[WeatherForecast] = field(default_factory=list)

    # All cars
    motion: dict[int, MotionData] = field(default_factory=dict)
    telemetry: dict[int, CarTelemetry] = field(default_factory=dict)
    lap_data: dict[int, LapData] = field(default_factory=dict)
    car_status: dict[int, CarStatus] = field(default_factory=dict)
    car_damage: dict[int, CarDamage] = field(default_factory=dict)
    session_history: dict[int, list[SessionHistoryEntry]] = field(default_factory=dict)

    # Driver metadata
    driver_names: dict[int, str] = field(default_factory=dict)
    driver_codes: dict[int, str] = field(default_factory=dict)
    active_car_indices: list[int] = field(default_factory=list)
    player_car_index: int = 0

    # Events
    events: list[dict] = field(default_factory=list)
    last_event_summary: str = ""


# ── View Models (per-consumer projections of RaceState) ─────────────────

@dataclass(slots=True)
class HudViewModel:
    """Lightweight projection for the HUD overlay transport.
    Contains only the fields the HUD client needs at 30Hz."""
    speed: int = 0
    throttle: float = 0.0
    brake: float = 0.0
    steer: float = 0.0
    gear: int = 0
    rpm: int = 0
    drs: bool = False
    position: int = 0
    lap: int = 0
    total_laps: int = 0
    tyre_compound: str = ""
    tyre_wear_pct: float = 0.0
    fuel: float = 0.0
    ers: float = 0.0
    ers_deploy_mode: int = 0
    # Damage summary
    front_wing_damage: int = 0
    floor_damage: int = 0
    engine_damage: int = 0
    # Penalty
    corner_cut_warnings: int = 0
    time_penalties_s: int = 0

    def to_dict(self) -> dict:
        return {
            "type": "hud",
            "speed": self.speed,
            "throttle": self.throttle,
            "brake": self.brake,
            "steer": self.steer,
            "gear": self.gear,
            "rpm": self.rpm,
            "drs": self.drs,
            "position": self.position,
            "lap": self.lap,
            "total_laps": self.total_laps,
            "tyre_compound": self.tyre_compound,
            "tyre_wear_pct": self.tyre_wear_pct,
            "fuel": self.fuel,
            "ers": self.ers,
            "ers_deploy_mode": self.ers_deploy_mode,
            "front_wing_damage": self.front_wing_damage,
            "floor_damage": self.floor_damage,
            "engine_damage": self.engine_damage,
            "corner_cut_warnings": self.corner_cut_warnings,
            "time_penalties_s": self.time_penalties_s,
        }

    @classmethod
    def from_snapshot(cls, snapshot: dict) -> "HudViewModel":
        player = snapshot.get("player", {})
        return cls(
            speed=player.get("speed", 0),
            throttle=player.get("throttle", 0.0),
            brake=player.get("brake", 0.0),
            steer=player.get("steer", 0.0),
            gear=player.get("gear", 0),
            rpm=player.get("rpm", 0),
            drs=player.get("drs_enabled", False),
            position=player.get("position", 0),
            lap=player.get("lap", 0),
            total_laps=snapshot.get("total_laps", 0),
            tyre_compound=player.get("tyre_compound", ""),
            tyre_wear_pct=player.get("tyre_wear_pct", 0.0),
            fuel=player.get("fuel", 0.0),
            ers=player.get("ers", 0.0),
            ers_deploy_mode=player.get("ers_deploy_mode", 0),
            front_wing_damage=player.get("front_wing_damage", 0),
            floor_damage=player.get("floor_damage", 0),
            engine_damage=player.get("engine_damage", 0),
            corner_cut_warnings=player.get("corner_cut_warnings", 0),
            time_penalties_s=player.get("time_penalties_s", 0),
        )


@dataclass(slots=True)
class OverlayViewModel:
    """Compact projection for the OBS stream overlay at 20Hz.
    Only leaderboard subset + player essentials + race control."""
    player_speed: int = 0
    player_gear: int = 0
    player_throttle: float = 0.0
    player_brake: float = 0.0
    player_steer: float = 0.0
    player_rpm: int = 0
    player_drs: bool = False
    player_position: int = 0
    player_lap: int = 0
    player_tyre_compound: str = ""
    player_fuel: float = 0.0
    total_laps: int = 0
    race_control_state: str = "GREEN"
    weather_state: str = ""
    track: str = ""
    session_type: str = ""
    last_event_summary: str = ""
    leaderboard: list[dict] = field(default_factory=list)
    minimap_cars: list[dict] = field(default_factory=list)
    driver_codes: dict[int, str] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "type": "overlay",
            "player": {
                "speed": self.player_speed,
                "gear": self.player_gear,
                "throttle": self.player_throttle,
                "brake": self.player_brake,
                "steer": self.player_steer,
                "rpm": self.player_rpm,
                "drs": self.player_drs,
                "position": self.player_position,
                "lap": self.player_lap,
                "tyre_compound": self.player_tyre_compound,
                "fuel": self.player_fuel,
            },
            "leaderboard": self.leaderboard,
            "minimap": {"cars": self.minimap_cars},
            "race_control_state": self.race_control_state,
            "weather_state": self.weather_state,
            "total_laps": self.total_laps,
            "track": self.track,
            "session_type": self.session_type,
            "driver_codes": self.driver_codes,
            "last_event_summary": self.last_event_summary,
        }

    @classmethod
    def from_snapshot(cls, snapshot: dict) -> "OverlayViewModel":
        player = snapshot.get("player", {})
        minimap = snapshot.get("minimap", {})
        return cls(
            player_speed=player.get("speed", 0),
            player_gear=player.get("gear", 0),
            player_throttle=player.get("throttle", 0.0),
            player_brake=player.get("brake", 0.0),
            player_steer=player.get("steer", 0.0),
            player_rpm=player.get("rpm", 0),
            player_drs=player.get("drs_enabled", False),
            player_position=player.get("position", 0),
            player_lap=player.get("lap", 0),
            player_tyre_compound=player.get("tyre_compound", ""),
            player_fuel=player.get("fuel", 0.0),
            total_laps=snapshot.get("total_laps", 0),
            race_control_state=snapshot.get("race_control_state", "GREEN"),
            weather_state=snapshot.get("weather_state", ""),
            track=snapshot.get("track", ""),
            session_type=snapshot.get("session_type", ""),
            last_event_summary=snapshot.get("last_event_summary", ""),
            leaderboard=snapshot.get("leaderboard", []),
            minimap_cars=minimap.get("cars", []),
            driver_codes=snapshot.get("driver_codes", {}),
        )


# ── Event Bus Topic Constants ───────────────────────────────────────────

class Topics:
    """Standard event bus topic names."""
    # Raw packet topics (from UDP decoder)
    RAW_MOTION = "raw.motion"
    RAW_SESSION = "raw.session"
    RAW_LAP_DATA = "raw.lap_data"
    RAW_EVENT = "raw.event"
    RAW_PARTICIPANTS = "raw.participants"
    RAW_CAR_TELEMETRY = "raw.car_telemetry"
    RAW_CAR_STATUS = "raw.car_status"
    RAW_CAR_DAMAGE = "raw.car_damage"
    RAW_SESSION_HISTORY = "raw.session_history"

    # Domain model topics (processed)
    STATE_SNAPSHOT = "state.snapshot"
    STATE_LEADERBOARD = "state.leaderboard"
    STATE_STRATEGY = "state.strategy"
    STATE_PACE = "state.pace"
    STATE_MINIMAP = "state.minimap"
    STATE_PLAYER = "state.player"

    # HUD topics
    HUD_UPDATE = "hud.update"
    HUD_OVERLAY_DATA = "hud.overlay"
    HUD_DAMAGE = "hud.damage"
    HUD_PIT_DECISION = "hud.pit_decision"
    HUD_PENALTY = "hud.penalty"
    HUD_RIVAL_WEAR = "hud.rival_wear"

    # Frontend topics
    FRONTEND_RACE_TABLE = "frontend.race_table"
    FRONTEND_STREAM_OVERLAY = "frontend.stream_overlay"

    # System topics
    SESSION_START = "session.start"
    SESSION_END = "session.end"
    SESSION_LAP_CHANGE = "session.lap_change"
    SESSION_PIT_STOP = "session.pit_stop"
    SESSION_SAFETY_CAR = "session.safety_car"

    # Wildcard patterns
    ALL_RAW = "raw.*"
    ALL_STATE = "state.*"
    ALL_HUD = "hud.*"
    ALL_FRONTEND = "frontend.*"
    ALL_SESSION = "session.*"
