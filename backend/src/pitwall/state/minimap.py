from collections import deque
from dataclasses import dataclass
from pitwall.decoders.models import CarMotionData


@dataclass(frozen=True)
class MinimapPoint:
    x: float
    y: float


class MinimapTransformer:
    def __init__(self) -> None:
        self._trace_world: deque[tuple[float, float]] = deque(maxlen=3000)
        self._seen_cells: set[tuple[int, int]] = set()

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

    def update(self, cars: list[CarMotionData], player_index: int) -> dict:
        if cars:
            for car in cars:
                self._add_trace_sample(car.world_position_x, car.world_position_z)

        min_x, max_x, min_z, max_z = self._bounds(cars)
        normalized_cars = []
        for car in cars:
            p = self._normalize(car.world_position_x, car.world_position_z, min_x, max_x, min_z, max_z)
            normalized_cars.append({"car_index": car.car_index, "x": p.x, "y": p.y})

        trace = []
        for tx, tz in self._trace_world:
            p = self._normalize(tx, tz, min_x, max_x, min_z, max_z)
            trace.append({"x": p.x, "y": p.y})

        return {
            "mode": "live_trace",
            "player_car_index": player_index,
            "cars": normalized_cars,
            "track_trace": trace,
            "transform": {
                "min_x": min_x,
                "max_x": max_x,
                "min_z": min_z,
                "max_z": max_z,
            },
        }
