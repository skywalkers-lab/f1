from struct import Struct
from pitwall.decoders.header import HEADER_STRUCT
from pitwall.decoders.packets import MOTION_CAR_COUNT
from pitwall.decoders.router import route_packet


def mk_header(packet_id: int) -> bytes:
    return HEADER_STRUCT.pack(2025, 25, 1, 0, 1, packet_id, 456, 1.0, 42, 42, 0, 255)


def test_router_dispatch_event():
    data = mk_header(3) + b"SSTA"
    routed = route_packet(data)
    assert routed.decoded is not None
    assert routed.decoded.kind == "event"


def test_router_dispatch_motion():
    motion_struct = Struct("<fff")
    payload = b"".join(motion_struct.pack(float(i), 0.0, float(i * 2)) for i in range(MOTION_CAR_COUNT))
    data = mk_header(0) + payload
    routed = route_packet(data)
    assert routed.decoded is not None
    assert routed.decoded.kind == "motion"
    assert len(routed.decoded.payload.cars) == MOTION_CAR_COUNT


def test_router_unknown_packet():
    data = mk_header(99)
    routed = route_packet(data)
    assert routed.decoded is None
    assert routed.diagnostic == "unknown packet id"
