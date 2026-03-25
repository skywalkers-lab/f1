import asyncio
from pathlib import Path
from pitwall.decoders.header import HEADER_STRUCT
from pitwall.logging.raw_log import RawPacketLogger
from pitwall.replay.player import replay_file
from pitwall.state.store import StateStore


class DummyHub:
    def __init__(self) -> None:
        self.count = 0

    async def broadcast(self, payload: dict) -> None:
        self.count += 1


def test_replay_player_replays_logged_packets(tmp_path: Path):
    log_path = tmp_path / "packets.log"
    logger = RawPacketLogger(str(log_path))

    event_packet = HEADER_STRUCT.pack(2025, 25, 1, 0, 1, 3, 99, 0.0, 1, 1, 0, 255) + b"FTLP"
    logger.append(event_packet)

    store = StateStore()
    hub = DummyHub()

    processed = asyncio.run(replay_file(str(log_path), 10.0, store, hub))
    snapshot = store.snapshot()

    assert processed == 1
    assert hub.count == 1
    assert snapshot["last_event_summary"] == "FTLP"
