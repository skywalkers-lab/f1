"""
Advanced Strategy Decision Module
===================================
Enhances the base strategy engine with:
  - Multi-variable race context analysis
  - Safety car probability estimation
  - Undercut / overcut window analysis
  - Clear actionable recommendations with rationale
  - Tyre degradation rate tracking
  - Traffic window analysis
"""

from __future__ import annotations
from dataclasses import dataclass, field


@dataclass(frozen=True)
class ActionRecommendation:
    """Clear, actionable strategy call with rationale."""
    call: str          # PIT_NOW | STAY_OUT | PUSH | DEFEND | SAVE_FUEL | MANAGE_TYRES
    urgency: str       # immediate | next_lap | advisory
    confidence: str    # high | medium | low
    rationale: str     # Human-readable explanation
    key_factors: list[str]  # List of supporting factors


@dataclass(frozen=True)
class UndercutWindow:
    """Analysis of undercut/overcut opportunity."""
    undercut_viable: bool
    overcut_viable: bool
    undercut_gain_s: float
    overcut_gain_s: float
    optimal_pit_lap: int
    window_closing_laps: int  # How many laps until window closes


@dataclass(frozen=True)
class SafetyCarProbability:
    """Estimated safety car probability based on race context."""
    sc_probability: float   # 0-1
    vsc_probability: float  # 0-1
    factors: list[str]


@dataclass(frozen=True)
class TyreDegradationAnalysis:
    """Tyre wear rate analysis."""
    current_deg_rate_ms: float  # ms per lap degradation
    predicted_cliff_lap: int
    laps_to_cliff: int
    wear_acceleration: float  # Is degradation increasing?
    compound_optimal_window: tuple[int, int]  # (min_laps, max_laps) for compound


@dataclass(frozen=True)
class TrafficAnalysis:
    """Gap and traffic situation analysis."""
    clean_air: bool
    gap_ahead_trend: str  # growing | shrinking | stable
    gap_behind_trend: str
    drs_available: bool
    undercut_threat: bool  # Car behind in undercut window
    overcut_opportunity: bool  # Window to overcut car ahead


@dataclass
class StrategyContext:
    """Comprehensive race context for strategy decisions."""
    action_recommendation: ActionRecommendation = None
    undercut_window: UndercutWindow = None
    safety_car_prob: SafetyCarProbability = None
    tyre_analysis: TyreDegradationAnalysis = None
    traffic_analysis: TrafficAnalysis = None


class SafetyCarEstimator:
    """Estimates SC/VSC probability based on race conditions."""

    # Historical SC rates per remaining laps fraction
    _BASE_SC_RATE_PER_LAP = 0.018  # ~1.8% per lap
    _BASE_VSC_RATE_PER_LAP = 0.025

    def estimate(
        self,
        laps_remaining: int,
        total_laps: int,
        weather_idx: int,
        num_active_cars: int,
        gap_spread_s: float,
    ) -> SafetyCarProbability:
        factors = []
        sc_prob = 0.0
        vsc_prob = 0.0

        # Base probability scales with remaining race length
        race_progress = 1 - (laps_remaining / max(1, total_laps))
        laps_factor = min(laps_remaining, 20) * self._BASE_SC_RATE_PER_LAP
        sc_prob += laps_factor
        vsc_prob += min(laps_remaining, 20) * self._BASE_VSC_RATE_PER_LAP

        # Wet conditions increase SC probability significantly
        if weather_idx >= 4:
            sc_prob *= 2.5
            vsc_prob *= 2.0
            factors.append("WET_CONDITIONS")
        elif weather_idx >= 3:
            sc_prob *= 1.6
            vsc_prob *= 1.4
            factors.append("CHANGEABLE_CONDITIONS")

        # More cars = more incidents
        if num_active_cars > 18:
            sc_prob *= 1.15
            factors.append("DENSE_GRID")

        # Tight racing (small gaps) increases incident risk
        if gap_spread_s < 0.8:
            sc_prob *= 1.3
            vsc_prob *= 1.2
            factors.append("CLOSE_RACING")

        # First few laps have higher SC rate
        if race_progress < 0.1:
            sc_prob *= 1.8
            factors.append("OPENING_LAPS")

        # Late race slightly higher VSC rate
        if race_progress > 0.85:
            vsc_prob *= 1.3
            factors.append("CLOSING_LAPS")

        return SafetyCarProbability(
            sc_probability=min(0.95, sc_prob),
            vsc_probability=min(0.95, vsc_prob),
            factors=factors,
        )


class UndercutAnalyzer:
    """Analyzes undercut and overcut opportunities."""

    _NEW_TYRE_ADVANTAGE_S = {
        "C5": 2.2, "C4": 1.8, "C3": 1.4, "C2": 1.1, "C1": 0.9,
        "INTER": 1.0, "WET": 0.7,
    }

    def analyze(
        self,
        gap_ahead_s: float,
        gap_behind_s: float,
        tyre_age: int,
        tyre_compound: str,
        pit_loss_s: float,
        laps_remaining: int,
        deg_rate_ms: float,
    ) -> UndercutWindow:
        new_tyre_adv = self._NEW_TYRE_ADVANTAGE_S.get(tyre_compound, 1.4)

        # Undercut: pit before rival, gain time on fresh tyres
        # Net gain = new_tyre_advantage * laps_on_fresh - pit_loss
        undercut_gain = new_tyre_adv + (deg_rate_ms / 1000.0 * tyre_age * 0.3) - pit_loss_s
        undercut_viable = undercut_gain > -1.5 and gap_ahead_s < pit_loss_s + 2.0 and laps_remaining > 5

        # Overcut: stay out longer while rival pits on old tyres
        overcut_gain = (deg_rate_ms / 1000.0 * 3.0) - 0.5  # ~3 laps of deg advantage
        overcut_viable = overcut_gain > 0 and laps_remaining > 8

        # Optimal pit lap: when tyre deg curve becomes steeper than new-tyre advantage
        cliff_threshold = 25 if tyre_compound in ("C1", "C2") else 20
        optimal_pit_lap = max(0, cliff_threshold - tyre_age)

        window_closing = max(0, int((pit_loss_s + 1.0) / max(0.1, new_tyre_adv)))

        return UndercutWindow(
            undercut_viable=undercut_viable,
            overcut_viable=overcut_viable,
            undercut_gain_s=round(undercut_gain, 2),
            overcut_gain_s=round(overcut_gain, 2),
            optimal_pit_lap=optimal_pit_lap,
            window_closing_laps=window_closing,
        )


class AdvancedStrategyAdvisor:
    """
    Produces clear, actionable race strategy recommendations.

    Goes beyond simple scoring to provide specific driver actions:
      - "PIT NOW" — immediate pit stop required
      - "STAY OUT" — maintain position, don't pit
      - "PUSH" — attack mode, use clean air
      - "DEFEND" — cover position from car behind
      - "SAVE FUEL" — reduce consumption rate
      - "MANAGE TYRES" — lower tyre stress
    """

    def __init__(self) -> None:
        self._sc_estimator = SafetyCarEstimator()
        self._undercut_analyzer = UndercutAnalyzer()

    def analyze_context(
        self,
        # Base strategy outputs
        recommended_action: str,
        confidence: str,
        score: float,
        # Race state
        tyre_compound: str,
        tyre_age: int,
        tyre_wear_pct: float,
        fuel_kg: float,
        fuel_delta_per_lap: float,
        ers_norm: float,
        position: int,
        laps_remaining: int,
        total_laps: int,
        gap_ahead_s: float,
        gap_behind_s: float,
        pit_loss_s: float,
        sc_vsc_status: str,
        weather_state: str,
        deg_rate_ms: float = 0.0,
    ) -> dict:
        """
        Produce a comprehensive strategy context dict for the frontend.
        """
        weather_idx = int(weather_state.replace("WEATHER_", "0") or "0")
        sc_active = sc_vsc_status.endswith("_3")
        vsc_active = sc_vsc_status.endswith("_2")

        # Safety car probability
        sc_prob = self._sc_estimator.estimate(
            laps_remaining=laps_remaining,
            total_laps=total_laps,
            weather_idx=weather_idx,
            num_active_cars=20,
            gap_spread_s=min(gap_ahead_s, gap_behind_s),
        )

        # Undercut/overcut analysis
        undercut = self._undercut_analyzer.analyze(
            gap_ahead_s=gap_ahead_s,
            gap_behind_s=gap_behind_s,
            tyre_age=tyre_age,
            tyre_compound=tyre_compound,
            pit_loss_s=pit_loss_s,
            laps_remaining=laps_remaining,
            deg_rate_ms=deg_rate_ms,
        )

        # Tyre degradation analysis
        compound_windows = {
            "C5": (12, 18), "C4": (16, 23), "C3": (20, 28),
            "C2": (24, 34), "C1": (28, 40),
            "INTER": (30, 45), "WET": (40, 55),
        }
        window = compound_windows.get(tyre_compound, (20, 28))
        cliff_lap = window[1]
        laps_to_cliff = max(0, cliff_lap - tyre_age)
        wear_accel = max(0, tyre_wear_pct - (tyre_age * 2.5)) / max(1, tyre_age)

        tyre_analysis = {
            "current_deg_rate_ms": round(deg_rate_ms, 1),
            "predicted_cliff_lap": cliff_lap,
            "laps_to_cliff": laps_to_cliff,
            "wear_acceleration": round(wear_accel, 3),
            "compound_window": list(window),
        }

        # Traffic analysis
        clean_air = gap_ahead_s > 1.5
        undercut_threat = gap_behind_s < pit_loss_s - 2.0 and tyre_age > 12
        overcut_opportunity = gap_ahead_s < pit_loss_s + 1.0 and tyre_age < window[0]

        traffic = {
            "clean_air": clean_air,
            "gap_ahead_trend": "stable",
            "gap_behind_trend": "stable",
            "drs_available": gap_ahead_s < 1.0,
            "undercut_threat": undercut_threat,
            "overcut_opportunity": overcut_opportunity,
        }

        # Generate clear action recommendation
        action_rec = self._generate_recommendation(
            base_action=recommended_action,
            base_confidence=confidence,
            tyre_age=tyre_age,
            tyre_wear_pct=tyre_wear_pct,
            laps_to_cliff=laps_to_cliff,
            laps_remaining=laps_remaining,
            fuel_margin=(fuel_kg / max(0.01, fuel_delta_per_lap)) - laps_remaining if fuel_delta_per_lap > 0 else 99,
            gap_ahead_s=gap_ahead_s,
            gap_behind_s=gap_behind_s,
            clean_air=clean_air,
            sc_active=sc_active,
            vsc_active=vsc_active,
            sc_prob=sc_prob.sc_probability,
            undercut=undercut,
            weather_idx=weather_idx,
            position=position,
            ers_norm=ers_norm,
            pit_loss_s=pit_loss_s,
        )

        return {
            "action_recommendation": action_rec,
            "undercut_window": {
                "undercut_viable": undercut.undercut_viable,
                "overcut_viable": undercut.overcut_viable,
                "undercut_gain_s": undercut.undercut_gain_s,
                "overcut_gain_s": undercut.overcut_gain_s,
                "optimal_pit_lap": undercut.optimal_pit_lap,
                "window_closing_laps": undercut.window_closing_laps,
            },
            "safety_car": {
                "sc_probability": round(sc_prob.sc_probability, 3),
                "vsc_probability": round(sc_prob.vsc_probability, 3),
                "factors": sc_prob.factors,
            },
            "tyre_analysis": tyre_analysis,
            "traffic": traffic,
        }

    def _generate_recommendation(
        self, *, base_action: str, base_confidence: str,
        tyre_age: int, tyre_wear_pct: float, laps_to_cliff: int,
        laps_remaining: int, fuel_margin: float,
        gap_ahead_s: float, gap_behind_s: float, clean_air: bool,
        sc_active: bool, vsc_active: bool, sc_prob: float,
        undercut, weather_idx: int, position: int,
        ers_norm: float, pit_loss_s: float,
    ) -> dict:
        factors = []

        # Priority 1: Critical situations
        if tyre_wear_pct >= 80 and laps_remaining > 3:
            return {
                "call": "PIT_NOW",
                "urgency": "immediate",
                "confidence": "high",
                "rationale": f"타이어 마모 {tyre_wear_pct:.0f}% — 클리프 진입. 즉시 피트인 필요",
                "key_factors": ["TYRE_CLIFF", f"WEAR_{tyre_wear_pct:.0f}%"],
            }

        if fuel_margin < -0.5 and laps_remaining > 2:
            return {
                "call": "SAVE_FUEL",
                "urgency": "immediate",
                "confidence": "high",
                "rationale": f"연료 부족 — 완주까지 {abs(fuel_margin):.1f}랩분 부족",
                "key_factors": ["FUEL_CRITICAL", f"MARGIN_{fuel_margin:.1f}"],
            }

        # SC/VSC pit opportunity
        if (sc_active or vsc_active) and laps_remaining > 5 and tyre_age > 10:
            sc_type = "세이프티카" if sc_active else "VSC"
            return {
                "call": "PIT_NOW",
                "urgency": "immediate",
                "confidence": "high",
                "rationale": f"{sc_type} 상황 — 피트 로스 최소화 기회. 타이어 {tyre_age}랩 사용",
                "key_factors": ["SC_OPPORTUNITY", f"TYRE_AGE_{tyre_age}"],
            }

        # Wet conditions on slicks
        if weather_idx >= 4 and base_action != "STAY_OUT":
            return {
                "call": "PIT_NOW",
                "urgency": "immediate",
                "confidence": "high",
                "rationale": "비 시작 — 웻/인터 타이어 교체 필요",
                "key_factors": ["WET_CONDITIONS", f"WEATHER_{weather_idx}"],
            }

        # Priority 2: Strategic opportunities
        if undercut.undercut_viable and gap_behind_s < pit_loss_s and laps_remaining > 8:
            factors.append("UNDERCUT_THREAT")
            if base_action in ("PIT_NOW", "PIT_IN_1"):
                return {
                    "call": "PIT_NOW",
                    "urgency": "next_lap",
                    "confidence": "medium",
                    "rationale": f"언더컷 위협 — 뒤차 갭 {gap_behind_s:.1f}s. 선제 피트인 권장",
                    "key_factors": factors + [f"GAP_BEHIND_{gap_behind_s:.1f}s"],
                }

        # Clean air push opportunity
        if clean_air and tyre_wear_pct < 50 and fuel_margin > 1.0 and ers_norm > 0.3:
            if gap_ahead_s < 3.0 and gap_ahead_s > 1.0:
                return {
                    "call": "PUSH",
                    "urgency": "advisory",
                    "confidence": "medium" if base_confidence != "low" else "low",
                    "rationale": f"클린에어 — 앞차 {gap_ahead_s:.1f}s. 공격 가능 구간",
                    "key_factors": ["CLEAN_AIR", "TYRE_OK", f"GAP_{gap_ahead_s:.1f}s"],
                }

        # Defend position
        if gap_behind_s < 1.2 and position <= 3 and laps_remaining > 3:
            return {
                "call": "DEFEND",
                "urgency": "advisory",
                "confidence": "medium",
                "rationale": f"포디션 방어 — 뒤차 {gap_behind_s:.1f}s. DRS 범위 내",
                "key_factors": ["POSITION_DEFENSE", f"P{position}"],
            }

        # Tyre management
        if laps_to_cliff <= 5 and laps_to_cliff > 0 and laps_remaining > laps_to_cliff + 3:
            return {
                "call": "MANAGE_TYRES",
                "urgency": "advisory",
                "confidence": "medium",
                "rationale": f"타이어 클리프까지 약 {laps_to_cliff}랩 — 관리 모드 권장",
                "key_factors": ["TYRE_MANAGEMENT", f"CLIFF_IN_{laps_to_cliff}"],
            }

        # SC probability-aware stay out
        if sc_prob > 0.35 and tyre_age > 15 and laps_remaining > 10:
            factors.append(f"SC_PROB_{sc_prob:.0%}")
            return {
                "call": "STAY_OUT",
                "urgency": "advisory",
                "confidence": "low",
                "rationale": f"SC 확률 {sc_prob:.0%} — 스테이 아웃 후 SC 피트 활용 가능",
                "key_factors": factors,
            }

        # Default: follow base recommendation
        call_map = {
            "PIT_NOW": "PIT_NOW",
            "PIT_IN_1": "PIT_NOW",
            "PIT_IN_2": "STAY_OUT",
            "STAY_OUT": "STAY_OUT",
        }
        call = call_map.get(base_action, "STAY_OUT")
        return {
            "call": call,
            "urgency": "advisory",
            "confidence": base_confidence,
            "rationale": f"시뮬레이션 기반 — {base_action}",
            "key_factors": [f"SIM_{base_action}", f"SCORE_{base_confidence.upper()}"],
        }
