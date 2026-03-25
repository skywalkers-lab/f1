from dataclasses import dataclass
from enum import IntEnum


class PacketId(IntEnum):
    MOTION = 0
    SESSION = 1
    LAP_DATA = 2
    EVENT = 3
    PARTICIPANTS = 4
    CAR_SETUPS = 5
    CAR_TELEMETRY = 6
    CAR_STATUS = 7
    FINAL_CLASSIFICATION = 8
    LOBBY_INFO = 9
    CAR_DAMAGE = 10
    SESSION_HISTORY = 11


@dataclass(frozen=True)
class PacketHeader:
    packet_format: int
    game_year: int
    game_major_version: int
    game_minor_version: int
    packet_version: int
    packet_id: int
    session_uid: int
    session_time: float
    frame_identifier: int
    overall_frame_identifier: int
    player_car_index: int
    secondary_player_car_index: int


@dataclass(frozen=True)
class CarMotionData:
    car_index: int
    world_position_x: float
    world_position_z: float


@dataclass(frozen=True)
class MotionPacket:
    cars: list[CarMotionData]


@dataclass(frozen=True)
class SessionPacket:
    session_type: int
    track_id: int
    weather: int
    safety_car_status: int
    total_laps: int
    track_temp_c: int = 0
    air_temp_c: int = 0


@dataclass(frozen=True)
class LapDataEntry:
    car_index: int
    current_lap_num: int
    car_position: int
    current_lap_time_ms: int
    last_lap_time_ms: int
    pit_status: int = 0
    delta_to_car_in_front_ms: int = 0
    delta_to_race_leader_ms: int = 0
    penalties: int = 0
    total_warnings: int = 0
    corner_cut_warnings: int = 0


@dataclass(frozen=True)
class LapDataPacket:
    cars: list[LapDataEntry]


@dataclass(frozen=True)
class EventPacket:
    event_code: str


@dataclass(frozen=True)
class CarTelemetryPlayer:
    speed: int
    throttle: float
    brake: float
    gear: int
    rpm: int
    drs: int
    ers_store_energy: float
    brake_temps_c: tuple[int, int, int, int] = (0, 0, 0, 0)
    tyre_surface_temps_c: tuple[int, int, int, int] = (0, 0, 0, 0)
    tyre_inner_temps_c: tuple[int, int, int, int] = (0, 0, 0, 0)
    engine_temp_c: int = 0


@dataclass(frozen=True)
class CarTelemetryPacket:
    player_index: int
    player: CarTelemetryPlayer


@dataclass(frozen=True)
class CarStatusPlayer:
    fuel_in_tank: float
    ers_store_energy: float
    visual_tyre_compound: int
    tyres_age_laps: int = 0


@dataclass(frozen=True)
class CarStatusPacket:
    player_index: int
    player: CarStatusPlayer


@dataclass(frozen=True)
class ParticipantEntry:
    car_index: int
    name: str


@dataclass(frozen=True)
class ParticipantsPacket:
    num_active_cars: int
    entries: list[ParticipantEntry]


@dataclass(frozen=True)
class CarDamageEntry:
    car_index: int
    tyres_damage: tuple[int, int, int, int]  # structural damage %
    brakes_damage: tuple[int, int, int, int]


@dataclass(frozen=True)
class CarDamagePacket:
    cars: list[CarDamageEntry]


@dataclass(frozen=True)
class LapHistoryData:
    lap_time_ms: int
    sector1_time_ms: int
    sector2_time_ms: int
    sector3_time_ms: int
    lap_valid_bit_flags: int


@dataclass(frozen=True)
class SessionHistoryPacket:
    car_index: int
    num_laps: int
    best_lap_time_index: int
    best_sector1_index: int
    best_sector2_index: int
    best_sector3_index: int
    lap_history: list[LapHistoryData]
