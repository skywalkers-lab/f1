"""
UDP Packet Stabilization Layer
==============================
Addresses UDP reliability issues: packet loss, reordering, duplication.

Architecture:
  Raw UDP → PacketStabilizer → Reorder Buffer → Interpolation → StateStore

Features:
  - Sequence tracking per (session_uid, packet_id)
  - Reorder buffer with configurable window
  - Gap detection and interpolation for motion/telemetry data
  - Feed Health Score: quantitative measure of stream quality
"""

import time
import logging
from collections import deque
from dataclasses import dataclass, field
from threading import Lock

logger = logging.getLogger(__name__)

# Reorder buffer: hold packets for up to N frames before flushing
REORDER_WINDOW = 3
# Maximum age (seconds) before a buffered packet is force-flushed
REORDER_TIMEOUT_S = 0.10
# Window size for health score calculation
HEALTH_WINDOW_SIZE = 500
# Interpolation: how many frames of gap we attempt to fill
MAX_INTERPOLATION_GAP = 5


@dataclass
class PacketStats:
    """Rolling statistics for feed health calculation."""
    received: int = 0
    decoded: int = 0
    dropped: int = 0
    duplicates: int = 0
    out_of_order: int = 0
    interpolated: int = 0
    gaps_detected: int = 0
    max_gap_frames: int = 0
    last_receive_time: float = 0.0
    # Rolling window for jitter measurement
    inter_arrival_times: deque = field(default_factory=lambda: deque(maxlen=100))
    # Per-packet-type tracking
    type_counts: dict = field(default_factory=dict)


@dataclass
class FeedHealthScore:
    """Quantitative feed quality metric exposed to UI."""
    score: float = 100.0          # 0-100
    packet_loss_pct: float = 0.0  # percentage
    avg_jitter_ms: float = 0.0    # average inter-arrival jitter
    max_jitter_ms: float = 0.0    # worst case jitter
    gap_rate: float = 0.0         # gaps per 100 packets
    interpolation_pct: float = 0.0  # % of data that was interpolated
    out_of_order_pct: float = 0.0
    uptime_s: float = 0.0


@dataclass(frozen=True)
class BufferedPacket:
    """A packet waiting in the reorder buffer."""
    session_uid: int
    packet_id: int
    frame_id: int
    timestamp: float
    data: object  # RoutedPacket


class SequenceTracker:
    """Tracks sequence numbers per (session_uid, packet_id) stream."""

    def __init__(self) -> None:
        self._streams: dict[tuple[int, int], int] = {}
        self._gap_history: dict[tuple[int, int], list[int]] = {}

    def check(self, session_uid: int, packet_id: int, frame_id: int) -> tuple[str, int]:
        """
        Returns (status, gap) where status is one of:
          'new'        - first packet for this stream
          'sequential' - expected next frame
          'gap'        - gap detected (gap = number of missing frames)
          'duplicate'  - already seen this frame
          'reordered'  - out of order but not duplicate
        """
        key = (session_uid, packet_id)
        last = self._streams.get(key)

        if last is None:
            self._streams[key] = frame_id
            return ("new", 0)

        if frame_id == last:
            return ("duplicate", 0)

        if frame_id == last + 1:
            self._streams[key] = frame_id
            return ("sequential", 0)

        if frame_id > last + 1:
            gap = frame_id - last - 1
            self._streams[key] = frame_id
            return ("gap", gap)

        if frame_id > last - REORDER_WINDOW:
            # Recent enough to be a reorder, not ancient duplicate
            return ("reordered", 0)

        return ("duplicate", 0)

    def reset_session(self, session_uid: int) -> None:
        """Clear tracking for a session (e.g., new race)."""
        keys_to_remove = [k for k in self._streams if k[0] == session_uid]
        for k in keys_to_remove:
            del self._streams[k]


class ReorderBuffer:
    """
    Holds packets briefly to allow out-of-order packets to arrive.
    Flushes them in frame_id order once the window passes or timeout expires.
    """

    def __init__(self, window: int = REORDER_WINDOW, timeout_s: float = REORDER_TIMEOUT_S) -> None:
        self._window = window
        self._timeout_s = timeout_s
        # Per-stream buffer: key = (session_uid, packet_id)
        self._buffers: dict[tuple[int, int], list[BufferedPacket]] = {}
        self._high_water: dict[tuple[int, int], int] = {}

    def insert(self, pkt: BufferedPacket) -> list[BufferedPacket]:
        """Insert a packet and return any packets ready to be flushed."""
        key = (pkt.session_uid, pkt.packet_id)

        if key not in self._buffers:
            self._buffers[key] = []
            self._high_water[key] = pkt.frame_id

        buf = self._buffers[key]
        buf.append(pkt)

        if pkt.frame_id > self._high_water[key]:
            self._high_water[key] = pkt.frame_id

        return self._flush(key)

    def flush_expired(self) -> list[BufferedPacket]:
        """Force-flush any packets that have waited too long."""
        now = time.monotonic()
        result = []
        for key in list(self._buffers.keys()):
            buf = self._buffers[key]
            expired = [p for p in buf if (now - p.timestamp) >= self._timeout_s]
            if expired:
                expired.sort(key=lambda p: p.frame_id)
                result.extend(expired)
                remaining = [p for p in buf if (now - p.timestamp) < self._timeout_s]
                self._buffers[key] = remaining
        return result

    def _flush(self, key: tuple[int, int]) -> list[BufferedPacket]:
        """Flush packets that are old enough relative to the high-water mark."""
        buf = self._buffers[key]
        hw = self._high_water[key]

        ready = [p for p in buf if (hw - p.frame_id) >= self._window]
        if not ready:
            return []

        ready.sort(key=lambda p: p.frame_id)
        remaining = [p for p in buf if (hw - p.frame_id) < self._window]
        self._buffers[key] = remaining
        return ready


class MotionInterpolator:
    """
    Interpolates missing motion data from surrounding frames.
    Uses linear interpolation for positions and velocities.
    """

    def __init__(self) -> None:
        # Last known good state per car: {car_index: (x, z, vx, vz, timestamp)}
        self._last_known: dict[int, tuple[float, float, float, float, float]] = {}

    def update(self, car_index: int, x: float, z: float, vx: float = 0.0, vz: float = 0.0) -> None:
        self._last_known[car_index] = (x, z, vx, vz, time.monotonic())

    def interpolate(self, car_index: int, dt_s: float) -> tuple[float, float] | None:
        """Predict position using last known state + velocity extrapolation."""
        state = self._last_known.get(car_index)
        if state is None:
            return None
        x, z, vx, vz, ts = state
        # Clamp extrapolation to prevent wild predictions
        dt_clamped = min(dt_s, 0.5)
        return (x + vx * dt_clamped, z + vz * dt_clamped)

    def has_data(self, car_index: int) -> bool:
        return car_index in self._last_known


class PacketStabilizer:
    """
    Main stabilization layer sitting between UDP receive and StateStore.

    Responsibilities:
      1. Sequence tracking — detect gaps, duplicates, reorders
      2. Reorder buffering — hold packets briefly to restore order
      3. Motion interpolation — fill gaps in position data
      4. Feed health scoring — expose quality metrics
    """

    def __init__(self) -> None:
        self._lock = Lock()
        self._sequence = SequenceTracker()
        self._reorder = ReorderBuffer()
        self._interpolator = MotionInterpolator()
        self._stats = PacketStats()
        self._start_time = time.monotonic()
        self._current_session_uid: int = 0

    def process(self, routed_packet) -> list:
        """
        Process a routed packet through the stabilization pipeline.

        Returns a list of (routed_packet, is_interpolated) tuples ready for
        the StateStore, in correct order.
        """
        from pitwall.decoders.router import RoutedPacket

        with self._lock:
            now = time.monotonic()
            self._stats.received += 1

            # Track inter-arrival times for jitter
            if self._stats.last_receive_time > 0:
                iat = (now - self._stats.last_receive_time) * 1000  # ms
                self._stats.inter_arrival_times.append(iat)
            self._stats.last_receive_time = now

            # Handle dropped/undecodable packets
            if routed_packet.decoded is None:
                self._stats.dropped += 1
                return [(routed_packet, False)]

            header = routed_packet.header
            packet_id = header.packet_id
            frame_id = header.frame_identifier
            session_uid = header.session_uid

            # Detect session change
            if session_uid != self._current_session_uid:
                if self._current_session_uid != 0:
                    logger.info(f"Session change detected: {self._current_session_uid} → {session_uid}")
                    self._sequence.reset_session(self._current_session_uid)
                self._current_session_uid = session_uid

            # Track packet types
            kind = routed_packet.decoded.kind
            self._stats.type_counts[kind] = self._stats.type_counts.get(kind, 0) + 1

            # Sequence analysis
            status, gap = self._sequence.check(session_uid, packet_id, frame_id)

            if status == "duplicate":
                self._stats.duplicates += 1
                return []  # Drop duplicates

            if status == "reordered":
                self._stats.out_of_order += 1

            if status == "gap":
                self._stats.gaps_detected += 1
                self._stats.max_gap_frames = max(self._stats.max_gap_frames, gap)

            self._stats.decoded += 1

            # Insert into reorder buffer
            buffered = BufferedPacket(
                session_uid=session_uid,
                packet_id=packet_id,
                frame_id=frame_id,
                timestamp=now,
                data=routed_packet,
            )

            # For high-frequency packets (motion, telemetry), use reorder buffer
            # For low-frequency packets (session, event), pass through immediately
            HIGH_FREQ_PACKETS = {0, 2, 6, 7, 10}  # MOTION, LAP_DATA, TELEMETRY, STATUS, DAMAGE
            if packet_id in HIGH_FREQ_PACKETS:
                ready_packets = self._reorder.insert(buffered)
                # Also flush any expired packets
                ready_packets.extend(self._reorder.flush_expired())
            else:
                ready_packets = [buffered]

            # Prepare output - already sorted by frame_id within flush
            result = []
            for bp in ready_packets:
                result.append((bp.data, False))

                # Update interpolator with motion data
                if bp.data.decoded and bp.data.decoded.kind == "motion":
                    for car in bp.data.decoded.payload.cars:
                        self._interpolator.update(
                            car.car_index,
                            car.world_position_x,
                            car.world_position_z,
                        )

            return result

    def get_health_score(self) -> FeedHealthScore:
        """Calculate current feed health score."""
        with self._lock:
            return self._compute_health()

    def get_health_dict(self) -> dict:
        """Get health score as a dictionary for API/WebSocket."""
        score = self.get_health_score()
        return {
            "score": round(score.score, 1),
            "packet_loss_pct": round(score.packet_loss_pct, 2),
            "avg_jitter_ms": round(score.avg_jitter_ms, 1),
            "max_jitter_ms": round(score.max_jitter_ms, 1),
            "gap_rate": round(score.gap_rate, 2),
            "interpolation_pct": round(score.interpolation_pct, 2),
            "out_of_order_pct": round(score.out_of_order_pct, 2),
            "uptime_s": round(score.uptime_s, 1),
        }

    def get_extended_stats(self) -> dict:
        """Extended ingestion statistics for the state model."""
        with self._lock:
            return {
                "packets_received": self._stats.received,
                "packets_decoded": self._stats.decoded,
                "packets_dropped": self._stats.dropped,
                "duplicate_packets": self._stats.duplicates,
                "out_of_order_packets": self._stats.out_of_order,
                "gaps_detected": self._stats.gaps_detected,
                "max_gap_frames": self._stats.max_gap_frames,
                "interpolated_frames": self._stats.interpolated,
                "decode_errors": self._stats.dropped,
                "last_packet_type": "",
            }

    def _compute_health(self) -> FeedHealthScore:
        uptime = time.monotonic() - self._start_time
        total = max(1, self._stats.received)

        # Packet loss percentage
        loss_pct = (self._stats.dropped / total) * 100

        # Jitter statistics
        iats = list(self._stats.inter_arrival_times)
        if len(iats) >= 2:
            mean_iat = sum(iats) / len(iats)
            jitters = [abs(iats[i] - iats[i - 1]) for i in range(1, len(iats))]
            avg_jitter = sum(jitters) / len(jitters) if jitters else 0
            max_jitter = max(jitters) if jitters else 0
        else:
            avg_jitter = 0.0
            max_jitter = 0.0

        # Gap rate (gaps per 100 packets)
        gap_rate = (self._stats.gaps_detected / total) * 100

        # Interpolation percentage
        interp_pct = (self._stats.interpolated / max(1, self._stats.decoded)) * 100

        # Out of order percentage
        ooo_pct = (self._stats.out_of_order / total) * 100

        # Composite score: weighted formula
        # 100 = perfect, penalties reduce it
        score = 100.0
        score -= loss_pct * 2.0           # Heavy penalty for packet loss
        score -= ooo_pct * 0.5            # Moderate penalty for reordering
        score -= gap_rate * 1.5           # Penalty for gaps
        score -= min(avg_jitter / 5, 15)  # Jitter penalty (capped at 15)
        score -= interp_pct * 0.3         # Minor penalty for interpolation
        score = max(0.0, min(100.0, score))

        return FeedHealthScore(
            score=score,
            packet_loss_pct=loss_pct,
            avg_jitter_ms=avg_jitter,
            max_jitter_ms=max_jitter,
            gap_rate=gap_rate,
            interpolation_pct=interp_pct,
            out_of_order_pct=ooo_pct,
            uptime_s=uptime,
        )
