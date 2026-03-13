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


@dataclass(frozen=True)
class LapDataEntry:
    car_index: int
    current_lap_num: int
    car_position: int
    current_lap_time_ms: int
    last_lap_time_ms: int


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
    drs: int
    ers_store_energy: float


@dataclass(frozen=True)
class CarTelemetryPacket:
    player: CarTelemetryPlayer


@dataclass(frozen=True)
class CarStatusPlayer:
    fuel_in_tank: float
    ers_store_energy: float
    visual_tyre_compound: int


@dataclass(frozen=True)
class CarStatusPacket:
    player: CarStatusPlayer
