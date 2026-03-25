import asyncio
import logging
from typing import Any, Callable
from pitwall.decoders.router import route_packet
from pitwall.logging.raw_log import RawPacketLogger
from pitwall.state.store import StateStore
from pitwall.api.ws import WebSocketHub

logger = logging.getLogger(__name__)


class UDPServerProtocol(asyncio.DatagramProtocol):
    """F1 25 UDP telemetry receiver.

    Pipeline:
      UDP datagram → route_packet (decode) → store.apply (stabilize + reduce)
      → snapshot callback (session recording)
      → EventBusBridge.on_snapshot_sync (batch publish to EventBus topics)
      → EventBus subscribers handle room-based WS delivery

    The legacy hub.broadcast is retained only for backward compatibility
    with clients connected to the generic /ws endpoint.
    """

    def __init__(self, store: StateStore, hub: WebSocketHub, logger: RawPacketLogger,
                 on_snapshot: Callable[[dict], None] | None = None,
                 event_bridge: Any = None) -> None:
        self.store = store
        self.hub = hub
        self.logger = logger
        self._on_snapshot = on_snapshot
        self._event_bridge = event_bridge
        self._first_packet = True
        self._packet_count = 0
        self._snapshot_count = 0
        self._bridge_errors = 0

    def datagram_received(self, data: bytes, addr) -> None:  # type: ignore[override]
        self._packet_count += 1
        if self._first_packet:
            self._first_packet = False
            logger.info(f"First UDP packet received from {addr[0]}:{addr[1]} ({len(data)} bytes) — telemetry stream active")
        if self._packet_count % 5000 == 0:
            logger.info(f"UDP packets received: {self._packet_count}, snapshots: {self._snapshot_count}")
        self.logger.append(data)
        routed = route_packet(data)
        # Apply through stabilizer → state store pipeline
        snapshot = self.store.apply(routed)
        if snapshot is None:
            return

        self._snapshot_count += 1

        # Feed snapshot callback (session recording, setup analysis)
        if self._on_snapshot is not None:
            try:
                self._on_snapshot(snapshot)
            except Exception as e:
                logger.error(f"Snapshot callback failed: {type(e).__name__}: {e}")

        # Publish through EventBus bridge (event-driven delivery to all consumers)
        # This is the primary delivery path — replaces direct hub.broadcast for
        # room-based clients (/ws/hud, /ws/overlay)
        if self._event_bridge is not None:
            try:
                self._event_bridge.on_snapshot_sync(snapshot)
            except Exception as e:
                self._bridge_errors += 1
                if self._bridge_errors <= 5 or self._bridge_errors % 100 == 0:
                    logger.error(f"EventBridge publish failed ({self._bridge_errors}x): {type(e).__name__}: {e}")
            # EventBus bridge handles all room-based delivery; no need for legacy broadcast
            return

        # Fallback: direct broadcast when no EventBridge is available (dev/test mode)
        task = asyncio.create_task(self.hub.broadcast(snapshot))
        task.add_done_callback(self._handle_broadcast_done)

    @staticmethod
    def _handle_broadcast_done(task: asyncio.Task) -> None:
        """Handle broadcast task completion and log any errors."""
        try:
            task.result()
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error(f"Broadcast task failed: {type(e).__name__}: {e}")

    @property
    def stats(self) -> dict:
        return {
            "packets_received": self._packet_count,
            "snapshots_produced": self._snapshot_count,
            "bridge_errors": self._bridge_errors,
        }


async def run_udp_listener(host: str, port: int, store: StateStore, hub: WebSocketHub,
                          logger: RawPacketLogger,
                          on_snapshot: Callable[[dict], None] | None = None,
                          event_bridge: Any = None):
    loop = asyncio.get_running_loop()
    transport, _ = await loop.create_datagram_endpoint(
        lambda: UDPServerProtocol(store, hub, logger, on_snapshot=on_snapshot, event_bridge=event_bridge),
        local_addr=(host, port)
    )
    return transport
