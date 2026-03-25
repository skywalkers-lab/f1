"""
Track Definitions — Reference circuit geometry for the minimap.
================================================================
Each circuit is defined by:
  - A polyline of (x, y) control points representing the track centre-line
  - Sector split ratios (FIA data)
  - DRS zones with start/end/detection ratios
  - Pit lane entry/exit ratios
  - Track length in metres

These are FIXED data — not derived from UDP coordinates.
UDP positions are projected ONTO these paths, not used to define them.
"""

from __future__ import annotations
import math
from dataclasses import dataclass, field


@dataclass(frozen=True)
class DRSZoneDef:
    start_ratio: float
    end_ratio: float
    detection_ratio: float
    label: str


@dataclass(frozen=True)
class TrackDef:
    track_id: str
    display_name: str
    length_m: float
    # Polyline control points normalised to a 0-500 coordinate system
    polyline: list[tuple[float, float]]
    sectors: tuple[float, float]  # S1/S2 boundary ratios
    drs_zones: list[DRSZoneDef]
    pit_entry_ratio: float
    pit_exit_ratio: float


@dataclass
class SplinePoint:
    x: float
    y: float
    ratio: float  # 0-1 arc-length parameterisation
    dist: float   # cumulative distance from start


@dataclass
class TrackLookup:
    """Pre-computed lookup table for snap-to-track queries."""
    definition: TrackDef
    spline: list[SplinePoint]
    total_length: float
    bounds: tuple[float, float, float, float]  # min_x, max_x, min_y, max_y


# ── Circuit Definitions ────────────────────────────────

_BAHRAIN = TrackDef(
    track_id="TRACK_3",
    display_name="Bahrain International Circuit",
    length_m=5412,
    polyline=[
        (200, 470), (400, 470), (460, 445), (470, 390), (460, 350), (440, 300),
        (395, 270), (350, 260), (300, 240), (270, 200), (270, 150), (285, 110),
        (280, 58), (235, 42), (200, 70), (190, 120), (165, 170), (120, 215),
        (70, 270), (45, 340), (55, 415), (110, 462), (200, 470),
    ],
    sectors=(0.33, 0.66),
    drs_zones=[
        DRSZoneDef(0.00, 0.07, 0.93, "DRS1"),
        DRSZoneDef(0.33, 0.42, 0.27, "DRS2"),
        DRSZoneDef(0.65, 0.73, 0.59, "DRS3"),
    ],
    pit_entry_ratio=0.88,
    pit_exit_ratio=0.97,
)

_JEDDAH = TrackDef(
    track_id="TRACK_4",
    display_name="Jeddah Corniche Circuit",
    length_m=6174,
    polyline=[
        (60, 480), (60, 300), (80, 230), (140, 175), (220, 150), (300, 150),
        (380, 130), (430, 75), (460, 40), (490, 50), (490, 100), (455, 155),
        (400, 195), (350, 215), (300, 250), (280, 305), (280, 380), (300, 445),
        (360, 475), (440, 480), (485, 465), (490, 420), (455, 390), (380, 385),
        (310, 400), (260, 440), (200, 478), (120, 485), (60, 480),
    ],
    sectors=(0.33, 0.66),
    drs_zones=[
        DRSZoneDef(0.01, 0.08, 0.94, "DRS1"),
        DRSZoneDef(0.48, 0.56, 0.42, "DRS2"),
        DRSZoneDef(0.72, 0.80, 0.66, "DRS3"),
    ],
    pit_entry_ratio=0.88,
    pit_exit_ratio=0.97,
)

_MONACO = TrackDef(
    track_id="TRACK_2",
    display_name="Circuit de Monaco",
    length_m=3337,
    polyline=[
        (120, 460), (280, 460), (320, 440), (340, 380), (360, 340), (400, 270),
        (410, 210), (370, 170), (340, 140), (310, 100), (260, 100), (235, 140),
        (215, 190), (170, 220), (100, 250), (50, 310), (50, 360), (80, 370),
        (100, 350), (90, 310), (60, 300), (30, 360), (40, 410), (75, 450),
        (120, 460),
    ],
    sectors=(0.32, 0.69),
    drs_zones=[DRSZoneDef(0.43, 0.50, 0.37, "DRS1")],
    pit_entry_ratio=0.84,
    pit_exit_ratio=0.97,
)

_SPA = TrackDef(
    track_id="TRACK_1",
    display_name="Circuit de Spa-Francorchamps",
    length_m=7004,
    polyline=[
        (80, 400), (200, 400), (245, 380), (245, 335), (200, 325), (160, 340),
        (100, 390), (60, 370), (20, 335), (20, 275), (60, 220), (130, 180),
        (200, 155), (265, 130), (300, 90), (295, 55), (260, 50), (230, 75),
        (210, 120), (180, 155), (120, 185), (120, 225), (160, 270), (230, 310),
        (290, 340), (360, 370), (430, 375), (480, 355), (480, 315), (440, 290),
        (370, 295), (320, 340), (260, 378), (180, 398), (80, 400),
    ],
    sectors=(0.33, 0.66),
    drs_zones=[
        DRSZoneDef(0.05, 0.14, 0.97, "DRS1"),
        DRSZoneDef(0.58, 0.67, 0.53, "DRS2"),
    ],
    pit_entry_ratio=0.86,
    pit_exit_ratio=0.96,
)

_MONZA = TrackDef(
    track_id="TRACK_15",
    display_name="Autodromo Nazionale Monza",
    length_m=5793,
    polyline=[
        (250, 480), (430, 480), (475, 460), (480, 420), (450, 385), (350, 330),
        (260, 260), (235, 210), (200, 170), (165, 180), (155, 200), (155, 270),
        (130, 320), (100, 370), (55, 460), (55, 490), (100, 490), (150, 465),
        (200, 445), (240, 445), (250, 460), (250, 480),
    ],
    sectors=(0.37, 0.67),
    drs_zones=[
        DRSZoneDef(0.11, 0.17, 0.05, "DRS1"),
        DRSZoneDef(0.62, 0.71, 0.56, "DRS2"),
    ],
    pit_entry_ratio=0.90,
    pit_exit_ratio=0.98,
)

_SILVERSTONE = TrackDef(
    track_id="TRACK_11",
    display_name="Silverstone Circuit",
    length_m=5891,
    polyline=[
        (250, 460), (400, 460), (460, 440), (470, 395), (435, 360), (380, 345),
        (330, 320), (300, 275), (305, 228), (345, 200), (400, 185), (455, 160),
        (475, 110), (455, 70), (400, 50), (320, 50), (260, 65), (220, 100),
        (175, 145), (110, 190), (55, 260), (40, 330), (60, 390), (120, 440),
        (200, 460), (250, 460),
    ],
    sectors=(0.33, 0.66),
    drs_zones=[
        DRSZoneDef(0.01, 0.08, 0.94, "DRS1"),
        DRSZoneDef(0.52, 0.60, 0.47, "DRS2"),
    ],
    pit_entry_ratio=0.88,
    pit_exit_ratio=0.98,
)

_SUZUKA = TrackDef(
    track_id="TRACK_SUZUKA",
    display_name="Suzuka International Racing Course",
    length_m=5807,
    polyline=[
        (100, 350), (200, 350), (270, 330), (330, 280), (380, 215), (400, 165),
        (390, 120), (355, 95), (310, 100), (275, 135), (250, 185), (220, 235),
        (170, 270), (120, 300), (80, 350), (65, 410), (80, 465), (130, 478),
        (210, 460), (310, 415), (390, 370), (430, 320), (425, 275), (385, 265),
        (350, 290), (320, 328), (250, 355), (150, 355), (100, 350),
    ],
    sectors=(0.34, 0.68),
    drs_zones=[
        DRSZoneDef(0.00, 0.07, 0.94, "DRS1"),
        DRSZoneDef(0.58, 0.66, 0.53, "DRS2"),
    ],
    pit_entry_ratio=0.90,
    pit_exit_ratio=0.98,
)


# ── Registry ───────────────────────────────────────────

TRACK_REGISTRY: dict[str, TrackDef] = {
    _BAHRAIN.track_id: _BAHRAIN,
    _JEDDAH.track_id: _JEDDAH,
    _MONACO.track_id: _MONACO,
    _SPA.track_id: _SPA,
    _MONZA.track_id: _MONZA,
    _SILVERSTONE.track_id: _SILVERSTONE,
    _SUZUKA.track_id: _SUZUKA,
    # Aliases for name-based lookup
    "BAHRAIN": _BAHRAIN,
    "JEDDAH": _JEDDAH,
    "MONACO": _MONACO,
    "SPA": _SPA,
    "MONZA": _MONZA,
    "SILVERSTONE": _SILVERSTONE,
    "SUZUKA": _SUZUKA,
}


def get_track_def(track_id: str) -> TrackDef | None:
    """Look up track definition by ID. Case-insensitive, supports partial match."""
    if not track_id:
        return None
    key = track_id.upper()
    if key in TRACK_REGISTRY:
        return TRACK_REGISTRY[key]
    for reg_key, defn in TRACK_REGISTRY.items():
        if key in reg_key or reg_key in key:
            return defn
    return None


# ── Spline Construction ────────────────────────────────

def build_spline(polyline: list[tuple[float, float]], num_samples: int = 500) -> list[SplinePoint]:
    """Sample points evenly along the polyline using linear interpolation."""
    if len(polyline) < 2:
        return []

    # Calculate cumulative segment lengths
    segments: list[float] = []
    total = 0.0
    for i in range(1, len(polyline)):
        dx = polyline[i][0] - polyline[i - 1][0]
        dy = polyline[i][1] - polyline[i - 1][1]
        seg_len = math.hypot(dx, dy)
        segments.append(seg_len)
        total += seg_len

    if total < 1e-6:
        return []

    # Sample evenly
    result: list[SplinePoint] = []
    step = total / num_samples
    seg_idx = 0
    seg_consumed = 0.0

    for i in range(num_samples + 1):
        target_dist = i * step
        # Walk segments to find position
        while seg_idx < len(segments) - 1 and seg_consumed + segments[seg_idx] < target_dist:
            seg_consumed += segments[seg_idx]
            seg_idx += 1

        seg_len = segments[seg_idx]
        t = (target_dist - seg_consumed) / seg_len if seg_len > 1e-6 else 0.0
        t = max(0.0, min(1.0, t))

        x0, y0 = polyline[seg_idx]
        x1, y1 = polyline[seg_idx + 1]
        x = x0 + (x1 - x0) * t
        y = y0 + (y1 - y0) * t

        result.append(SplinePoint(
            x=x, y=y,
            ratio=i / num_samples,
            dist=target_dist,
        ))

    return result


def build_track_lookup(track_def: TrackDef) -> TrackLookup:
    """Build pre-computed lookup structure for a track."""
    spline = build_spline(track_def.polyline)
    if not spline:
        return TrackLookup(
            definition=track_def, spline=[], total_length=0.0,
            bounds=(0, 500, 0, 500),
        )

    xs = [p.x for p in spline]
    ys = [p.y for p in spline]
    total = spline[-1].dist if spline else 0.0

    return TrackLookup(
        definition=track_def,
        spline=spline,
        total_length=total,
        bounds=(min(xs), max(xs), min(ys), max(ys)),
    )


def snap_to_track(lookup: TrackLookup, world_x: float, world_z: float) -> tuple[float, float, float]:
    """
    Project a world coordinate onto the track spline.

    Returns (spline_x, spline_y, ratio) where ratio is the arc-length
    ratio (0-1) along the track.
    """
    if not lookup.spline:
        return (world_x, world_z, 0.0)

    best_dist_sq = float('inf')
    best_idx = 0

    for i, pt in enumerate(lookup.spline):
        dx = pt.x - world_x
        dy = pt.y - world_z
        d2 = dx * dx + dy * dy
        if d2 < best_dist_sq:
            best_dist_sq = d2
            best_idx = i

    best = lookup.spline[best_idx]
    return (best.x, best.y, best.ratio)


def ratio_to_point(lookup: TrackLookup, ratio: float) -> tuple[float, float]:
    """Get the (x, y) point at a given ratio along the track."""
    if not lookup.spline:
        return (250.0, 250.0)

    ratio = max(0.0, min(1.0, ratio))
    target_idx = int(ratio * (len(lookup.spline) - 1))
    pt = lookup.spline[target_idx]
    return (pt.x, pt.y)
