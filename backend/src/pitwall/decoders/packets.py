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


# ── F1 25 UDP specification record sizes (EA Sports) ──────────────────────────
# CarMotionData   : 6×f32 + 6×i16 + 6×f32 = 60 bytes
# LapData         : 57 bytes (same layout as F1 24)
# CarTelemetryData: u16 + 3×f32 + u8 + i8 + u16 + u8 + ... = 60 bytes total
# CarStatusData   : 5×u8 + 3×f32 + ... = 55 bytes total
CAR_COUNT = 22
MOTION_CAR_RECORD_SIZE = 60
LAP_DATA_CAR_RECORD_SIZE = 57
CAR_TELEMETRY_CAR_RECORD_SIZE = 60
CAR_STATUS_CAR_RECORD_SIZE = 55
COMPACT_MOTION_CAR_RECORD_SIZE = Struct("<fff").size
COMPACT_LAP_DATA_CAR_RECORD_SIZE = Struct("<IIHBBB").size
COMPACT_CAR_STATUS_RECORD_SIZE = Struct("<fBff").size + 1

# Field offsets within LapData
_LAP_TIMES_OFFSET = 0   # lastLapTimeInMS(u32) + currentLapTimeInMS(u32)
_LAP_POS_OFFSET = 32    # carPosition(u8) + currentLapNum(u8)

# Field offsets within CarStatusData
_CAR_STATUS_FUEL_OFFSET = 5       # m_fuelInTank: float
_CAR_STATUS_ERS_OFFSET = 37       # m_ersStoreEnergy: float
_CAR_STATUS_VIS_TYRE_OFFSET = 26  # m_visualTyreCompound: uint8

MOTION_PLAYER_STRUCT = Struct("<fff")      # worldPositionX, worldPositionY, worldPositionZ
SESSION_STRUCT = Struct("<BBBBB")          # weather, trackTemp, airTemp, totalLaps, trackId
LAP_TIMES_STRUCT = Struct("<II")           # lastLapTimeInMS, currentLapTimeInMS
LAP_POS_STRUCT = Struct("<BB")             # carPosition, currentLapNum
EVENT_STRUCT = Struct("<4s")
# speed(u16) throttle(f) steer(f) brake(f) clutch(u8) gear(i8) engineRPM(u16) drs(u8)
CAR_TELEMETRY_PLAYER_STRUCT = Struct("<HfffBbHB")
_CAR_STATUS_FUEL_STRUCT = Struct("<f")
_CAR_STATUS_ERS_STRUCT = Struct("<f")


def _resolve_record_size(data: bytes, offset: int, full_size: int, compact_size: int) -> int:
    payload_size = len(data) - offset
    if payload_size >= full_size * CAR_COUNT:
        return full_size
    if payload_size >= compact_size * CAR_COUNT:
        return compact_size
    raise PacketDecodeError(
        f"truncated packet: expected {compact_size * CAR_COUNT} or {full_size * CAR_COUNT} bytes got {len(data)}"
    )


def _ensure_size(data: bytes, needed: int) -> None:
    if len(data) < needed:
        raise PacketDecodeError(f"truncated packet: expected {needed} bytes got {len(data)}")


def _ensure_range(name: str, value: int | float, minimum: int | float, maximum: int | float) -> None:
    if value < minimum or value > maximum:
        raise PacketDecodeError(f"range_error:{name}={value} expected {minimum}..{maximum}")


def decode_motion(data: bytes) -> DecodedPacket:
    offset = HEADER_STRUCT.size
    record_size = _resolve_record_size(
        data,
        offset,
        MOTION_CAR_RECORD_SIZE,
        COMPACT_MOTION_CAR_RECORD_SIZE,
    )
    cars: list[CarMotionData] = []
    for car_index in range(CAR_COUNT):
        car_offset = offset + (car_index * record_size)
        world_x, _world_y, world_z = MOTION_PLAYER_STRUCT.unpack_from(data, car_offset)
        _ensure_range("world_x", world_x, -10000.0, 10000.0)
        _ensure_range("world_z", world_z, -10000.0, 10000.0)
        cars.append(CarMotionData(car_index=car_index, world_position_x=world_x, world_position_z=world_z))
    return DecodedPacket(kind="motion", payload=MotionPacket(cars=cars))


def decode_session(data: bytes) -> DecodedPacket:
    offset = HEADER_STRUCT.size
    _ensure_size(data, offset + SESSION_STRUCT.size + 4)
    weather, _track_temp, _air_temp, total_laps, track_id = SESSION_STRUCT.unpack_from(data, offset)
    session_type = data[offset + SESSION_STRUCT.size]
    safety_car_status = data[offset + SESSION_STRUCT.size + 2]
    _ensure_range("weather", weather, 0, 7)
    _ensure_range("total_laps", total_laps, 0, 255)
    _ensure_range("session_type", session_type, 0, 13)
    _ensure_range("safety_car_status", safety_car_status, 0, 3)
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
    record_size = _resolve_record_size(
        data,
        offset,
        LAP_DATA_CAR_RECORD_SIZE,
        COMPACT_LAP_DATA_CAR_RECORD_SIZE,
    )
    cars: list[LapDataEntry] = []
    for car_index in range(CAR_COUNT):
        car_base = offset + (car_index * record_size)
        if record_size == COMPACT_LAP_DATA_CAR_RECORD_SIZE:
            last_lap_ms, current_lap_ms, _sector, car_position, current_lap_num, _pit_status = Struct("<IIHBBB").unpack_from(
                data, car_base
            )
        else:
            last_lap_ms, current_lap_ms = LAP_TIMES_STRUCT.unpack_from(data, car_base + _LAP_TIMES_OFFSET)
            car_position, current_lap_num = LAP_POS_STRUCT.unpack_from(data, car_base + _LAP_POS_OFFSET)
        _ensure_range("car_position", car_position, 0, CAR_COUNT)
        _ensure_range("current_lap_num", current_lap_num, 0, 255)
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
    offset = HEADER_STRUCT.size + (CAR_TELEMETRY_CAR_RECORD_SIZE * player_index)  # stride = 60 bytes
    _ensure_size(data, offset + CAR_TELEMETRY_PLAYER_STRUCT.size)
    speed, throttle, _steer, brake, _clutch, gear, rpm, drs = CAR_TELEMETRY_PLAYER_STRUCT.unpack_from(data, offset)
    _ensure_range("speed", speed, 0, 450)
    _ensure_range("throttle", throttle, 0.0, 1.0)
    _ensure_range("brake", brake, 0.0, 1.0)
    payload = CarTelemetryPacket(
        player=CarTelemetryPlayer(
            speed=speed,
            throttle=throttle,
            brake=brake,
            gear=gear,
            rpm=rpm,
            drs=drs,
            ers_store_energy=0.0,
        )
    )
    return DecodedPacket(kind="car_telemetry", payload=payload)


def decode_car_status(data: bytes, player_index: int) -> DecodedPacket:
    offset = HEADER_STRUCT.size
    payload_size = len(data) - offset
    if payload_size >= CAR_STATUS_CAR_RECORD_SIZE * CAR_COUNT:
        record_start = offset + (CAR_STATUS_CAR_RECORD_SIZE * player_index)
        _ensure_size(data, record_start + CAR_STATUS_CAR_RECORD_SIZE)
        (fuel_in_tank,) = _CAR_STATUS_FUEL_STRUCT.unpack_from(data, record_start + _CAR_STATUS_FUEL_OFFSET)
        (ers_store_energy,) = _CAR_STATUS_ERS_STRUCT.unpack_from(data, record_start + _CAR_STATUS_ERS_OFFSET)
        visual_tyre_compound = data[record_start + _CAR_STATUS_VIS_TYRE_OFFSET]
    else:
        _ensure_size(data, offset + COMPACT_CAR_STATUS_RECORD_SIZE)
        fuel_in_tank, _pit_limiter_status, _fuel_capacity, ers_store_energy = Struct("<fBff").unpack_from(data, offset)
        visual_tyre_compound = data[offset + Struct("<fBff").size]
    _ensure_range("fuel_in_tank", fuel_in_tank, 0.0, 120.0)
    _ensure_range("ers_store_energy", ers_store_energy, 0.0, 5_000_000.0)
    payload = CarStatusPacket(
        player=CarStatusPlayer(
            fuel_in_tank=fuel_in_tank,
            ers_store_energy=ers_store_energy,
            visual_tyre_compound=visual_tyre_compound,
        )
    )
    return DecodedPacket(kind="car_status", payload=payload)
