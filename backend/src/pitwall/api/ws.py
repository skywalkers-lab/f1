import asyncio
import json
import logging
import time
from fastapi import WebSocket

logger = logging.getLogger(__name__)
MAX_WEBSOCKET_CLIENTS = 100  # Prevent DoS attacks
MIN_BROADCAST_INTERVAL_S = 0.016  # ~60fps cap on broadcasts

# ── Room definitions (inspired by pits-n-giggles room architecture) ────────
ROOM_RACE_TABLE = "race-table"      # Full dashboard viewers (~500ms cadence)
ROOM_STREAM_OVERLAY = "stream-overlay"  # Lightweight OBS overlay (~100ms)
ROOM_HUD = "hud"                    # In-game HUD overlay (~33ms / 30Hz)
VALID_ROOMS = {ROOM_RACE_TABLE, ROOM_STREAM_OVERLAY, ROOM_HUD}

# Room-specific broadcast throttles (seconds)
_ROOM_MIN_INTERVAL: dict[str, float] = {
    ROOM_RACE_TABLE: 0.100,       # 10Hz for full dashboard
    ROOM_STREAM_OVERLAY: 0.050,   # 20Hz for stream overlay
    ROOM_HUD: 0.033,              # 30Hz for HUD
}


class WebSocketClient:
    """Wrapper around a WebSocket with client metadata."""
    __slots__ = ("ws", "client_id", "role", "room", "focused_car", "connected_at", "use_msgpack")

    def __init__(self, ws: WebSocket, client_id: str = "", role: str = "viewer",
                 room: str = ROOM_RACE_TABLE, use_msgpack: bool = False) -> None:
        self.ws = ws
        self.client_id = client_id
        self.role = role  # viewer | driver | spectator
        self.room = room
        self.focused_car: int = -1
        self.connected_at: float = time.monotonic()
        self.use_msgpack = use_msgpack


def _try_msgpack_encode(payload: dict) -> bytes | None:
    """Attempt to encode payload with msgpack if available."""
    try:
        import msgpack  # type: ignore[import-untyped]
        return msgpack.packb(payload, use_bin_type=True)
    except ImportError:
        return None


class WebSocketHub:
    def __init__(self) -> None:
        self._clients: dict[WebSocket, WebSocketClient] = {}
        self._lock = asyncio.Lock()
        self._last_broadcast_time: float = 0.0
        self._dropped_broadcasts: int = 0
        self._total_broadcasts: int = 0
        # Per-room broadcast throttle tracking
        self._room_last_broadcast: dict[str, float] = {}

    async def connect(self, websocket: WebSocket, role: str = "viewer",
                      client_id: str = "", room: str = ROOM_RACE_TABLE,
                      use_msgpack: bool = False) -> None:
        """Accept a new WebSocket connection with connection limit check."""
        async with self._lock:
            over_capacity = len(self._clients) >= MAX_WEBSOCKET_CLIENTS

        if over_capacity:
            logger.warning(f"Max WebSocket connections ({MAX_WEBSOCKET_CLIENTS}) reached")
            await websocket.close(code=1008, reason="Server at capacity")
            return

        # Validate room
        if room not in VALID_ROOMS:
            room = ROOM_RACE_TABLE

        await websocket.accept()
        client = WebSocketClient(ws=websocket, client_id=client_id, role=role,
                                 room=room, use_msgpack=use_msgpack)
        async with self._lock:
            self._clients[websocket] = client
        logger.debug(f"Client connected ({role}, room={room}). Total clients: {len(self._clients)}")

    async def disconnect(self, websocket: WebSocket) -> None:
        """Disconnect a WebSocket client."""
        async with self._lock:
            self._clients.pop(websocket, None)
        logger.debug(f"Client disconnected. Total clients: {len(self._clients)}")

    async def set_client_focus(self, websocket: WebSocket, car_index: int) -> None:
        """Set a client's focused car for spectator mode."""
        async with self._lock:
            client = self._clients.get(websocket)
            if client:
                client.focused_car = car_index
                client.role = "spectator"

    async def set_client_room(self, websocket: WebSocket, room: str) -> None:
        """Move a client to a different room."""
        if room not in VALID_ROOMS:
            return
        async with self._lock:
            client = self._clients.get(websocket)
            if client:
                client.room = room

    async def _send_to_client(self, client: WebSocketClient, payload: dict) -> bool:
        """Send payload to a single client, using msgpack if negotiated."""
        try:
            if client.use_msgpack:
                packed = _try_msgpack_encode(payload)
                if packed:
                    await client.ws.send_bytes(packed)
                    return True
            await client.ws.send_json(payload)
            return True
        except Exception as e:
            logger.error(f"Failed to send message to client: {type(e).__name__}: {e}")
            return False

    async def broadcast(self, payload: dict) -> None:
        """Broadcast a message to all connected clients with throttling and error handling."""
        now = time.monotonic()
        if now - self._last_broadcast_time < MIN_BROADCAST_INTERVAL_S:
            self._dropped_broadcasts += 1
            return
        self._last_broadcast_time = now
        self._total_broadcasts += 1

        async with self._lock:
            clients = list(self._clients.values())

        if not clients:
            return

        results = await asyncio.gather(
            *(self._send_to_client(c, payload) for c in clients),
            return_exceptions=True,
        )

        failed = [
            clients[i].ws for i, ok in enumerate(results)
            if ok is not True
        ]
        for ws in failed:
            await self.disconnect(ws)

    async def broadcast_to_room(self, room: str, payload: dict) -> None:
        """Broadcast a message to clients in a specific room with per-room throttling."""
        now = time.monotonic()
        min_interval = _ROOM_MIN_INTERVAL.get(room, MIN_BROADCAST_INTERVAL_S)
        last = self._room_last_broadcast.get(room, 0.0)
        if now - last < min_interval:
            return
        self._room_last_broadcast[room] = now
        self._total_broadcasts += 1

        async with self._lock:
            clients = [c for c in self._clients.values() if c.room == room]

        if not clients:
            return

        results = await asyncio.gather(
            *(self._send_to_client(c, payload) for c in clients),
            return_exceptions=True,
        )

        failed = [
            clients[i].ws for i, ok in enumerate(results)
            if ok is not True
        ]
        for ws in failed:
            await self.disconnect(ws)

    async def heartbeat(self) -> None:
        """Send a heartbeat message to all clients."""
        async with self._lock:
            clients = list(self._clients.values())

        if not clients:
            return

        failed: list[WebSocket] = []
        for client in clients:
            try:
                await client.ws.send_json({"type": "heartbeat"})
            except Exception:
                failed.append(client.ws)

        for ws in failed:
            await self.disconnect(ws)

    @property
    def stats(self) -> dict:
        roles: dict[str, int] = {}
        rooms: dict[str, int] = {}
        msgpack_count = 0
        for c in self._clients.values():
            roles[c.role] = roles.get(c.role, 0) + 1
            rooms[c.room] = rooms.get(c.room, 0) + 1
            if c.use_msgpack:
                msgpack_count += 1
        return {
            "connected_clients": len(self._clients),
            "total_broadcasts": self._total_broadcasts,
            "dropped_broadcasts": self._dropped_broadcasts,
            "client_roles": roles,
            "client_rooms": rooms,
            "msgpack_clients": msgpack_count,
        }
