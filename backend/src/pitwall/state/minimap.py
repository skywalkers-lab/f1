from collections import deque
from dataclasses import dataclass
from pitwall.decoders.models import CarMotionData
from pitwall.state.track_definitions import (
    TrackLookup, build_track_lookup, get_track_def, snap_to_track, ratio_to_point,
)


@dataclass(frozen=True)
class MinimapPoint:
    x: float
    y: float


class MinimapTransformer:
    """
    Transforms raw world coordinates into minimap display coordinates.

    When a reference track definition is available, cars are snapped to the
    pre-defined circuit geometry. Otherwise, falls back to live-trace mode
    using UDP coordinates directly.
    """

    def __init__(self) -> None:
        self._trace_world: deque[tuple[float, float]] = deque(maxlen=3000)
        self._seen_cells: set[tuple[int, int]] = set()
        self._track_lookup: TrackLookup | None = None
        self._current_track_id: str = ""

    def set_track(self, track_id: str) -> None:
        """Load reference track geometry if available."""
        if track_id == self._current_track_id:
            return
        self._current_track_id = track_id
        track_def = get_track_def(track_id)
        if track_def is not None:
            self._track_lookup = build_track_lookup(track_def)
            # Clear live trace when switching to reference track
            self._trace_world.clear()
            self._seen_cells.clear()
        else:
            self._track_lookup = None

    def _add_trace_sample(self, x: float, z: float) -> None:
        key = (int(x / 5.0), int(z / 5.0))
        if key in self._seen_cells:
            return
        self._seen_cells.add(key)
        self._trace_world.append((x, z))

    def _bounds(self, cars: list[CarMotionData]) -> tuple[float, float, float, float]:
        xs = [c.world_position_x for c in cars]
        zs = [c.world_position_z for c in cars]
        if self._trace_world:
            trace_x, trace_z = zip(*self._trace_world)
            xs.extend(trace_x)
            zs.extend(trace_z)

        min_x = min(xs) if xs else -1.0
        max_x = max(xs) if xs else 1.0
        min_z = min(zs) if zs else -1.0
        max_z = max(zs) if zs else 1.0

        if max_x - min_x < 1.0:
            max_x += 1.0
            min_x -= 1.0
        if max_z - min_z < 1.0:
            max_z += 1.0
            min_z -= 1.0

        return min_x, max_x, min_z, max_z

    @staticmethod
    def _normalize(x: float, z: float, min_x: float, max_x: float, min_z: float, max_z: float) -> MinimapPoint:
        nx = (x - min_x) / (max_x - min_x)
        ny = (z - min_z) / (max_z - min_z)
        return MinimapPoint(x=max(0.0, min(1.0, nx)), y=max(0.0, min(1.0, ny)))

    @staticmethod
    def _find_player_car(cars: list[CarMotionData], player_index: int) -> CarMotionData | None:
        for car in cars:
            if car.car_index == player_index:
                return car
        return cars[0] if cars else None

    def update(self, cars: list[CarMotionData], player_index: int, car_states: dict | None = None) -> dict:
        # Use reference track if available
        if self._track_lookup is not None and self._track_lookup.spline:
            return self._update_with_reference(cars, player_index, car_states)
        return self._update_live_trace(cars, player_index, car_states)

    def _update_with_reference(self, cars: list[CarMotionData], player_index: int,
                               car_states: dict | None = None) -> dict:
        """Project car positions onto reference track geometry."""
        lookup = self._track_lookup
        defn = lookup.definition

        # Build track trace from spline (pre-defined, not from UDP)
        trace = [{"x": pt.x, "y": pt.y} for pt in lookup.spline[::5]]  # Sample every 5th point

        # Snap cars to track
        world_cars = []
        for car in cars:
            snapped_x, snapped_y, ratio = snap_to_track(
                lookup, car.world_position_x, car.world_position_z
            )
            car_state = car_states.get(car.car_index) if car_states else None
            world_cars.append({
                "car_index": car.car_index,
                "x": snapped_x,
                "y": snapped_y,
                "world_x": car.world_position_x,
                "world_z": car.world_position_z,
                "lap_distance_ratio": ratio,
                "is_pitting": bool(car_state.is_pitting) if car_state else False,
            })

        # DRS zones as polyline segments
        drs_zones = []
        for dz in defn.drs_zones:
            start_pt = ratio_to_point(lookup, dz.start_ratio)
            end_pt = ratio_to_point(lookup, dz.end_ratio)
            drs_zones.append({
                "start_ratio": dz.start_ratio,
                "end_ratio": dz.end_ratio,
                "detection_ratio": dz.detection_ratio,
                "label": dz.label,
                "start_x": start_pt[0],
                "start_y": start_pt[1],
                "end_x": end_pt[0],
                "end_y": end_pt[1],
            })

        # Pit entry/exit markers
        pit_entry = ratio_to_point(lookup, defn.pit_entry_ratio)
        pit_exit = ratio_to_point(lookup, defn.pit_exit_ratio)

        min_x, max_x, min_y, max_y = lookup.bounds
        padding = 20
        return {
            "mode": "reference_track",
            "player_car_index": player_index,
            "cars": world_cars,
            "track_trace": trace,
            "drs_zones": drs_zones,
            "sectors": list(defn.sectors),
            "pit_lane": {
                "entry": {"x": pit_entry[0], "y": pit_entry[1], "ratio": defn.pit_entry_ratio},
                "exit": {"x": pit_exit[0], "y": pit_exit[1], "ratio": defn.pit_exit_ratio},
            },
            "track_name": defn.display_name,
            "track_length_m": defn.length_m,
            "transform": {
                "min_x": min_x - padding,
                "max_x": max_x + padding,
                "min_z": min_y - padding,
                "max_z": max_y + padding,
            },
        }

    def _update_live_trace(self, cars: list[CarMotionData], player_index: int,
                           car_states: dict | None = None) -> dict:
        """Fallback: use raw UDP coordinates when no reference track is available."""
        if cars:
            player = self._find_player_car(cars, player_index)
            if player is not None:
                self._add_trace_sample(player.world_position_x, player.world_position_z)

        min_x, max_x, min_z, max_z = self._bounds(cars)
        world_cars = []
        for car in cars:
            car_state = car_states.get(car.car_index) if car_states else None
            pt = self._normalize(car.world_position_x, car.world_position_z, min_x, max_x, min_z, max_z)
            world_cars.append({
                "car_index": car.car_index,
                "x": car.world_position_x,
                "y": car.world_position_z,
                "nx": pt.x,
                "ny": pt.y,
                "is_pitting": bool(car_state.is_pitting) if car_state else False,
            })

        trace = []
        for tx, tz in self._trace_world:
            trace.append({"x": tx, "y": tz})

        return {
            "mode": "live_trace",
            "player_car_index": player_index,
            "cars": world_cars,
            "track_trace": trace,
            "drs_zones": [],
            "transform": {
                "min_x": min_x,
                "max_x": max_x,
                "min_z": min_z,
                "max_z": max_z,
            },
        }
