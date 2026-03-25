from dataclasses import dataclass
from struct import Struct
from pitwall.decoders.header import HEADER_STRUCT, PacketDecodeError
from pitwall.decoders.models import (
    CarDamageEntry,
    CarDamagePacket,
    CarMotionData,
    CarStatusPacket,
    CarStatusPlayer,
    CarTelemetryPacket,
    CarTelemetryPlayer,
    EventPacket,
    LapDataEntry,
    LapDataPacket,
    LapHistoryData,
    MotionPacket,
    ParticipantEntry,
    ParticipantsPacket,
    SessionHistoryPacket,
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
PARTICIPANT_RECORD_MIN_SIZE = 55
PARTICIPANT_NAME_OFFSET = 7
PARTICIPANT_NAME_MAX_LEN = 48
COMPACT_MOTION_CAR_RECORD_SIZE = Struct("<fff").size
COMPACT_LAP_DATA_CAR_RECORD_SIZE = Struct("<IIHBBB").size
COMPACT_CAR_STATUS_RECORD_SIZE = Struct("<fBff").size + 1

# F1 25 SESSION packet layout (full mode, relative to payload start):
# +0:  weather (u8)
# +1:  trackTemperature (i8)
# +2:  airTemperature (i8)
# +3:  totalLaps (u8)
# +4:  trackLength (u16 LE) - 2 bytes
# +6:  sessionType (u8)
# +7:  trackId (i8)
# ...
# +45: safetyCarStatus (u8)
_SESSION_FULL_SAFETY_CAR_OFFSET = 45
_SESSION_FULL_TRACK_TEMP_OFFSET = 1
_SESSION_FULL_AIR_TEMP_OFFSET = 2
_SESSION_TEMP_STRUCT = Struct("<bb")  # trackTemp(i8), airTemp(i8)

# F1 25 CAR_DAMAGE packet: 22 cars × CAR_DAMAGE_RECORD_SIZE bytes
# Per-car record: tyresDamage[4](u8) + brakesDamage[4](u8) + 12×u8 wing/floor/etc = 20 bytes
CAR_DAMAGE_RECORD_SIZE = 20
_CAR_DAMAGE_STRUCT = Struct("<4B4B")  # tyresDamage[4], brakesDamage[4]

# F1 25 SESSION_HISTORY packet:
# +0: carIdx (u8)
# +1: numLaps (u8)
# +2: numTyreStints (u8)
# +3: bestLapTimeLapNum (u8)
# +4: bestSector1LapNum (u8)
# +5: bestSector2LapNum (u8)
# +6: bestSector3LapNum (u8)
# +7: lapHistoryData[100] × 11 bytes each
# Per lap: lapTimeInMS(u32) + sector1InMS(u16) + sector2InMS(u16) + sector3InMS(u16) + lapValidBitFlags(u8) = 11 bytes
_SESSION_HISTORY_HEADER_STRUCT = Struct("<BBBBBBB")
_LAP_HISTORY_STRUCT = Struct("<IHHH B")  # lapTimeMs, s1Ms(u16), s2Ms(u16), s3Ms(u16), flags(u8)
_LAP_HISTORY_RECORD_SIZE = _LAP_HISTORY_STRUCT.size
_LAP_TIMES_OFFSET = 0             # lastLapTimeInMS(u32) + currentLapTimeInMS(u32)
_LAP_DELTA_FRONT_OFFSET = 14      # deltaToCarInFrontInMS(u16)
_LAP_DELTA_LEADER_OFFSET = 16     # deltaToRaceLeaderInMS(u16)
_LAP_POS_OFFSET = 30              # carPosition(u8) + currentLapNum(u8)
_LAP_PIT_STATUS_OFFSET = 32       # pitStatus(u8)
_LAP_PENALTIES_OFFSET = 36        # penalties(u8)
_LAP_TOTAL_WARNINGS_OFFSET = 37   # totalWarnings(u8)
_LAP_CORNER_CUT_WARNINGS_OFFSET = 38

# Field offsets within CarStatusData
_CAR_STATUS_FUEL_OFFSET = 5       # m_fuelInTank: float
_CAR_STATUS_VIS_TYRE_OFFSET = 26  # m_visualTyreCompound: uint8
_CAR_STATUS_ERS_OFFSET = 37       # m_ersStoreEnergy: float
_CAR_STATUS_TYRES_AGE_OFFSET = 52 # m_tyresAgeLaps: uint8

MOTION_PLAYER_STRUCT = Struct("<fff")      # worldPositionX, worldPositionY, worldPositionZ
SESSION_STRUCT = Struct("<BBBBB")          # weather, trackTemp, airTemp, totalLaps, trackId
LAP_TIMES_STRUCT = Struct("<II")           # lastLapTimeInMS, currentLapTimeInMS
LAP_DELTA_STRUCT = Struct("<HH")           # delta to front/leader in ms
LAP_POS_STRUCT = Struct("<BB")             # carPosition, currentLapNum
EVENT_STRUCT = Struct("<4s")
# speed(u16) throttle(f) steer(f) brake(f) clutch(u8) gear(i8) engineRPM(u16) drs(u8)
CAR_TELEMETRY_PLAYER_STRUCT = Struct("<HfffBbHB")
CAR_TELEMETRY_TEMPS_STRUCT = Struct("<4H4B4BH")
_CAR_STATUS_FUEL_STRUCT = Struct("<f")
_CAR_STATUS_ERS_STRUCT = Struct("<f")

_LAST_TELEMETRY_INDEX = 0
_LAST_STATUS_INDEX = 0


def _clean_driver_name(raw: bytes) -> str:
    text = raw.split(b"\x00", 1)[0].decode("utf-8", errors="ignore").strip()
    if not text:
        return ""
    # Keep visible ASCII-ish characters and common separators used in gamer tags.
    return "".join(ch for ch in text if ch.isalnum() or ch in (" ", "_", "-", ".")).strip()


def _safe_player_index(player_index: int) -> int:
    if 0 <= player_index < CAR_COUNT:
        return player_index
    return 0


def _is_valid_player_index(player_index: int) -> bool:
    return 0 <= player_index < CAR_COUNT


def _select_telemetry_player_index(data: bytes) -> int:
    global _LAST_TELEMETRY_INDEX
    offset = HEADER_STRUCT.size
    best_index = 0
    best_score = float("-inf")
    previous_score = float("-inf")
    for idx in range(CAR_COUNT):
        car_offset = offset + (CAR_TELEMETRY_CAR_RECORD_SIZE * idx)
        if len(data) < car_offset + CAR_TELEMETRY_PLAYER_STRUCT.size:
            continue
        speed, throttle, _steer, brake, _clutch, _gear, rpm, drs = CAR_TELEMETRY_PLAYER_STRUCT.unpack_from(data, car_offset)
        if speed < 0 or speed > 450:
            continue
        score = float(speed) + max(0.0, min(1.0, throttle)) * 120.0 + float(rpm) / 2000.0 - max(0.0, min(1.0, brake)) * 20.0 + (6.0 if drs > 0 else 0.0)
        if score > best_score:
            best_score = score
            best_index = idx
        if idx == _LAST_TELEMETRY_INDEX:
            previous_score = score

    # Keep previous selection unless a new candidate is clearly better.
    if previous_score > float("-inf") and best_score - previous_score < 35.0:
        return _LAST_TELEMETRY_INDEX

    _LAST_TELEMETRY_INDEX = best_index
    return best_index


def _select_status_player_index(data: bytes) -> int:
    global _LAST_STATUS_INDEX
    offset = HEADER_STRUCT.size
    payload_size = len(data) - offset
    if payload_size < CAR_STATUS_CAR_RECORD_SIZE * CAR_COUNT:
        return 0

    best_index = 0
    best_score = float("-inf")
    previous_score = float("-inf")
    for idx in range(CAR_COUNT):
        record_start = offset + (CAR_STATUS_CAR_RECORD_SIZE * idx)
        fuel = _CAR_STATUS_FUEL_STRUCT.unpack_from(data, record_start + _CAR_STATUS_FUEL_OFFSET)[0]
        ers = _CAR_STATUS_ERS_STRUCT.unpack_from(data, record_start + _CAR_STATUS_ERS_OFFSET)[0]
        tyre = data[record_start + _CAR_STATUS_VIS_TYRE_OFFSET]
        if fuel < 0.0 or fuel > 120.0:
            continue
        if ers < 0.0 or ers > 5_000_000.0:
            continue
        score = ers / 250_000.0 + fuel * 0.2 + (5.0 if 0 < tyre < 30 else 0.0)
        if score > best_score:
            best_score = score
            best_index = idx
        if idx == _LAST_STATUS_INDEX:
            previous_score = score

    if previous_score > float("-inf") and best_score - previous_score < 2.0:
        return _LAST_STATUS_INDEX

    _LAST_STATUS_INDEX = best_index
    return best_index


def _resolve_record_size(data: bytes, offset: int, full_size: int, compact_size: int) -> int:
    payload_size = len(data) - offset
    if payload_size >= full_size * CAR_COUNT:
        return full_size
    # F1 25 observer packets can shrink per-car records while still keeping one row per car.
    derived_size = payload_size // CAR_COUNT
    if payload_size % CAR_COUNT == 0 and derived_size >= compact_size:
        return derived_size
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
    payload_size = len(data) - offset
    _ensure_size(data, offset + SESSION_STRUCT.size + 4)

    weather, _track_temp_raw, _air_temp_raw, total_laps, _track_id_raw = SESSION_STRUCT.unpack_from(data, offset)

    # Two compatible layouts are observed in this project:
    # - compact custom payload (tests/sender): session_type at +5, track_id at +4
    # - official F1 packet: session_type at +6, track_id at +7 (signed int8)
    if payload_size <= 16:
        session_type = data[offset + 5]
        track_id = data[offset + 4]
        safety_car_status = data[offset + 7] if payload_size > 7 else 0
        track_temp_c = 0
        air_temp_c = 0
    else:
        session_type = data[offset + 6]
        track_id_raw = Struct("<b").unpack_from(data, offset + 7)[0]
        track_id = int(track_id_raw)
        # Track and air temperature are i8 fields at +1 and +2
        track_temp_c, air_temp_c = _SESSION_TEMP_STRUCT.unpack_from(data, offset + _SESSION_FULL_TRACK_TEMP_OFFSET)
        # Safety car status is at +45 in the full F1 25 packet layout
        safety_car_status = data[offset + _SESSION_FULL_SAFETY_CAR_OFFSET] if payload_size > _SESSION_FULL_SAFETY_CAR_OFFSET else 0

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
        track_temp_c=int(track_temp_c),
        air_temp_c=int(air_temp_c),
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
        pit_status = 0
        delta_front_ms = 0
        delta_leader_ms = 0
        penalties = 0
        total_warnings = 0
        corner_cut_warnings = 0

        if record_size == COMPACT_LAP_DATA_CAR_RECORD_SIZE:
            last_lap_ms, current_lap_ms, _sector, car_position, current_lap_num, pit_status = Struct("<IIHBBB").unpack_from(
                data, car_base
            )
        else:
            last_lap_ms, current_lap_ms = LAP_TIMES_STRUCT.unpack_from(data, car_base + _LAP_TIMES_OFFSET)
            delta_front_ms, delta_leader_ms = LAP_DELTA_STRUCT.unpack_from(data, car_base + _LAP_DELTA_FRONT_OFFSET)

            # Compatibility: most captures place car position/current lap at +32/+33.
            # Keep +30/+31 as fallback only.
            pos_30, lap_31 = LAP_POS_STRUCT.unpack_from(data, car_base + _LAP_POS_OFFSET)
            pos_32, lap_33 = LAP_POS_STRUCT.unpack_from(data, car_base + 32)
            if 1 <= pos_32 <= CAR_COUNT and lap_33 > 0:
                car_position, current_lap_num = pos_32, lap_33
            elif 1 <= pos_30 <= CAR_COUNT and lap_31 > 0:
                car_position, current_lap_num = pos_30, lap_31
            else:
                car_position, current_lap_num = pos_32, lap_33

            pit_status = data[car_base + _LAP_PIT_STATUS_OFFSET]
            penalties = data[car_base + _LAP_PENALTIES_OFFSET]
            total_warnings = data[car_base + _LAP_TOTAL_WARNINGS_OFFSET]
            corner_cut_warnings = data[car_base + _LAP_CORNER_CUT_WARNINGS_OFFSET]

        _ensure_range("car_position", car_position, 0, CAR_COUNT)
        _ensure_range("current_lap_num", current_lap_num, 0, 255)
        cars.append(
            LapDataEntry(
                car_index=car_index,
                current_lap_num=current_lap_num,
                car_position=car_position,
                current_lap_time_ms=current_lap_ms,
                last_lap_time_ms=last_lap_ms,
                pit_status=pit_status,
                delta_to_car_in_front_ms=delta_front_ms,
                delta_to_race_leader_ms=delta_leader_ms,
                penalties=penalties,
                total_warnings=total_warnings,
                corner_cut_warnings=corner_cut_warnings,
            )
        )
    return DecodedPacket(kind="lap_data", payload=LapDataPacket(cars=cars))


def decode_event(data: bytes) -> DecodedPacket:
    offset = HEADER_STRUCT.size
    _ensure_size(data, offset + EVENT_STRUCT.size)
    (event_raw,) = EVENT_STRUCT.unpack_from(data, offset)
    payload = EventPacket(event_code=event_raw.decode("ascii", errors="ignore").strip("\x00"))
    return DecodedPacket(kind="event", payload=payload)


def decode_participants(data: bytes) -> DecodedPacket:
    offset = HEADER_STRUCT.size
    payload_size = len(data) - offset

    if payload_size <= 0:
        raise PacketDecodeError(f"truncated packet: expected participant payload got {len(data)}")

    participant_offset = offset
    num_active_cars = CAR_COUNT
    if payload_size >= 1 + (CAR_COUNT * PARTICIPANT_RECORD_MIN_SIZE) and (payload_size - 1) % CAR_COUNT == 0:
        # F1 packet starts with m_numActiveCars (u8)
        num_active_cars = max(0, min(CAR_COUNT, int(data[offset])))
        participant_offset = offset + 1
        payload_size -= 1

    if payload_size % CAR_COUNT != 0:
        raise PacketDecodeError(
            f"truncated packet: participant payload {payload_size} is not divisible by {CAR_COUNT}"
        )

    record_size = payload_size // CAR_COUNT
    if record_size < PARTICIPANT_RECORD_MIN_SIZE:
        raise PacketDecodeError(
            f"truncated packet: participant record size {record_size} < {PARTICIPANT_RECORD_MIN_SIZE}"
        )

    entries: list[ParticipantEntry] = []
    for car_index in range(CAR_COUNT):
        record_start = participant_offset + (car_index * record_size)
        name_start = record_start + PARTICIPANT_NAME_OFFSET
        name_end = min(record_start + record_size, name_start + PARTICIPANT_NAME_MAX_LEN)
        if name_start >= len(data):
            continue
        name = _clean_driver_name(data[name_start:name_end])
        entries.append(ParticipantEntry(car_index=car_index, name=name))

    return DecodedPacket(
        kind="participants",
        payload=ParticipantsPacket(num_active_cars=num_active_cars, entries=entries),
    )


def decode_car_telemetry(data: bytes, player_index: int) -> DecodedPacket:
    if not _is_valid_player_index(player_index):
        player_index = _select_telemetry_player_index(data)
    else:
        player_index = _safe_player_index(player_index)
    offset = HEADER_STRUCT.size + (CAR_TELEMETRY_CAR_RECORD_SIZE * player_index)  # stride = 60 bytes
    _ensure_size(data, offset + CAR_TELEMETRY_CAR_RECORD_SIZE)
    speed, throttle, _steer, brake, _clutch, gear, rpm, drs = CAR_TELEMETRY_PLAYER_STRUCT.unpack_from(data, offset)
    _ensure_range("speed", speed, 0, 450)
    _ensure_range("throttle", throttle, 0.0, 1.0)
    _ensure_range("brake", brake, 0.0, 1.0)

    temps_offset = offset + 22
    brakes = CAR_TELEMETRY_TEMPS_STRUCT.unpack_from(data, temps_offset)
    brake_temps = tuple(int(v) for v in brakes[0:4])
    tyre_surface_temps = tuple(int(v) for v in brakes[4:8])
    tyre_inner_temps = tuple(int(v) for v in brakes[8:12])
    engine_temp = int(brakes[12])

    payload = CarTelemetryPacket(
        player_index=player_index,
        player=CarTelemetryPlayer(
            speed=speed,
            throttle=throttle,
            brake=brake,
            gear=gear,
            rpm=rpm,
            drs=drs,
            ers_store_energy=0.0,
            brake_temps_c=brake_temps,
            tyre_surface_temps_c=tyre_surface_temps,
            tyre_inner_temps_c=tyre_inner_temps,
            engine_temp_c=engine_temp,
        )
    )
    return DecodedPacket(kind="car_telemetry", payload=payload)


def decode_car_status(data: bytes, player_index: int) -> DecodedPacket:
    if not _is_valid_player_index(player_index):
        player_index = _select_status_player_index(data)
    else:
        player_index = _safe_player_index(player_index)
    offset = HEADER_STRUCT.size
    payload_size = len(data) - offset
    tyres_age_laps = 0
    if payload_size >= CAR_STATUS_CAR_RECORD_SIZE * CAR_COUNT:
        record_start = offset + (CAR_STATUS_CAR_RECORD_SIZE * player_index)
        _ensure_size(data, record_start + CAR_STATUS_CAR_RECORD_SIZE)
        (fuel_in_tank,) = _CAR_STATUS_FUEL_STRUCT.unpack_from(data, record_start + _CAR_STATUS_FUEL_OFFSET)
        (ers_store_energy,) = _CAR_STATUS_ERS_STRUCT.unpack_from(data, record_start + _CAR_STATUS_ERS_OFFSET)
        visual_tyre_compound = data[record_start + _CAR_STATUS_VIS_TYRE_OFFSET]
        tyres_age_laps = int(data[record_start + _CAR_STATUS_TYRES_AGE_OFFSET])
    else:
        _ensure_size(data, offset + COMPACT_CAR_STATUS_RECORD_SIZE)
        fuel_in_tank, _pit_limiter_status, _fuel_capacity, ers_store_energy = Struct("<fBff").unpack_from(data, offset)
        visual_tyre_compound = data[offset + Struct("<fBff").size]
    _ensure_range("fuel_in_tank", fuel_in_tank, 0.0, 120.0)
    _ensure_range("ers_store_energy", ers_store_energy, 0.0, 5_000_000.0)
    payload = CarStatusPacket(
        player_index=player_index,
        player=CarStatusPlayer(
            fuel_in_tank=fuel_in_tank,
            ers_store_energy=ers_store_energy,
            visual_tyre_compound=visual_tyre_compound,
            tyres_age_laps=tyres_age_laps,
        )
    )
    return DecodedPacket(kind="car_status", payload=payload)


def decode_car_damage(data: bytes) -> DecodedPacket:
    """Decode PacketId=10 (CAR_DAMAGE). Extracts tyre/brake damage for all cars."""
    offset = HEADER_STRUCT.size
    payload_size = len(data) - offset
    expected_min = CAR_DAMAGE_RECORD_SIZE * CAR_COUNT
    if payload_size < expected_min:
        raise PacketDecodeError(
            f"car_damage packet too small: {payload_size} < {expected_min}"
        )
    cars: list[CarDamageEntry] = []
    for car_index in range(CAR_COUNT):
        record_start = offset + car_index * CAR_DAMAGE_RECORD_SIZE
        td0, td1, td2, td3, bd0, bd1, bd2, bd3 = _CAR_DAMAGE_STRUCT.unpack_from(data, record_start)
        cars.append(CarDamageEntry(
            car_index=car_index,
            tyres_damage=(td0, td1, td2, td3),
            brakes_damage=(bd0, bd1, bd2, bd3),
        ))
    return DecodedPacket(kind="car_damage", payload=CarDamagePacket(cars=cars))


def decode_session_history(data: bytes) -> DecodedPacket:
    """Decode PacketId=11 (SESSION_HISTORY). Returns per-lap sector times for one car."""
    offset = HEADER_STRUCT.size
    payload_size = len(data) - offset
    if payload_size < _SESSION_HISTORY_HEADER_STRUCT.size:
        raise PacketDecodeError(f"session_history packet too small: {payload_size}")

    car_idx, num_laps, _num_stints, best_lap_idx, best_s1_idx, best_s2_idx, best_s3_idx = \
        _SESSION_HISTORY_HEADER_STRUCT.unpack_from(data, offset)

    lap_history: list[LapHistoryData] = []
    lap_data_offset = offset + _SESSION_HISTORY_HEADER_STRUCT.size

    max_laps = min(int(num_laps), 100)
    for i in range(max_laps):
        rec_start = lap_data_offset + i * _LAP_HISTORY_RECORD_SIZE
        if rec_start + _LAP_HISTORY_RECORD_SIZE > len(data):
            break
        lap_ms, s1_ms, s2_ms, s3_ms, flags = _LAP_HISTORY_STRUCT.unpack_from(data, rec_start)
        lap_history.append(LapHistoryData(
            lap_time_ms=lap_ms,
            sector1_time_ms=s1_ms,
            sector2_time_ms=s2_ms,
            sector3_time_ms=s3_ms,
            lap_valid_bit_flags=flags,
        ))

    return DecodedPacket(kind="session_history", payload=SessionHistoryPacket(
        car_index=int(car_idx),
        num_laps=int(num_laps),
        best_lap_time_index=int(best_lap_idx),
        best_sector1_index=int(best_s1_idx),
        best_sector2_index=int(best_s2_idx),
        best_sector3_index=int(best_s3_idx),
        lap_history=lap_history,
    ))
