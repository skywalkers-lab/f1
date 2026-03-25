"""
Vehicle Setup Recommendation Engine.

Analyses real-time telemetry to detect understeer/oversteer tendencies and
recommends setup adjustments. Provides both circuit-based presets and dynamic
corrections driven by measured driving data.
"""
import logging
import math
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)

# ── Circuit base presets ─────────────────
# Each preset is a baseline starting point; the dynamic engine adjusts from here.
# Values are normalized 0-100 scale matching F1 25 setup ranges.

CIRCUIT_PRESETS: dict[str, dict[str, Any]] = {
    "TRACK_0": {  # Melbourne / Albert Park
        "name": "Albert Park",
        "front_wing": 38, "rear_wing": 34,
        "diff_on": 65, "diff_off": 55,
        "front_suspension": 6, "rear_suspension": 5,
        "front_anti_roll": 6, "rear_anti_roll": 5,
        "front_ride_height": 3, "rear_ride_height": 5,
        "front_camber": -3.0, "rear_camber": -1.5,
        "front_toe": 0.07, "rear_toe": 0.30,
        "brake_bias": 57.0,
        "notes": "Mixed speed circuit. Balance between straight speed and sector 3 traction.",
    },
    "TRACK_1": {  # Circuit de Spa-Francorchamps
        "name": "Spa-Francorchamps",
        "front_wing": 28, "rear_wing": 30,
        "diff_on": 70, "diff_off": 60,
        "front_suspension": 5, "rear_suspension": 4,
        "front_anti_roll": 5, "rear_anti_roll": 4,
        "front_ride_height": 2, "rear_ride_height": 4,
        "front_camber": -2.8, "rear_camber": -1.2,
        "front_toe": 0.06, "rear_toe": 0.25,
        "brake_bias": 56.0,
        "notes": "Low downforce. Eau Rouge requires rear stability. Long straights.",
    },
    "TRACK_2": {  # Monaco
        "name": "Monaco",
        "front_wing": 50, "rear_wing": 50,
        "diff_on": 55, "diff_off": 50,
        "front_suspension": 8, "rear_suspension": 7,
        "front_anti_roll": 8, "rear_anti_roll": 7,
        "front_ride_height": 2, "rear_ride_height": 3,
        "front_camber": -3.5, "rear_camber": -2.0,
        "front_toe": 0.09, "rear_toe": 0.35,
        "brake_bias": 58.0,
        "notes": "Maximum downforce. Sharp turn-in needed. Low-speed traction critical.",
    },
    "DEFAULT": {
        "name": "Generic Balanced",
        "front_wing": 35, "rear_wing": 33,
        "diff_on": 65, "diff_off": 55,
        "front_suspension": 6, "rear_suspension": 5,
        "front_anti_roll": 6, "rear_anti_roll": 5,
        "front_ride_height": 3, "rear_ride_height": 4,
        "front_camber": -3.0, "rear_camber": -1.5,
        "front_toe": 0.07, "rear_toe": 0.28,
        "brake_bias": 57.0,
        "notes": "Balanced baseline for unknown circuits.",
    },
}


@dataclass
class CornerPhaseAnalysis:
    """Understeer/oversteer metrics per corner phase."""
    entry_balance: float = 0.0   # negative = understeer, positive = oversteer
    mid_balance: float = 0.0
    exit_balance: float = 0.0
    severity: str = "neutral"    # "mild" | "moderate" | "severe" | "neutral"


@dataclass
class BalanceTrend:
    """Overall vehicle balance trend from recent telemetry."""
    understeer_score: float = 0.0      # 0-1 scale
    oversteer_score: float = 0.0       # 0-1 scale
    dominant_tendency: str = "neutral"  # "understeer" | "oversteer" | "neutral"
    corner_phases: CornerPhaseAnalysis = field(default_factory=CornerPhaseAnalysis)
    confidence: float = 0.0            # 0-1, how reliable the analysis is
    sample_count: int = 0


@dataclass
class SetupAdjustment:
    """A single recommended setup change."""
    parameter: str          # e.g. "front_wing", "brake_bias"
    current_value: float
    recommended_value: float
    delta: float
    reason: str
    priority: str = "medium"  # "low" | "medium" | "high"


@dataclass
class SetupRecommendation:
    """Complete setup recommendation output."""
    base_preset_name: str
    balance_trend: BalanceTrend
    adjustments: list[SetupAdjustment] = field(default_factory=list)
    current_setup: dict = field(default_factory=dict)
    recommended_setup: dict = field(default_factory=dict)
    summary: str = ""
    timestamp: float = 0.0


class BalanceAnalyser:
    """
    Analyses vehicle balance from telemetry snapshots.
    
    Understeer is detected when:
    - High steering angle + low yaw rate (front wheels losing grip)
    - Front tyre temps significantly higher than rear
    - Throttle applied but car not rotating
    
    Oversteer is detected when:
    - Rear tyre temps significantly higher than front
    - High yaw rate relative to steering input
    - Counter-steer corrections detected
    """

    def __init__(self) -> None:
        self._history: list[dict] = []
        self._max_history = 120  # 2 minutes of 1Hz data

    def add_sample(self, snapshot: dict) -> None:
        """Add a telemetry snapshot for balance analysis."""
        self._history.append(snapshot)
        if len(self._history) > self._max_history:
            self._history = self._history[-self._max_history:]

    def analyse(self) -> BalanceTrend:
        """Analyse accumulated telemetry for vehicle balance."""
        if len(self._history) < 10:
            return BalanceTrend(confidence=0.0, sample_count=len(self._history))

        understeer_signals = 0.0
        oversteer_signals = 0.0
        entry_balance_sum = 0.0
        mid_balance_sum = 0.0
        exit_balance_sum = 0.0
        corner_samples = 0
        total_samples = len(self._history)

        for i, snap in enumerate(self._history):
            speed = snap.get("speed", 0)
            throttle = snap.get("throttle", 0)
            brake = snap.get("brake", 0)
            gear = snap.get("gear", 0)

            front_temps = snap.get("tyre_surface_temps", [0, 0, 0, 0])
            rear_temps = front_temps  # share the 4-wheel array
            tyre_inner = snap.get("tyre_inner_temps", [0, 0, 0, 0])

            if len(front_temps) < 4:
                continue

            # Analyse front vs rear tyre temperature differential
            front_avg = (front_temps[0] + front_temps[1]) / 2.0
            rear_avg = (front_temps[2] + front_temps[3]) / 2.0
            temp_diff = front_avg - rear_avg  # positive = front hotter

            # Inner temps for grip analysis
            if len(tyre_inner) >= 4:
                inner_front_avg = (tyre_inner[0] + tyre_inner[1]) / 2.0
                inner_rear_avg = (tyre_inner[2] + tyre_inner[3]) / 2.0
                inner_diff = inner_front_avg - inner_rear_avg
            else:
                inner_diff = 0.0

            # Corner detection: medium speed + braking or partial throttle
            is_corner_zone = (
                (30 < speed < 250) and
                (brake > 0.1 or (throttle < 0.8 and gear < 6))
            )

            if is_corner_zone:
                corner_samples += 1

                # Temperature-based balance
                if temp_diff > 5:
                    understeer_signals += min(1.0, temp_diff / 20.0)
                elif temp_diff < -5:
                    oversteer_signals += min(1.0, abs(temp_diff) / 20.0)

                # Phase detection from throttle/brake patterns
                if brake > 0.3:
                    # Corner entry
                    entry_balance_sum += -temp_diff / 20.0  # neg=understeer
                elif throttle < 0.5:
                    # Mid corner
                    mid_balance_sum += -temp_diff / 20.0
                else:
                    # Corner exit (throttle applied)
                    exit_balance_sum += -temp_diff / 20.0
                    # Exit oversteer: rear hotter + high throttle
                    if temp_diff < -3 and throttle > 0.7:
                        oversteer_signals += 0.3

                # Inner temp differential (more conclusive)
                if inner_diff > 8:
                    understeer_signals += 0.2
                elif inner_diff < -8:
                    oversteer_signals += 0.2

        # Normalize
        if corner_samples == 0:
            return BalanceTrend(confidence=0.1, sample_count=total_samples)

        us_norm = min(1.0, understeer_signals / max(1, corner_samples))
        os_norm = min(1.0, oversteer_signals / max(1, corner_samples))

        if us_norm > os_norm + 0.15:
            dominant = "understeer"
        elif os_norm > us_norm + 0.15:
            dominant = "oversteer"
        else:
            dominant = "neutral"

        # Corner phase analysis
        avg_entry = entry_balance_sum / max(1, corner_samples)
        avg_mid = mid_balance_sum / max(1, corner_samples)
        avg_exit = exit_balance_sum / max(1, corner_samples)

        max_phase_val = max(abs(avg_entry), abs(avg_mid), abs(avg_exit))
        if max_phase_val < 0.1:
            severity = "neutral"
        elif max_phase_val < 0.3:
            severity = "mild"
        elif max_phase_val < 0.6:
            severity = "moderate"
        else:
            severity = "severe"

        confidence = min(1.0, corner_samples / 30.0)

        return BalanceTrend(
            understeer_score=round(us_norm, 3),
            oversteer_score=round(os_norm, 3),
            dominant_tendency=dominant,
            corner_phases=CornerPhaseAnalysis(
                entry_balance=round(avg_entry, 3),
                mid_balance=round(avg_mid, 3),
                exit_balance=round(avg_exit, 3),
                severity=severity,
            ),
            confidence=round(confidence, 3),
            sample_count=total_samples,
        )


class SetupRecommender:
    """
    Generates setup adjustment recommendations based on balance analysis.
    """

    # Adjustment rules: maps (tendency, phase) to parameter adjustments
    _UNDERSTEER_CORRECTIONS = {
        "front_wing": +2,         # Increase front downforce to add front grip and reduce understeer
        "rear_wing": +1,
        "diff_on": -5,            # Loosen diff on throttle for better rotation
        "diff_off": -5,           # Loosen diff off throttle for turn-in
        "front_suspension": -1,   # Softer front for more mechanical grip
        "front_anti_roll": -1,
        "brake_bias": -1.0,       # More rear braking to rotate the car
        "front_camber": -0.2,     # More negative camber for front grip
    }

    _OVERSTEER_CORRECTIONS = {
        "rear_wing": +2,          # More rear downforce
        "diff_on": +5,            # Tighten diff to stabilise rear
        "diff_off": +3,
        "rear_suspension": -1,    # Softer rear for grip
        "rear_anti_roll": -1,
        "brake_bias": +1.0,       # More front braking
        "rear_camber": -0.2,      # More negative rear camber
    }

    _ENTRY_CORRECTIONS = {
        "understeer": {"diff_off": -3, "brake_bias": -0.5, "front_anti_roll": -1},
        "oversteer": {"diff_off": +3, "brake_bias": +0.5, "rear_anti_roll": -1},
    }

    _MID_CORRECTIONS = {
        "understeer": {"front_suspension": -1, "front_camber": -0.1, "front_wing": +1},
        "oversteer": {"rear_suspension": -1, "rear_camber": -0.1, "rear_wing": +1},
    }

    _EXIT_CORRECTIONS = {
        "understeer": {"diff_on": -5, "rear_wing": +1},
        "oversteer": {"diff_on": +5, "rear_suspension": -1},
    }

    def recommend(self, track_id: str, balance: BalanceTrend,
                  current_setup: dict | None = None) -> SetupRecommendation:
        """Generate setup recommendation based on balance analysis."""
        import time as _time

        # Get base preset
        preset = CIRCUIT_PRESETS.get(track_id, CIRCUIT_PRESETS["DEFAULT"])
        base_setup = {k: v for k, v in preset.items() if k not in ("name", "notes")}
        setup = dict(current_setup) if current_setup else dict(base_setup)

        adjustments: list[SetupAdjustment] = []

        if balance.confidence < 0.3 or balance.dominant_tendency == "neutral":
            return SetupRecommendation(
                base_preset_name=preset.get("name", "Unknown"),
                balance_trend=balance,
                adjustments=[],
                current_setup=setup,
                recommended_setup=setup,
                summary="Insufficient data or neutral balance. No changes recommended.",
                timestamp=_time.time(),
            )

        tendency = balance.dominant_tendency
        severity_mult = {"mild": 0.5, "moderate": 1.0, "severe": 1.5}.get(
            balance.corner_phases.severity, 0.5
        )

        # Apply general corrections
        corrections = (self._UNDERSTEER_CORRECTIONS if tendency == "understeer"
                       else self._OVERSTEER_CORRECTIONS)
        for param, base_delta in corrections.items():
            if param not in setup:
                continue
            delta = base_delta * severity_mult * balance.confidence
            delta = round(delta, 2)
            if abs(delta) < 0.01:
                continue

            current_val = setup[param]
            new_val = round(current_val + delta, 2)
            priority = "high" if abs(delta) > abs(base_delta) * 0.8 else "medium"

            adjustments.append(SetupAdjustment(
                parameter=param,
                current_value=current_val,
                recommended_value=new_val,
                delta=delta,
                reason=f"Correct {tendency} ({balance.corner_phases.severity})",
                priority=priority,
            ))
            setup[param] = new_val

        # Apply phase-specific corrections
        phases = balance.corner_phases
        phase_map = [
            (phases.entry_balance, self._ENTRY_CORRECTIONS),
            (phases.mid_balance, self._MID_CORRECTIONS),
            (phases.exit_balance, self._EXIT_CORRECTIONS),
        ]
        phase_names = ["entry", "mid-corner", "exit"]

        for (phase_val, corrections_map), phase_name in zip(phase_map, phase_names):
            if abs(phase_val) < 0.15:
                continue
            phase_tendency = "understeer" if phase_val < 0 else "oversteer"
            phase_corrections = corrections_map.get(phase_tendency, {})

            for param, base_delta in phase_corrections.items():
                if param not in setup:
                    continue
                delta = base_delta * min(1.0, abs(phase_val) * 2) * balance.confidence * 0.6
                delta = round(delta, 2)
                if abs(delta) < 0.01:
                    continue

                current_val = setup[param]
                new_val = round(current_val + delta, 2)

                adjustments.append(SetupAdjustment(
                    parameter=param,
                    current_value=current_val,
                    recommended_value=new_val,
                    delta=delta,
                    reason=f"{phase_name} {phase_tendency} correction",
                    priority="low",
                ))
                setup[param] = new_val

        # Build summary
        parts = [f"Detected {tendency} tendency ({balance.corner_phases.severity})."]
        if adjustments:
            high_adj = [a for a in adjustments if a.priority == "high"]
            if high_adj:
                params = ", ".join(a.parameter for a in high_adj[:3])
                parts.append(f"Priority adjustments: {params}.")
        summary = " ".join(parts)

        return SetupRecommendation(
            base_preset_name=preset.get("name", "Unknown"),
            balance_trend=balance,
            adjustments=adjustments,
            current_setup=current_setup or base_setup,
            recommended_setup=setup,
            summary=summary,
            timestamp=_time.time(),
        )


class SetupEngine:
    """Top-level setup engine combining balance analysis + recommendations."""

    def __init__(self) -> None:
        self._analyser = BalanceAnalyser()
        self._recommender = SetupRecommender()
        self._current_setup: dict | None = None
        self._last_recommendation: SetupRecommendation | None = None

    def ingest_snapshot(self, snapshot: dict) -> None:
        """Feed a telemetry snapshot for balance analysis."""
        self._analyser.add_sample(snapshot)

    def get_balance(self) -> BalanceTrend:
        """Get current vehicle balance analysis."""
        return self._analyser.analyse()

    def get_recommendation(self, track_id: str) -> SetupRecommendation:
        """Get full setup recommendation for current circuit."""
        from dataclasses import asdict
        balance = self._analyser.analyse()
        rec = self._recommender.recommend(track_id, balance, self._current_setup)
        self._last_recommendation = rec
        return rec

    def apply_setup(self, setup: dict) -> None:
        """Record a user-applied setup."""
        self._current_setup = dict(setup)

    def get_preset(self, track_id: str) -> dict:
        """Get the base preset for a track."""
        preset = CIRCUIT_PRESETS.get(track_id, CIRCUIT_PRESETS["DEFAULT"])
        return dict(preset)

    def to_dict(self, track_id: str) -> dict:
        """Serialize current state for API response."""
        from dataclasses import asdict
        balance = self._analyser.analyse()
        rec = self._recommender.recommend(track_id, balance, self._current_setup)
        return {
            "balance": asdict(balance),
            "recommendation": {
                "base_preset_name": rec.base_preset_name,
                "adjustments": [asdict(a) for a in rec.adjustments],
                "current_setup": rec.current_setup,
                "recommended_setup": rec.recommended_setup,
                "summary": rec.summary,
                "timestamp": rec.timestamp,
            },
            "preset": self.get_preset(track_id),
        }
