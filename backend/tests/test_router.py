from struct import Struct
from pitwall.decoders.header import HEADER_STRUCT
from pitwall.decoders.packets import (
    CAR_COUNT,
    MOTION_CAR_RECORD_SIZE,
    LAP_DATA_CAR_RECORD_SIZE,
)
from pitwall.decoders.router import route_packet


def mk_header(packet_id: int, player_car_index: int = 0) -> bytes:
    return HEADER_STRUCT.pack(2025, 25, 1, 0, 1, packet_id, 456, 1.0, 42, 42, player_car_index, 255)


def make_motion_record(world_x: float, world_z: float) -> bytes:
    """Build a 60-byte CarMotionData record with worldX/worldZ set."""
    record = bytearray(MOTION_CAR_RECORD_SIZE)
    Struct("<fff").pack_into(record, 0, world_x, 0.0, world_z)
    return bytes(record)


def make_lap_record(last_lap_ms: int, current_lap_ms: int, car_position: int, current_lap_num: int) -> bytes:
    """Build a 57-byte LapData record with key fields populated at correct offsets."""
    record = bytearray(LAP_DATA_CAR_RECORD_SIZE)
    Struct("<II").pack_into(record, 0, last_lap_ms, current_lap_ms)
    record[32] = car_position  # m_carPosition
    record[33] = current_lap_num  # m_currentLapNum
    return bytes(record)


def test_router_dispatch_event():
    data = mk_header(3) + b"SSTA"
    routed = route_packet(data)
    assert routed.decoded is not None
    assert routed.decoded.kind == "event"


def test_router_dispatch_motion():
    payload = b"".join(make_motion_record(float(i), float(i * 2)) for i in range(CAR_COUNT))
    data = mk_header(0) + payload
    routed = route_packet(data)
    assert routed.decoded is not None
    assert routed.decoded.kind == "motion"
    assert len(routed.decoded.payload.cars) == CAR_COUNT


def test_router_dispatch_lap_data():
    payload = b"".join(
        make_lap_record(90000 + i, 45000 + i, i + 1, 10 + i) for i in range(CAR_COUNT)
    )
    data = mk_header(2, player_car_index=1) + payload
    routed = route_packet(data)
    assert routed.decoded is not None
    assert routed.decoded.kind == "lap_data"
    assert routed.decoded.payload.cars[1].current_lap_num == 11


def test_router_unknown_packet():
    data = mk_header(99)
    routed = route_packet(data)
    assert routed.decoded is None
    assert routed.diagnostic == "unknown packet id"


def test_router_truncated_known_packet_returns_diagnostic():
    data = mk_header(2) + b"\x00" * 8
    routed = route_packet(data)
    assert routed.decoded is None
    assert routed.diagnostic is not None
    assert routed.diagnostic.startswith("decode_error:")


def test_router_range_error_returns_diagnostic():
    # car_position=99 (> CAR_COUNT) should trigger a range_error diagnostic.
    rows = []
    for i in range(CAR_COUNT):
        position = 99 if i == 0 else i + 1
        rows.append(make_lap_record(90000 + i, 45000 + i, position, 10 + i))
    data = mk_header(2) + b"".join(rows)
    routed = route_packet(data)
    assert routed.decoded is None
    assert routed.diagnostic is not None
    assert "range_error" in routed.diagnostic


def test_router_clamps_invalid_player_index_for_player_packets():
    telemetry_record = bytearray(60)
    Struct("<HfffBbHB").pack_into(telemetry_record, 0, 301, 0.8, 0.0, 0.1, 0, 7, 12000, 1)
    payload = bytes(telemetry_record) * CAR_COUNT
    data = mk_header(6, player_car_index=255) + payload
    routed = route_packet(data)
    assert routed.decoded is not None
    assert routed.decoded.kind == "car_telemetry"
    assert routed.decoded.payload.player.speed == 301
