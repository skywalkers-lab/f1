"""
State Aggregator — Lap / Stint / Race level state accumulation.
================================================================
Transforms raw packet-level data into meaningful race context:
  - Per-lap snapshots with sector times and deltas
  - Stint tracking (compound, wear curve, degradation rate)
  - Race-level cumulative data for trend analysis
  - Fuel burn curve with per-lap consumption tracking
  - Tyre wear trajectory per stint
"""

from __future__ import annotations
import time
from dataclasses import dataclass, field
from collections import deque


@dataclass
class LapSnapshot:
    """Complete state capture at the end of a lap."""
    lap_number: int
    lap_time_ms: int
    delta_to_best_ms: int = 0
    sector1_ms: int = 0
    sector2_ms: int = 0
    sector3_ms: int = 0
    tyre_compound: str = "UNK"
    tyre_age: int = 0
    tyre_wear_pct: float = 0.0
    fuel_kg: float = 0.0
    fuel_consumed_kg: float = 0.0
    ers_level_norm: float = 0.0
    position: int = 0
    gap_ahead_s: float = 0.0
    gap_behind_s: float = 0.0
    speed_trap_kph: int = 0
    is_personal_best: bool = False
    weather_state: str = "WEATHER_0"
    timestamp: float = 0.0


@dataclass
class StintData:
    """Aggregated data for a single tyre stint."""
    stint_number: int
    start_lap: int
    end_lap: int = 0
    compound: str = "UNK"
    laps: list[LapSnapshot] = field(default_factory=list)
    avg_lap_ms: int = 0
    best_lap_ms: int = 0
    degradation_rate_ms_per_lap: float = 0.0
    total_wear_pct: float = 0.0
    initial_fuel_kg: float = 0.0
    final_fuel_kg: float = 0.0
    is_active: bool = True

    def add_lap(self, snap: LapSnapshot) -> None:
        self.laps.append(snap)
        self.end_lap = snap.lap_number
        valid_times = [l.lap_time_ms for l in self.laps if l.lap_time_ms > 0]
        if valid_times:
            self.best_lap_ms = min(valid_times)
            self.avg_lap_ms = sum(valid_times) // len(valid_times)
        if len(self.laps) >= 2:
            self.total_wear_pct = snap.tyre_wear_pct
            self.final_fuel_kg = snap.fuel_kg
            # Degradation rate: average lap time increase per lap
            if len(valid_times) >= 3:
                first_third = valid_times[:len(valid_times) // 3]
                last_third = valid_times[-len(valid_times) // 3:]
                if first_third and last_third:
                    avg_first = sum(first_third) / len(first_third)
                    avg_last = sum(last_third) / len(last_third)
                    stint_laps = max(1, len(valid_times))
                    self.degradation_rate_ms_per_lap = (avg_last - avg_first) / stint_laps

    def to_dict(self) -> dict:
        return {
            "stint_number": self.stint_number,
            "start_lap": self.start_lap,
            "end_lap": self.end_lap,
            "compound": self.compound,
            "lap_count": len(self.laps),
            "avg_lap_ms": self.avg_lap_ms,
            "best_lap_ms": self.best_lap_ms,
            "degradation_rate_ms_per_lap": round(self.degradation_rate_ms_per_lap, 1),
            "total_wear_pct": round(self.total_wear_pct, 1),
            "initial_fuel_kg": round(self.initial_fuel_kg, 3),
            "final_fuel_kg": round(self.final_fuel_kg, 3),
            "is_active": self.is_active,
        }


@dataclass
class FuelBurnPoint:
    lap: int
    fuel_kg: float
    consumed_this_lap: float


@dataclass
class TyreWearPoint:
    lap: int
    wear_pct: float
    compound: str
    stint_number: int


@dataclass
class OpponentStint:
    """Tracks an opponent's stint data for strategy inference."""
    car_index: int
    stint_number: int
    start_lap: int
    end_lap: int = 0
    compound: str = "UNK"
    is_active: bool = True
    lap_times_ms: list[int] = field(default_factory=list)
    avg_pace_ms: int = 0
    degradation_rate_ms: float = 0.0

    def add_lap(self, lap_time_ms: int) -> None:
        if lap_time_ms > 0:
            self.lap_times_ms.append(lap_time_ms)
            self.avg_pace_ms = sum(self.lap_times_ms) // len(self.lap_times_ms)
            if len(self.lap_times_ms) >= 3:
                n = len(self.lap_times_ms)
                first = sum(self.lap_times_ms[:n // 3]) / max(1, n // 3)
                last = sum(self.lap_times_ms[-n // 3:]) / max(1, n // 3)
                self.degradation_rate_ms = (last - first) / max(1, n)

    def to_dict(self) -> dict:
        return {
            "car_index": self.car_index,
            "stint_number": self.stint_number,
            "start_lap": self.start_lap,
            "end_lap": self.end_lap,
            "compound": self.compound,
            "lap_count": len(self.lap_times_ms),
            "avg_pace_ms": self.avg_pace_ms,
            "degradation_rate_ms": round(self.degradation_rate_ms, 1),
            "is_active": self.is_active,
        }


@dataclass
class SectorBests:
    """Track best sector times for delta calculations."""
    sector1_ms: int = 0
    sector2_ms: int = 0
    sector3_ms: int = 0

    def update(self, s1: int, s2: int, s3: int) -> None:
        if s1 > 0 and (self.sector1_ms == 0 or s1 < self.sector1_ms):
            self.sector1_ms = s1
        if s2 > 0 and (self.sector2_ms == 0 or s2 < self.sector2_ms):
            self.sector2_ms = s2
        if s3 > 0 and (self.sector3_ms == 0 or s3 < self.sector3_ms):
            self.sector3_ms = s3


@dataclass
class RaceAggregateState:
    """Full race-level aggregated state."""
    total_laps_completed: int = 0
    stints: list[StintData] = field(default_factory=list)
    lap_history: list[LapSnapshot] = field(default_factory=list)
    fuel_curve: list[FuelBurnPoint] = field(default_factory=list)
    tyre_wear_curve: list[TyreWearPoint] = field(default_factory=list)
    best_lap_ms: int = 0
    best_lap_number: int = 0
    avg_pace_ms: int = 0
    pace_trend: str = "stable"  # improving | stable | degrading
    fuel_delta_per_lap: float = 0.0
    total_pit_stops: int = 0
    safety_car_laps: int = 0
    vsc_laps: int = 0
    # Per-car opponent tracking for gap analysis
    opponent_histories: dict[int, list[dict]] = field(default_factory=dict)
    # Enhanced: opponent stint tracking for strategy inference
    opponent_stints: dict[int, list[OpponentStint]] = field(default_factory=dict)
    # Enhanced: sector-level bests
    sector_bests: SectorBests = field(default_factory=SectorBests)


class StateAggregator:
    """
    Accumulates raw state updates into structured Lap / Stint / Race data.

    The aggregator watches for lap transitions and stint changes to build
    a complete race narrative from the stream of packet updates.
    """

    def __init__(self) -> None:
        self._state = RaceAggregateState()
        self._current_lap: int = 0
        self._current_compound: str = "UNK"
        self._last_fuel_kg: float = 0.0
        self._pit_this_frame: bool = False
        self._recent_lap_times: deque[int] = deque(maxlen=10)
        self._opponent_compounds: dict[int, str] = {}  # car_index → last known compound

    @property
    def aggregate(self) -> RaceAggregateState:
        return self._state

    def on_lap_change(
        self,
        new_lap: int,
        lap_time_ms: int,
        tyre_compound: str,
        tyre_age: int,
        tyre_wear_pct: float,
        fuel_kg: float,
        ers_norm: float,
        position: int,
        gap_ahead_s: float,
        gap_behind_s: float,
        weather_state: str,
        sector1_ms: int = 0,
        sector2_ms: int = 0,
        sector3_ms: int = 0,
    ) -> None:
        """Called when the player completes a lap (lap number increases)."""
        if new_lap <= self._current_lap:
            return  # Not a real advancement

        now = time.monotonic()

        # Calculate fuel consumed
        fuel_consumed = max(0.0, self._last_fuel_kg - fuel_kg) if self._last_fuel_kg > 0 else 0.0

        # Build snapshot
        snap = LapSnapshot(
            lap_number=new_lap - 1,  # Completed lap
            lap_time_ms=lap_time_ms,
            sector1_ms=sector1_ms,
            sector2_ms=sector2_ms,
            sector3_ms=sector3_ms,
            tyre_compound=tyre_compound,
            tyre_age=tyre_age,
            tyre_wear_pct=tyre_wear_pct,
            fuel_kg=fuel_kg,
            fuel_consumed_kg=fuel_consumed,
            ers_level_norm=ers_norm,
            position=position,
            gap_ahead_s=gap_ahead_s,
            gap_behind_s=gap_behind_s,
            weather_state=weather_state,
            timestamp=now,
        )

        # Track best lap
        if lap_time_ms > 0:
            if self._state.best_lap_ms == 0 or lap_time_ms < self._state.best_lap_ms:
                self._state.best_lap_ms = lap_time_ms
                self._state.best_lap_number = new_lap - 1
                snap.is_personal_best = True
            snap.delta_to_best_ms = lap_time_ms - self._state.best_lap_ms

        # Update sector bests
        self._state.sector_bests.update(sector1_ms, sector2_ms, sector3_ms)

        self._state.lap_history.append(snap)
        self._state.total_laps_completed = new_lap - 1

        # Fuel curve
        self._state.fuel_curve.append(FuelBurnPoint(
            lap=new_lap - 1,
            fuel_kg=fuel_kg,
            consumed_this_lap=fuel_consumed,
        ))

        # Update rolling fuel delta
        if len(self._state.fuel_curve) >= 2:
            recent_burns = [p.consumed_this_lap for p in self._state.fuel_curve[-5:] if p.consumed_this_lap > 0]
            if recent_burns:
                self._state.fuel_delta_per_lap = sum(recent_burns) / len(recent_burns)

        # Tyre wear curve
        self._state.tyre_wear_curve.append(TyreWearPoint(
            lap=new_lap - 1,
            wear_pct=tyre_wear_pct,
            compound=tyre_compound,
            stint_number=len(self._state.stints),
        ))

        # Stint management
        if not self._state.stints or self._current_compound != tyre_compound:
            self._start_new_stint(new_lap - 1, tyre_compound, fuel_kg)
        elif tyre_age == 1 and self._current_lap > 1:
            # Tyre age reset = pit stop happened
            self._start_new_stint(new_lap - 1, tyre_compound, fuel_kg)

        if self._state.stints:
            self._state.stints[-1].add_lap(snap)

        # Pace trend analysis
        if lap_time_ms > 0:
            self._recent_lap_times.append(lap_time_ms)
        self._update_pace_trend()

        # Update tracking vars
        self._current_lap = new_lap
        self._current_compound = tyre_compound
        self._last_fuel_kg = fuel_kg

    def on_pit_stop(self) -> None:
        """Called when player enters pits."""
        self._state.total_pit_stops += 1
        if self._state.stints:
            self._state.stints[-1].is_active = False

    def on_safety_car(self, sc_type: str) -> None:
        """Track safety car laps."""
        if sc_type == "SC":
            self._state.safety_car_laps += 1
        elif sc_type == "VSC":
            self._state.vsc_laps += 1

    def on_opponent_update(self, car_index: int, position: int, lap: int,
                           last_lap_ms: int, gap_to_leader_ms: int,
                           compound: str = "UNK") -> None:
        """Track opponent position changes for gap trend analysis."""
        if car_index not in self._state.opponent_histories:
            self._state.opponent_histories[car_index] = []
        history = self._state.opponent_histories[car_index]
        # Only append if lap has changed for this car
        if not history or history[-1].get("lap") != lap:
            history.append({
                "lap": lap,
                "position": position,
                "last_lap_ms": last_lap_ms,
                "gap_to_leader_ms": gap_to_leader_ms,
                "compound": compound,
            })
            # Keep last 30 entries
            if len(history) > 30:
                self._state.opponent_histories[car_index] = history[-30:]

        # Track opponent stints
        self._track_opponent_stint(car_index, lap, last_lap_ms, compound)

    def to_dict(self) -> dict:
        """Export aggregate state for API/WebSocket."""
        return {
            "total_laps_completed": self._state.total_laps_completed,
            "stints": [s.to_dict() for s in self._state.stints],
            "fuel_delta_per_lap": round(self._state.fuel_delta_per_lap, 3),
            "best_lap_ms": self._state.best_lap_ms,
            "best_lap_number": self._state.best_lap_number,
            "avg_pace_ms": self._state.avg_pace_ms,
            "pace_trend": self._state.pace_trend,
            "total_pit_stops": self._state.total_pit_stops,
            "safety_car_laps": self._state.safety_car_laps,
            "vsc_laps": self._state.vsc_laps,
            "sector_bests": {
                "sector1_ms": self._state.sector_bests.sector1_ms,
                "sector2_ms": self._state.sector_bests.sector2_ms,
                "sector3_ms": self._state.sector_bests.sector3_ms,
            },
            "fuel_curve": [
                {"lap": p.lap, "fuel_kg": round(p.fuel_kg, 3), "consumed": round(p.consumed_this_lap, 3)}
                for p in self._state.fuel_curve[-20:]  # Last 20 laps
            ],
            "tyre_wear_curve": [
                {"lap": p.lap, "wear_pct": round(p.wear_pct, 1), "compound": p.compound, "stint": p.stint_number}
                for p in self._state.tyre_wear_curve[-30:]
            ],
            "lap_history": [
                {
                    "lap": s.lap_number,
                    "time_ms": s.lap_time_ms,
                    "delta_to_best_ms": s.delta_to_best_ms,
                    "sector1_ms": s.sector1_ms,
                    "sector2_ms": s.sector2_ms,
                    "sector3_ms": s.sector3_ms,
                    "compound": s.tyre_compound,
                    "wear_pct": round(s.tyre_wear_pct, 1),
                    "fuel_kg": round(s.fuel_kg, 3),
                    "position": s.position,
                    "is_pb": s.is_personal_best,
                }
                for s in self._state.lap_history[-30:]
            ],
            "opponent_stints": {
                str(car_idx): [s.to_dict() for s in stints]
                for car_idx, stints in self._state.opponent_stints.items()
            },
        }

    def _start_new_stint(self, lap: int, compound: str, fuel_kg: float) -> None:
        if self._state.stints:
            self._state.stints[-1].is_active = False
        stint = StintData(
            stint_number=len(self._state.stints) + 1,
            start_lap=lap,
            compound=compound,
            initial_fuel_kg=fuel_kg,
        )
        self._state.stints.append(stint)
        self._current_compound = compound

    def _track_opponent_stint(self, car_index: int, lap: int, lap_time_ms: int, compound: str) -> None:
        """Track opponent stint changes for strategy inference."""
        if compound == "UNK":
            return

        if car_index not in self._state.opponent_stints:
            self._state.opponent_stints[car_index] = []

        stints = self._state.opponent_stints[car_index]
        prev_compound = self._opponent_compounds.get(car_index, "UNK")

        # Detect stint change (compound change)
        if prev_compound != compound and prev_compound != "UNK":
            if stints and stints[-1].is_active:
                stints[-1].is_active = False
                stints[-1].end_lap = lap - 1
            new_stint = OpponentStint(
                car_index=car_index,
                stint_number=len(stints) + 1,
                start_lap=lap,
                compound=compound,
            )
            stints.append(new_stint)
        elif not stints:
            stints.append(OpponentStint(
                car_index=car_index,
                stint_number=1,
                start_lap=lap,
                compound=compound,
            ))

        self._opponent_compounds[car_index] = compound

        # Add lap time to active stint
        if stints and stints[-1].is_active:
            stints[-1].add_lap(lap_time_ms)
            stints[-1].end_lap = lap

    def _update_pace_trend(self) -> None:
        times = list(self._recent_lap_times)
        valid = [t for t in times if t > 0]
        if len(valid) < 4:
            self._state.pace_trend = "stable"
            self._state.avg_pace_ms = sum(valid) // len(valid) if valid else 0
            return

        self._state.avg_pace_ms = sum(valid) // len(valid)

        # Compare first half vs second half
        mid = len(valid) // 2
        first_avg = sum(valid[:mid]) / mid
        second_avg = sum(valid[mid:]) / (len(valid) - mid)
        delta_ms = second_avg - first_avg

        if delta_ms < -200:
            self._state.pace_trend = "improving"
        elif delta_ms > 300:
            self._state.pace_trend = "degrading"
        else:
            self._state.pace_trend = "stable"
