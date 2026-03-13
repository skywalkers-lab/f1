from struct import Struct
from pitwall.decoders.header import HEADER_STRUCT
from pitwall.decoders.packets import MOTION_CAR_COUNT
from pitwall.decoders.router import route_packet
from pitwall.state.store import StateStore


def test_store_updates_from_event_packet():
    data = HEADER_STRUCT.pack(2025, 25, 1, 0, 1, 3, 789, 1.0, 1, 1, 0, 255) + b"FTLP"
    routed = route_packet(data)
    store = StateStore()
    snapshot = store.apply(routed)
    assert snapshot["session_uid"] == 789
    assert snapshot["last_event_summary"] == "FTLP"


def test_store_updates_minimap_from_motion_packet():
    motion_struct = Struct("<fff")
    payload = b"".join(motion_struct.pack(float(i), 0.0, float(i * 3)) for i in range(MOTION_CAR_COUNT))
    data = HEADER_STRUCT.pack(2025, 25, 1, 0, 1, 0, 111, 1.0, 2, 2, 1, 255) + payload
    routed = route_packet(data)
    store = StateStore()
    snapshot = store.apply(routed)
    assert snapshot["minimap"]["mode"] == "live_trace"
    assert len(snapshot["minimap"]["cars"]) == MOTION_CAR_COUNT
    assert snapshot["minimap"]["player_car_index"] == 1


def test_ws_payload_shape_sanity():
    store = StateStore()
    payload = store.snapshot()
    assert "session_uid" in payload
    assert "ingest_stats" in payload
    assert "player" in payload
    assert "minimap" in payload
