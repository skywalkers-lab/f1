from dataclasses import asdict
from statistics import pstdev
from threading import Lock
from pitwall.decoders.router import RoutedPacket
from pitwall.domain.strategy import StrategyEngine
from pitwall.state.minimap import MinimapTransformer
from pitwall.state.models import AppState, CarRaceState, LeaderboardRow, PaceSample, StrategyState


class StateStore:
    def __init__(self) -> None:
        self._state = AppState()
        self._lock = Lock()
        self._last_signature: tuple[int, int, int] | None = None
        self._minimap = MinimapTransformer()
        self._strategy = StrategyEngine()

    def _ensure_car(self, car_index: int) -> CarRaceState:
        if car_index not in self._state.cars:
            self._state.cars[car_index] = CarRaceState(car_index=car_index)
        return self._state.cars[car_index]

    def _rebuild_leaderboard(self) -> None:
        player_pos = self._state.player.position or 1
        rows: list[LeaderboardRow] = []
        for car in self._state.cars.values():
            if car.position <= 0:
                continue
            gap = (car.position - player_pos) * 0.85
            rows.append(
                LeaderboardRow(
                    position=car.position,
                    car_index=car.car_index,
                    driver_code=f"C{car.car_index:02d}",
                    gap_to_player_s=gap,
                    tyre_compound=car.tyre_compound,
                    is_pitting=car.is_pitting,
                    last_lap_ms=car.last_lap_ms,
                )
            )
        rows.sort(key=lambda r: r.position)
        self._state.leaderboard = rows[:22]

    def _rebuild_pace(self) -> None:
        player = self._state.player
        if player.last_lap_ms <= 0:
            return
        recent = self._state.pace.recent[-5:] + [PaceSample(lap=player.lap, lap_time_ms=player.last_lap_ms)]
        dedup: dict[int, PaceSample] = {}
        for sample in recent:
            dedup[sample.lap] = sample
        ordered = sorted(dedup.values(), key=lambda s: s.lap)[-6:]
        self._state.pace.recent = ordered
        laps = [s.lap_time_ms for s in ordered if s.lap_time_ms > 0]
        if laps:
            best = min(laps)
            avg = int(sum(laps) / len(laps))
            dev = pstdev(laps) if len(laps) > 1 else 0.0
            consistency = max(0.0, 100.0 - (dev / max(avg, 1)) * 1000)
            self._state.pace.best_lap_ms = best
            self._state.pace.avg_lap_ms = avg
            self._state.pace.consistency_pct = round(consistency, 1)

    def _rebuild_strategy(self) -> None:
        rec = self._strategy.recommend(
            race_control_state=self._state.race_control_state,
            player_position=self._state.player.position,
            tyre_compound=self._state.player.tyre_compound,
            fuel_kg=self._state.player.fuel,
            ers_energy=self._state.player.ers,
        )
        self._state.strategy = StrategyState(
            action=rec.action,
            score=rec.score,
            confidence=rec.confidence,
            reason=rec.reason,
            key_inputs=rec.key_inputs,
        )

    def apply(self, routed: RoutedPacket) -> dict:
        with self._lock:
            self._state.ingest_stats.packets_received += 1

            if routed.decoded is None:
                self._state.ingest_stats.packets_dropped += 1
                self._state.ingest_stats.last_packet_type = routed.diagnostic or "dropped"
                self._state.touch()
                return asdict(self._state)

            signature = (
                routed.header.session_uid,
                routed.header.frame_identifier,
                routed.header.packet_id,
            )
            if signature == self._last_signature:
                self._state.ingest_stats.last_packet_type = "duplicate_packet"
                self._state.touch()
                return asdict(self._state)
            self._last_signature = signature

            self._state.session_uid = routed.header.session_uid
            self._state.packet_format = routed.header.packet_format
            self._state.packet_version = routed.header.packet_version
            self._state.last_frame_identifier = routed.header.frame_identifier
            self._state.player_car_index = routed.header.player_car_index
            self._state.ingest_stats.packets_decoded += 1
            self._state.ingest_stats.last_packet_type = routed.decoded.kind

            payload = routed.decoded.payload
            if routed.decoded.kind == "motion":
                minimap_dict = self._minimap.update(payload.cars, routed.header.player_car_index)
                self._state.minimap.mode = minimap_dict["mode"]
                self._state.minimap.player_car_index = minimap_dict["player_car_index"]
                self._state.minimap.cars = minimap_dict["cars"]
                self._state.minimap.track_trace = minimap_dict["track_trace"]
                self._state.minimap.transform = minimap_dict["transform"]
            elif routed.decoded.kind == "session":
                self._state.track = f"TRACK_{payload.track_id}"
                self._state.session_type = f"SESSION_{payload.session_type}"
                self._state.race_control_state = f"SC_{payload.safety_car_status}"
            elif routed.decoded.kind == "lap_data":
                for entry in payload.cars:
                    car = self._ensure_car(entry.car_index)
                    car.position = entry.car_position
                    car.current_lap = entry.current_lap_num
                    car.current_lap_ms = entry.current_lap_time_ms
                    car.last_lap_ms = entry.last_lap_time_ms
                player_entry = self._state.cars.get(self._state.player_car_index)
                if player_entry:
                    self._state.player.position = player_entry.position
                    self._state.player.lap = player_entry.current_lap
                    self._state.player.current_lap_ms = player_entry.current_lap_ms
                    self._state.player.last_lap_ms = player_entry.last_lap_ms
            elif routed.decoded.kind == "event":
                self._state.last_event_summary = payload.event_code
            elif routed.decoded.kind == "car_telemetry":
                self._state.player.ers = payload.player.ers_store_energy
            elif routed.decoded.kind == "car_status":
                self._state.player.fuel = payload.player.fuel_in_tank
                self._state.player.ers = payload.player.ers_store_energy
                compound = f"C{payload.player.visual_tyre_compound}"
                self._state.player.tyre_compound = compound
                player_car = self._ensure_car(self._state.player_car_index)
                player_car.tyre_compound = compound

            self._rebuild_leaderboard()
            self._rebuild_pace()
            self._rebuild_strategy()

            self._state.touch()
            return asdict(self._state)

    def snapshot(self) -> dict:
        with self._lock:
            return asdict(self._state)
