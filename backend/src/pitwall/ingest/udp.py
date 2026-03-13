import asyncio
from pitwall.decoders.router import route_packet
from pitwall.logging.raw_log import RawPacketLogger
from pitwall.state.store import StateStore
from pitwall.api.ws import WebSocketHub


class UDPServerProtocol(asyncio.DatagramProtocol):
    def __init__(self, store: StateStore, hub: WebSocketHub, logger: RawPacketLogger) -> None:
        self.store = store
        self.hub = hub
        self.logger = logger

    def datagram_received(self, data: bytes, addr) -> None:  # type: ignore[override]
        self.logger.append(data)
        routed = route_packet(data)
        snapshot = self.store.apply(routed)
        asyncio.create_task(self.hub.broadcast(snapshot))


async def run_udp_listener(host: str, port: int, store: StateStore, hub: WebSocketHub, logger: RawPacketLogger):
    loop = asyncio.get_running_loop()
    transport, _ = await loop.create_datagram_endpoint(
        lambda: UDPServerProtocol(store, hub, logger), local_addr=(host, port)
    )
    return transport
