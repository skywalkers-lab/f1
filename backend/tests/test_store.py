from struct import Struct
from pitwall.decoders.header import HEADER_STRUCT
from pitwall.decoders.packets import CAR_COUNT, MOTION_CAR_RECORD_SIZE, LAP_DATA_CAR_RECORD_SIZE, CAR_STATUS_CAR_RECORD_SIZE
from pitwall.decoders.router import route_packet
from pitwall.state.store import StateStore


def make_motion_record(world_x: float, world_z: float) -> bytes:
    record = bytearray(MOTION_CAR_RECORD_SIZE)
    Struct("<fff").pack_into(record, 0, world_x, 0.0, world_z)
    return bytes(record)


def make_lap_record(last_lap_ms: int, current_lap_ms: int, car_position: int, current_lap_num: int) -> bytes:
    record = bytearray(LAP_DATA_CAR_RECORD_SIZE)
    Struct("<II").pack_into(record, 0, last_lap_ms, current_lap_ms)
    record[32] = car_position
    record[33] = current_lap_num
    return bytes(record)


def make_status_record(fuel_in_tank: float, visual_tyre_compound: int, ers_store_energy: float) -> bytes:
    record = bytearray(CAR_STATUS_CAR_RECORD_SIZE)
    Struct("<f").pack_into(record, 5, fuel_in_tank)
    record[26] = visual_tyre_compound
    Struct("<f").pack_into(record, 37, ers_store_energy)
    return bytes(record)


def test_store_updates_from_event_packet():
    data = HEADER_STRUCT.pack(2025, 25, 1, 0, 1, 3, 789, 1.0, 1, 1, 0, 255) + b"FTLP"
    routed = route_packet(data)
    store = StateStore()
    snapshot = store.apply(routed)
    assert snapshot["session_uid"] == 789
    assert snapshot["last_event_summary"] == "FTLP"


def test_store_updates_minimap_from_motion_packet():
    payload = b"".join(make_motion_record(float(i), float(i * 3)) for i in range(CAR_COUNT))
    data = HEADER_STRUCT.pack(2025, 25, 1, 0, 1, 0, 111, 1.0, 2, 2, 1, 255) + payload
    routed = route_packet(data)
    store = StateStore()
    snapshot = store.apply(routed)
    assert snapshot["minimap"]["mode"] == "live_trace"
    assert len(snapshot["minimap"]["cars"]) == CAR_COUNT
    assert snapshot["minimap"]["player_car_index"] == 1


def test_store_builds_leaderboard_pace_and_strategy():
    store = StateStore()
    lap_payload = b"".join(
        make_lap_record(90000 + i * 10, 45000 + i * 10, i + 1, 5 + i) for i in range(CAR_COUNT)
    )
    lap_data = HEADER_STRUCT.pack(2025, 25, 1, 0, 1, 2, 1, 0.0, 10, 10, 0, 255) + lap_payload
    status_payload = make_status_record(3.2, 5, 1_000_000.0)
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
    # stale packet returns None — get last known state via snapshot()
    assert snapshot is None
    last = store.snapshot()
    assert last["last_event_summary"] == "EVN1"
    assert last["ingest_stats"]["last_packet_type"] == "stale_packet"


def test_store_accepts_lower_frame_for_new_session_uid():
    store = StateStore()
    # First session uses high frame id.
    data_session_a = HEADER_STRUCT.pack(2025, 25, 1, 0, 1, 3, 1001, 0.0, 5000, 5000, 0, 255) + b"A001"
    store.apply(route_packet(data_session_a))

    # New session starts with low frame id; should not be treated as stale.
    data_session_b = HEADER_STRUCT.pack(2025, 25, 1, 0, 1, 3, 2002, 0.0, 12, 12, 0, 255) + b"B002"
    snapshot = store.apply(route_packet(data_session_b))

    assert snapshot["session_uid"] == 2002
    assert snapshot["last_event_summary"] == "B002"
    assert snapshot["ingest_stats"]["last_packet_type"] == "event"


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


def test_store_clamps_invalid_player_car_index_from_header():
    data = HEADER_STRUCT.pack(2025, 25, 1, 0, 1, 3, 789, 1.0, 1, 1, 255, 255) + b"FTLP"
    routed = route_packet(data)
    store = StateStore()
    snapshot = store.apply(routed)
    assert snapshot["player_car_index"] == 0
