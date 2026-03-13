from struct import Struct
from pitwall.decoders.header import HEADER_STRUCT
from pitwall.decoders.packets import CAR_COUNT
from pitwall.decoders.router import route_packet


def mk_header(packet_id: int, player_car_index: int = 0) -> bytes:
    return HEADER_STRUCT.pack(2025, 25, 1, 0, 1, packet_id, 456, 1.0, 42, 42, player_car_index, 255)


def test_router_dispatch_event():
    data = mk_header(3) + b"SSTA"
    routed = route_packet(data)
    assert routed.decoded is not None
    assert routed.decoded.kind == "event"


def test_router_dispatch_motion():
    motion_struct = Struct("<fff")
    payload = b"".join(motion_struct.pack(float(i), 0.0, float(i * 2)) for i in range(CAR_COUNT))
    data = mk_header(0) + payload
    routed = route_packet(data)
    assert routed.decoded is not None
    assert routed.decoded.kind == "motion"
    assert len(routed.decoded.payload.cars) == CAR_COUNT


def test_router_dispatch_lap_data():
    lap_struct = Struct("<IIHBBB")
    payload = b"".join(lap_struct.pack(90000 + i, 45000 + i, 100, i + 1, 10 + i, 0) for i in range(CAR_COUNT))
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
    # Header says lap data, but payload is intentionally too short for 22 cars
    data = mk_header(2) + b"\x00" * 8
    routed = route_packet(data)
    assert routed.decoded is None
    assert routed.diagnostic is not None
    assert routed.diagnostic.startswith("decode_error:")
