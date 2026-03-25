"""
TelemetryEventBus — asyncio-based Pub/Sub for the entire telemetry pipeline.

Inspired by pits-n-giggles' inter_task_communicator + IPC Pub/Sub system,
but implemented as a single in-process event bus using asyncio primitives.

Design goals:
  • Lock-free hot path (asyncio.Queue per subscriber)
  • Topic-based routing with wildcard support ("telemetry.*")
  • High-frequency data capable (20+ Hz per topic)
  • Backpressure: slow subscribers get oldest frames dropped
  • Metrics: track publish/subscribe counts, drops
"""

from __future__ import annotations

import asyncio
import fnmatch
import logging
import time
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

logger = logging.getLogger(__name__)

# Type alias for subscriber callbacks
Callback = Callable[[str, Any], Awaitable[None] | None]

# Maximum queue depth per subscriber before backpressure kicks in
_DEFAULT_MAX_QUEUE = 64


@dataclass
class _Subscription:
    """Internal subscription record."""
    topic_pattern: str
    callback: Callback
    queue: asyncio.Queue[tuple[str, Any]]
    task: asyncio.Task[None] | None = None
    drops: int = 0
    received: int = 0
    is_sync: bool = False


@dataclass
class EventBusMetrics:
    """Aggregate metrics for monitoring."""
    total_published: int = 0
    total_delivered: int = 0
    total_dropped: int = 0
    total_batches: int = 0
    topics_active: int = 0
    subscribers_active: int = 0
    publish_latency_ema_us: float = 0.0
    topic_counts: dict[str, int] = field(default_factory=dict)


class TelemetryEventBus:
    """
    High-performance in-process event bus for F1 telemetry data.

    Usage:
        bus = TelemetryEventBus()

        # Subscribe to specific topic
        sub_id = await bus.subscribe("telemetry.motion", handler)

        # Subscribe to pattern
        sub_id = await bus.subscribe("telemetry.*", handler)

        # Publish (fire-and-forget, non-blocking)
        await bus.publish("telemetry.motion", motion_data)

        # Unsubscribe
        await bus.unsubscribe(sub_id)

        # Shutdown
        await bus.shutdown()
    """

    def __init__(self, max_queue: int = _DEFAULT_MAX_QUEUE) -> None:
        self._max_queue = max_queue
        self._subscriptions: dict[int, _Subscription] = {}
        self._topic_cache: dict[str, list[_Subscription]] = {}
        self._next_id = 0
        self._metrics = EventBusMetrics()
        self._running = True
        self._publish_latency_ema = 0.0

    async def subscribe(
        self,
        topic_pattern: str,
        callback: Callback,
        max_queue: int | None = None,
    ) -> int:
        """
        Register a callback for a topic pattern.

        Patterns support fnmatch wildcards:
          "telemetry.motion"    → exact match
          "telemetry.*"         → matches telemetry.motion, telemetry.car, ...
          "*"                   → matches all topics

        Returns a subscription ID for later unsubscribe.
        """
        sub_id = self._next_id
        self._next_id += 1

        q_size = max_queue or self._max_queue
        queue: asyncio.Queue[tuple[str, Any]] = asyncio.Queue(maxsize=q_size)

        # Detect if callback is a coroutine function
        is_sync = not asyncio.iscoroutinefunction(callback)

        sub = _Subscription(
            topic_pattern=topic_pattern,
            callback=callback,
            queue=queue,
            is_sync=is_sync,
        )

        # Start consumer task
        sub.task = asyncio.create_task(self._consumer_loop(sub_id, sub))

        self._subscriptions[sub_id] = sub
        self._invalidate_cache()
        self._metrics.subscribers_active = len(self._subscriptions)

        logger.debug(f"EventBus: subscribed #{sub_id} to '{topic_pattern}'")
        return sub_id

    async def unsubscribe(self, sub_id: int) -> bool:
        """Remove a subscription by ID."""
        sub = self._subscriptions.pop(sub_id, None)
        if sub is None:
            return False

        if sub.task and not sub.task.done():
            sub.task.cancel()
            try:
                await sub.task
            except asyncio.CancelledError:
                pass

        self._invalidate_cache()
        self._metrics.subscribers_active = len(self._subscriptions)
        logger.debug(f"EventBus: unsubscribed #{sub_id} from '{sub.topic_pattern}'")
        return True

    async def publish(self, topic: str, data: Any) -> int:
        """
        Publish data to a topic. Non-blocking for the publisher.

        Returns the number of subscribers that received the message.
        """
        if not self._running:
            return 0

        t0 = time.monotonic()
        matched = self._resolve_topic(topic)
        delivered = 0

        for sub in matched:
            try:
                sub.queue.put_nowait((topic, data))
                sub.received += 1
                delivered += 1
            except asyncio.QueueFull:
                # Backpressure: drop oldest frame
                try:
                    sub.queue.get_nowait()
                except asyncio.QueueEmpty:
                    pass
                try:
                    sub.queue.put_nowait((topic, data))
                    sub.received += 1
                    delivered += 1
                except asyncio.QueueFull:
                    pass
                sub.drops += 1
                self._metrics.total_dropped += 1

        self._metrics.total_published += 1
        self._metrics.total_delivered += delivered

        # Track latency EMA
        elapsed_us = (time.monotonic() - t0) * 1_000_000
        alpha = 0.1
        self._metrics.publish_latency_ema_us = (
            self._metrics.publish_latency_ema_us * (1 - alpha) + elapsed_us * alpha
        )

        # Per-topic counting
        self._metrics.topic_counts[topic] = self._metrics.topic_counts.get(topic, 0) + 1

        return delivered

    async def publish_batch(self, messages: list[tuple[str, Any]]) -> int:
        """
        Atomically publish multiple (topic, data) pairs in one call.
        More efficient than calling publish() in a loop because topic
        resolution and latency tracking are batched.
        """
        if not self._running or not messages:
            return 0

        t0 = time.monotonic()
        total_delivered = 0

        for topic, data in messages:
            matched = self._resolve_topic(topic)
            for sub in matched:
                try:
                    sub.queue.put_nowait((topic, data))
                    sub.received += 1
                    total_delivered += 1
                except asyncio.QueueFull:
                    try:
                        sub.queue.get_nowait()
                    except asyncio.QueueEmpty:
                        pass
                    try:
                        sub.queue.put_nowait((topic, data))
                        sub.received += 1
                        total_delivered += 1
                    except asyncio.QueueFull:
                        pass
                    sub.drops += 1
                    self._metrics.total_dropped += 1

            self._metrics.total_published += 1
            self._metrics.topic_counts[topic] = self._metrics.topic_counts.get(topic, 0) + 1

        self._metrics.total_delivered += total_delivered
        self._metrics.total_batches += 1

        elapsed_us = (time.monotonic() - t0) * 1_000_000
        alpha = 0.1
        self._metrics.publish_latency_ema_us = (
            self._metrics.publish_latency_ema_us * (1 - alpha) + elapsed_us * alpha
        )

        return total_delivered

    def publish_sync(self, topic: str, data: Any) -> int:
        """
        Synchronous publish — for use from non-async contexts (e.g., UDP callback).
        Uses put_nowait only.
        """
        if not self._running:
            return 0

        matched = self._resolve_topic(topic)
        delivered = 0

        for sub in matched:
            try:
                sub.queue.put_nowait((topic, data))
                sub.received += 1
                delivered += 1
            except asyncio.QueueFull:
                try:
                    sub.queue.get_nowait()
                except asyncio.QueueEmpty:
                    pass
                try:
                    sub.queue.put_nowait((topic, data))
                    sub.received += 1
                    delivered += 1
                except asyncio.QueueFull:
                    pass
                sub.drops += 1
                self._metrics.total_dropped += 1

        self._metrics.total_published += 1
        self._metrics.total_delivered += delivered
        self._metrics.topic_counts[topic] = self._metrics.topic_counts.get(topic, 0) + 1
        return delivered

    def publish_batch_sync(self, messages: list[tuple[str, Any]]) -> int:
        """Synchronous batch publish — for use from non-async contexts (e.g., UDP callback)."""
        if not self._running or not messages:
            return 0

        total_delivered = 0
        for topic, data in messages:
            matched = self._resolve_topic(topic)
            for sub in matched:
                try:
                    sub.queue.put_nowait((topic, data))
                    sub.received += 1
                    total_delivered += 1
                except asyncio.QueueFull:
                    try:
                        sub.queue.get_nowait()
                    except asyncio.QueueEmpty:
                        pass
                    try:
                        sub.queue.put_nowait((topic, data))
                        sub.received += 1
                        total_delivered += 1
                    except asyncio.QueueFull:
                        pass
                    sub.drops += 1
                    self._metrics.total_dropped += 1
                    
            self._metrics.total_published += 1
            self._metrics.topic_counts[topic] = self._metrics.topic_counts.get(topic, 0) + 1

        self._metrics.total_delivered += total_delivered
        self._metrics.total_batches += 1
        return total_delivered

    async def shutdown(self) -> None:
        """Gracefully shut down all consumers."""
        self._running = False
        tasks = []
        for sub_id, sub in list(self._subscriptions.items()):
            if sub.task and not sub.task.done():
                sub.task.cancel()
                tasks.append(sub.task)
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        self._subscriptions.clear()
        self._invalidate_cache()
        logger.info("EventBus: shutdown complete")

    @property
    def metrics(self) -> EventBusMetrics:
        self._metrics.topics_active = len(self._topic_cache)
        return self._metrics

    def get_subscriber_stats(self) -> list[dict]:
        """Return per-subscriber diagnostics."""
        return [
            {
                "id": sub_id,
                "pattern": sub.topic_pattern,
                "received": sub.received,
                "drops": sub.drops,
                "queue_depth": sub.queue.qsize(),
                "is_sync": sub.is_sync,
            }
            for sub_id, sub in self._subscriptions.items()
        ]

    # ── Internal ────────────────────────────────────────────────────────

    def _resolve_topic(self, topic: str) -> list[_Subscription]:
        """Cached topic → subscriber resolution."""
        cached = self._topic_cache.get(topic)
        if cached is not None:
            return cached

        matched = [
            sub for sub in self._subscriptions.values()
            if fnmatch.fnmatch(topic, sub.topic_pattern)
        ]
        self._topic_cache[topic] = matched
        return matched

    def _invalidate_cache(self) -> None:
        self._topic_cache.clear()

    async def _consumer_loop(self, sub_id: int, sub: _Subscription) -> None:
        """Per-subscriber consumer that drains queue and invokes callback."""
        try:
            while self._running:
                topic, data = await sub.queue.get()
                try:
                    if sub.is_sync:
                        sub.callback(topic, data)
                    else:
                        await sub.callback(topic, data)
                except Exception as e:
                    logger.error(
                        f"EventBus: subscriber #{sub_id} callback error on '{topic}': "
                        f"{type(e).__name__}: {e}"
                    )
        except asyncio.CancelledError:
            pass


# ── Singleton accessor ──────────────────────────────────────────────────

_global_bus: TelemetryEventBus | None = None


def get_event_bus() -> TelemetryEventBus:
    """Get or create the global event bus singleton."""
    global _global_bus
    if _global_bus is None:
        _global_bus = TelemetryEventBus()
    return _global_bus


def reset_event_bus() -> None:
    """Reset global bus (for testing)."""
    global _global_bus
    _global_bus = None
