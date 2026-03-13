from dataclasses import dataclass
from struct import Struct
from pitwall.decoders.header import HEADER_STRUCT, PacketDecodeError
from pitwall.decoders.models import (
    CarMotionData,
    CarStatusPacket,
    CarStatusPlayer,
    CarTelemetryPacket,
    CarTelemetryPlayer,
    EventPacket,
    LapDataEntry,
    LapDataPacket,
    MotionPacket,
    SessionPacket,
)


@dataclass(frozen=True)
class DecodedPacket:
    kind: str
    payload: object


# SPEC ASSUMPTION: subset offsets are aligned with F1 24 UDP spec. TODO: verify against official F1 25 docs.
CAR_COUNT = 22
MOTION_PLAYER_STRUCT = Struct("<fff")  # worldPositionX, worldPositionY, worldPositionZ
SESSION_STRUCT = Struct("<BBBBB")  # weather, trackTemp, airTemp, totalLaps, trackId
LAP_PLAYER_STRUCT = Struct("<IIHBBB")  # lastLapTimeMs, currentLapTimeMs, sector1PartMs, carPosition, currentLap, _unused
EVENT_STRUCT = Struct("<4s")
CAR_TELEMETRY_PLAYER_STRUCT = Struct("<HfffBb")  # speed, throttle, steer, brake, clutch, drs
CAR_STATUS_PLAYER_STRUCT = Struct("<fBff")  # fuelInTank, fuelMix, fuelLap, ersStoreEnergy


def _ensure_size(data: bytes, needed: int) -> None:
    if len(data) < needed:
        raise PacketDecodeError(f"truncated packet: expected {needed} bytes got {len(data)}")


def decode_motion(data: bytes) -> DecodedPacket:
    offset = HEADER_STRUCT.size
    _ensure_size(data, offset + (MOTION_PLAYER_STRUCT.size * CAR_COUNT))
    cars: list[CarMotionData] = []
    for car_index in range(CAR_COUNT):
        car_offset = offset + (car_index * MOTION_PLAYER_STRUCT.size)
        world_x, _world_y, world_z = MOTION_PLAYER_STRUCT.unpack_from(data, car_offset)
        cars.append(
            CarMotionData(car_index=car_index, world_position_x=world_x, world_position_z=world_z)
        )
    return DecodedPacket(kind="motion", payload=MotionPacket(cars=cars))


def decode_session(data: bytes) -> DecodedPacket:
    offset = HEADER_STRUCT.size
    _ensure_size(data, offset + SESSION_STRUCT.size + 4)
    weather, _track_temp, _air_temp, total_laps, track_id = SESSION_STRUCT.unpack_from(data, offset)
    session_type = data[offset + SESSION_STRUCT.size]
    safety_car_status = data[offset + SESSION_STRUCT.size + 2]
    payload = SessionPacket(
        session_type=session_type,
        track_id=track_id,
        weather=weather,
        safety_car_status=safety_car_status,
        total_laps=total_laps,
    )
    return DecodedPacket(kind="session", payload=payload)


def decode_lap_data(data: bytes) -> DecodedPacket:
    offset = HEADER_STRUCT.size
    _ensure_size(data, offset + LAP_PLAYER_STRUCT.size * CAR_COUNT)
    cars: list[LapDataEntry] = []
    for car_index in range(CAR_COUNT):
        car_offset = offset + (LAP_PLAYER_STRUCT.size * car_index)
        last_lap_ms, current_lap_ms, _sector1, car_position, current_lap_num, _unused = LAP_PLAYER_STRUCT.unpack_from(
            data, car_offset
        )
        cars.append(
            LapDataEntry(
                car_index=car_index,
                current_lap_num=current_lap_num,
                car_position=car_position,
                current_lap_time_ms=current_lap_ms,
                last_lap_time_ms=last_lap_ms,
            )
        )
    return DecodedPacket(kind="lap_data", payload=LapDataPacket(cars=cars))


def decode_event(data: bytes) -> DecodedPacket:
    offset = HEADER_STRUCT.size
    _ensure_size(data, offset + EVENT_STRUCT.size)
    (event_raw,) = EVENT_STRUCT.unpack_from(data, offset)
    payload = EventPacket(event_code=event_raw.decode("ascii", errors="ignore").strip("\x00"))
    return DecodedPacket(kind="event", payload=payload)


def decode_car_telemetry(data: bytes, player_index: int) -> DecodedPacket:
    offset = HEADER_STRUCT.size + (CAR_TELEMETRY_PLAYER_STRUCT.size * player_index)
    _ensure_size(data, offset + CAR_TELEMETRY_PLAYER_STRUCT.size)
    speed, throttle, _steer, _brake, _clutch, drs = CAR_TELEMETRY_PLAYER_STRUCT.unpack_from(data, offset)
    payload = CarTelemetryPacket(
        player=CarTelemetryPlayer(speed=speed, throttle=throttle, drs=drs, ers_store_energy=0.0)
    )
    return DecodedPacket(kind="car_telemetry", payload=payload)


def decode_car_status(data: bytes, player_index: int) -> DecodedPacket:
    offset = HEADER_STRUCT.size + (CAR_STATUS_PLAYER_STRUCT.size * player_index)
    _ensure_size(data, offset + CAR_STATUS_PLAYER_STRUCT.size + 1)
    fuel_in_tank, _fuel_mix, _fuel_lap, ers_store_energy = CAR_STATUS_PLAYER_STRUCT.unpack_from(data, offset)
    visual_tyre_compound = data[offset + CAR_STATUS_PLAYER_STRUCT.size]
    payload = CarStatusPacket(
        player=CarStatusPlayer(
            fuel_in_tank=fuel_in_tank,
            ers_store_energy=ers_store_energy,
            visual_tyre_compound=visual_tyre_compound,
        )
    )
    return DecodedPacket(kind="car_status", payload=payload)
