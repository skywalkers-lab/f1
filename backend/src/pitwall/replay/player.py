import asyncio
from typing import Protocol
from pitwall.decoders.router import route_packet
from pitwall.replay.reader import read_records
from pitwall.state.store import StateStore


class Broadcaster(Protocol):
    async def broadcast(self, payload: dict) -> None: ...


async def replay_file(path: str, speed: float, store: StateStore, hub: Broadcaster) -> int:
    last_ts: float | None = None
    count = 0
    for ts, payload in read_records(path):
        if last_ts is not None:
            delta = max(0.0, ts - last_ts)
            await asyncio.sleep(delta / max(speed, 0.01))
        last_ts = ts
        routed = route_packet(payload)
        snapshot = store.apply(routed)
        await hub.broadcast(snapshot)
        count += 1
    return count
