from struct import Struct
from pitwall.decoders.header import HEADER_STRUCT
from pitwall.decoders.packets import CAR_COUNT
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
    payload = b"".join(motion_struct.pack(float(i), 0.0, float(i * 3)) for i in range(CAR_COUNT))
    data = HEADER_STRUCT.pack(2025, 25, 1, 0, 1, 0, 111, 1.0, 2, 2, 1, 255) + payload
    routed = route_packet(data)
    store = StateStore()
    snapshot = store.apply(routed)
    assert snapshot["minimap"]["mode"] == "live_trace"
    assert len(snapshot["minimap"]["cars"]) == CAR_COUNT
    assert snapshot["minimap"]["player_car_index"] == 1


def test_store_builds_leaderboard_pace_and_strategy():
    store = StateStore()
    lap_struct = Struct("<IIHBBB")
    lap_payload = b"".join(
        lap_struct.pack(90000 + i * 10, 45000 + i * 10, 0, i + 1, 5 + i, 0) for i in range(CAR_COUNT)
    )
    lap_data = HEADER_STRUCT.pack(2025, 25, 1, 0, 1, 2, 1, 0.0, 10, 10, 0, 255) + lap_payload
    status_struct = Struct("<fBff")
    status_payload = status_struct.pack(3.2, 0, 0.0, 1_000_000.0) + bytes([5])
    status_data = HEADER_STRUCT.pack(2025, 25, 1, 0, 1, 7, 1, 0.0, 11, 11, 0, 255) + status_payload

    store.apply(route_packet(lap_data))
    snapshot = store.apply(route_packet(status_data))

    assert snapshot["player"]["lap"] == 5
    assert len(snapshot["leaderboard"]) > 0
    assert snapshot["pace"]["best_lap_ms"] > 0
    assert snapshot["strategy"]["action"] in {"PIT_NOW", "PIT_IN_1", "PIT_IN_2", "STAY_OUT"}
    assert len(snapshot["strategy"]["candidates"]) == 4


def test_store_ignores_stale_frames():
    store = StateStore()
    data_newer = HEADER_STRUCT.pack(2025, 25, 1, 0, 1, 3, 7, 0.0, 20, 20, 0, 255) + b"EVN1"
    data_older = HEADER_STRUCT.pack(2025, 25, 1, 0, 1, 3, 7, 0.0, 10, 10, 0, 255) + b"EVN2"
    store.apply(route_packet(data_newer))
    snapshot = store.apply(route_packet(data_older))
    assert snapshot["last_event_summary"] == "EVN1"
    assert snapshot["ingest_stats"]["last_packet_type"] == "stale_packet"


def test_strategy_matrix_sc_case_prefers_early_pit_option():
    store = StateStore()
    session_payload = bytes([1, 0, 0, 50, 3, 4, 0, 2, 0])
    session_data = HEADER_STRUCT.pack(2025, 25, 1, 0, 1, 1, 8, 0.0, 2, 2, 0, 255) + session_payload
    snapshot = store.apply(route_packet(session_data))
    assert snapshot["strategy"]["action"] in {"PIT_NOW", "PIT_IN_1", "PIT_IN_2", "STAY_OUT"}


def test_ws_payload_shape_sanity():
    store = StateStore()
    payload = store.snapshot()
    assert "session_uid" in payload
    assert "ingest_stats" in payload
    assert "player" in payload
    assert "minimap" in payload
    assert "leaderboard" in payload
    assert "strategy" in payload
    assert "duplicate_packets" in payload["ingest_stats"]
    assert "decode_errors" in payload["ingest_stats"]
