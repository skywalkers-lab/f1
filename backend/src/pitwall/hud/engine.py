"""
Driver HUD Engine — lightweight, high-frequency data pipeline for overlay.

Computes:
  • Penalty risk assessment (corner-cut tracking + penalty escalation)
  • Damage analysis with estimated lap-time loss per component
  • Pit-in decision with stay-out/pit cost-benefit
  • Rival tyre wear estimation for the car ahead and behind
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

# ── Penalty risk ────────────────────────────────────────────────────────────

# F1 25 penalty escalation thresholds (approximated from game behaviour)
_CORNER_CUT_WARN_THRESHOLD = 3   # 3 warnings → black-and-white flag
_CORNER_CUT_PENALTY_THRESHOLD = 5  # 5 → 5-second penalty likely

PENALTY_LEVEL_OK = "ok"
PENALTY_LEVEL_CAUTION = "caution"
PENALTY_LEVEL_WARNING = "warning"
PENALTY_LEVEL_CRITICAL = "critical"


@dataclass
class PenaltyRisk:
    corner_cuts: int = 0
    total_warnings: int = 0
    time_penalties_s: int = 0
    level: str = PENALTY_LEVEL_OK
    message: str = ""


def assess_penalty_risk(corner_cuts: int, total_warnings: int, time_penalties_s: int) -> PenaltyRisk:
    if corner_cuts >= _CORNER_CUT_PENALTY_THRESHOLD:
        level = PENALTY_LEVEL_CRITICAL
        msg = f"PENALTY IMMINENT — {corner_cuts} corner cuts"
    elif corner_cuts >= _CORNER_CUT_WARN_THRESHOLD:
        level = PENALTY_LEVEL_WARNING
        msg = f"B&W FLAG — {corner_cuts} corner cuts, take care"
    elif corner_cuts >= 2:
        level = PENALTY_LEVEL_CAUTION
        msg = f"{corner_cuts} corner cuts — stay within limits"
    else:
        level = PENALTY_LEVEL_OK
        msg = ""

    if time_penalties_s > 0:
        level = PENALTY_LEVEL_CRITICAL
        msg = f"{time_penalties_s}s time penalty active"

    return PenaltyRisk(
        corner_cuts=corner_cuts,
        total_warnings=total_warnings,
        time_penalties_s=time_penalties_s,
        level=level,
        message=msg,
    )


# ── Damage analysis ────────────────────────────────────────────────────────

# Estimated lap-time loss coefficients per 1% damage on each component.
# Based on aerodynamic sensitivity studies and F1 game telemetry community data.
_DAMAGE_COEFFICIENTS_MS = {
    "front_wing":  18.0,   # High aero sensitivity — front downforce dominant
    "rear_wing":   14.0,   # Rear stability / drag
    "floor":       22.0,   # Ground effect dominant in 2025 regs
    "diffuser":    16.0,
    "sidepod":      8.0,   # Cooling + minor aero
    "engine":      25.0,   # Direct power loss
    "gearbox":     12.0,   # Shift delay + reliability
}

_TYRE_DAMAGE_COEFF_MS = 5.0    # per 1% average tyre damage
_BRAKE_DAMAGE_COEFF_MS = 3.0   # per 1% average brake damage


@dataclass
class DamageComponent:
    name: str
    damage_pct: int
    time_loss_ms: int


@dataclass
class DamageAnalysis:
    total_time_loss_ms: int = 0
    components: list[DamageComponent] = field(default_factory=list)
    critical: bool = False
    summary: str = ""


def analyse_damage(
    front_wing: int,
    rear_wing: int,
    floor: int,
    diffuser: int,
    sidepod: int,
    engine: int,
    gearbox: int,
    tyres_damage: list[int],
    brakes_damage: list[int],
) -> DamageAnalysis:
    components: list[DamageComponent] = []
    total_ms = 0

    aero_parts = [
        ("front_wing", front_wing),
        ("rear_wing", rear_wing),
        ("floor", floor),
        ("diffuser", diffuser),
        ("sidepod", sidepod),
        ("engine", engine),
        ("gearbox", gearbox),
    ]
    for name, pct in aero_parts:
        if pct > 0:
            loss = int(pct * _DAMAGE_COEFFICIENTS_MS[name])
            components.append(DamageComponent(name=name, damage_pct=pct, time_loss_ms=loss))
            total_ms += loss

    avg_tyre_dmg = sum(tyres_damage) / max(len(tyres_damage), 1)
    if avg_tyre_dmg > 0:
        loss = int(avg_tyre_dmg * _TYRE_DAMAGE_COEFF_MS)
        components.append(DamageComponent(name="tyres", damage_pct=int(avg_tyre_dmg), time_loss_ms=loss))
        total_ms += loss

    avg_brake_dmg = sum(brakes_damage) / max(len(brakes_damage), 1)
    if avg_brake_dmg > 0:
        loss = int(avg_brake_dmg * _BRAKE_DAMAGE_COEFF_MS)
        components.append(DamageComponent(name="brakes", damage_pct=int(avg_brake_dmg), time_loss_ms=loss))
        total_ms += loss

    critical = any(
        pct >= 50 for _, pct in aero_parts
    ) or max(tyres_damage, default=0) >= 80

    if total_ms == 0:
        summary = "No damage"
    elif total_ms < 300:
        summary = f"+{total_ms / 1000:.1f}s minor damage"
    elif total_ms < 800:
        summary = f"+{total_ms / 1000:.1f}s significant damage"
    else:
        summary = f"+{total_ms / 1000:.1f}s SEVERE — PIT RECOMMENDED"

    return DamageAnalysis(
        total_time_loss_ms=total_ms,
        components=sorted(components, key=lambda c: c.time_loss_ms, reverse=True),
        critical=critical,
        summary=summary,
    )


# ── Pit-in decision ────────────────────────────────────────────────────────

PIT_COST_SECONDS = 22.0  # Average pit lane time loss
PIT_FRESH_TYRE_GAIN_PER_LAP_MS = 400  # Fresh tyres gain ~0.4s/lap over worn

@dataclass
class PitDecision:
    should_pit: bool = False
    urgency: str = "none"  # "none" | "consider" | "recommended" | "critical"
    laps_can_survive: int = 99
    pit_cost_s: float = PIT_COST_SECONDS
    stay_out_loss_s: float = 0.0
    pit_gain_s: float = 0.0
    reason: str = ""


def compute_pit_decision(
    current_lap: int,
    total_laps: int,
    tyre_wear_pct: float,
    tyres_age_laps: int,
    damage_time_loss_ms: int,
    damage_critical: bool,
    best_lap_ms: int,
    avg_lap_ms: int,
    gap_ahead_ms: int,
    gap_behind_ms: int,
) -> PitDecision:
    laps_remaining = max(total_laps - current_lap, 0)
    if laps_remaining <= 0:
        return PitDecision(reason="Final lap — no pit")

    # Estimate how many more laps tyres can last
    if tyres_age_laps > 0 and tyre_wear_pct > 5:
        wear_per_lap = tyre_wear_pct / max(tyres_age_laps, 1)
        remaining_wear_budget = max(100.0 - tyre_wear_pct, 0)
        laps_can_survive = min(int(remaining_wear_budget / max(wear_per_lap, 0.1)), laps_remaining)
    else:
        laps_can_survive = laps_remaining

    # Cost of staying out: accumulated tyre degradation + damage loss
    deg_rate_ms_per_lap = max(0, avg_lap_ms - best_lap_ms) if best_lap_ms > 0 else 0
    stay_out_loss = (
        laps_remaining * (damage_time_loss_ms / 1000.0)
        + laps_remaining * (deg_rate_ms_per_lap / 1000.0)
    )

    # Gain from pitting: fresh tyres benefit over remaining laps
    pit_gain = laps_remaining * (PIT_FRESH_TYRE_GAIN_PER_LAP_MS / 1000.0) if tyre_wear_pct > 30 else 0.0

    net_pit_benefit = pit_gain - PIT_COST_SECONDS

    # Traffic consideration: if we have a big gap behind, pit cost is reduced
    traffic_ok = gap_behind_ms > (PIT_COST_SECONDS * 1000)

    # Decision logic
    if damage_critical:
        urgency = "critical"
        should_pit = True
        reason = "Critical damage — pit immediately"
    elif laps_can_survive <= 2 and laps_remaining > 3:
        urgency = "critical"
        should_pit = True
        reason = f"Tyres failing in ~{laps_can_survive} laps"
    elif net_pit_benefit > 3.0 and laps_remaining > 5:
        urgency = "recommended"
        should_pit = True
        reason = f"Net gain {net_pit_benefit:.1f}s from fresh tyres"
    elif tyre_wear_pct > 60 and laps_remaining > 8:
        urgency = "consider"
        should_pit = not traffic_ok  # Pit if traffic gap exists
        reason = f"High wear ({tyre_wear_pct:.0f}%), {laps_can_survive} laps remaining on tyres"
    else:
        urgency = "none"
        should_pit = False
        reason = f"Stay out — {laps_can_survive} laps on tyres"

    return PitDecision(
        should_pit=should_pit,
        urgency=urgency,
        laps_can_survive=laps_can_survive,
        pit_cost_s=PIT_COST_SECONDS,
        stay_out_loss_s=round(stay_out_loss, 1),
        pit_gain_s=round(max(pit_gain, 0), 1),
        reason=reason,
    )


# ── Rival tyre wear estimation ─────────────────────────────────────────────

_PACE_HISTORY_SIZE = 10  # rolling window


@dataclass
class RivalTyreEstimate:
    car_index: int
    driver_code: str
    gap_ms: int
    compound: str
    stint_laps: int
    estimated_wear_pct: float
    pace_trend: str  # "improving" | "stable" | "degrading"
    is_vulnerable: bool  # Can be attacked
    is_threatening: bool  # Might attack us


class RivalTyreEstimator:
    """Estimates tyre wear for rivals based on pace trends and stint length."""

    # Base wear-per-lap rates by compound (% per lap)
    _COMPOUND_WEAR_RATES = {
        "C1": 1.0, "C2": 1.4, "C3": 1.8, "C4": 2.3, "C5": 3.0,
        "INTER": 1.5, "WET": 1.2,
    }

    def __init__(self) -> None:
        # car_index → list of last N lap times
        self._pace_history: dict[int, list[int]] = {}

    def record_lap(self, car_index: int, lap_time_ms: int) -> None:
        if lap_time_ms <= 0:
            return
        history = self._pace_history.setdefault(car_index, [])
        history.append(lap_time_ms)
        if len(history) > _PACE_HISTORY_SIZE:
            history.pop(0)

    def estimate(
        self,
        car_index: int,
        driver_code: str,
        gap_ms: int,
        compound: str,
        stint_laps: int,
    ) -> RivalTyreEstimate:
        # Base wear estimate from compound + stint length
        base_rate = self._COMPOUND_WEAR_RATES.get(compound, 1.8)
        estimated_wear = min(stint_laps * base_rate, 100.0)

        # Refine with pace trend
        history = self._pace_history.get(car_index, [])
        pace_trend = "stable"
        if len(history) >= 3:
            recent = history[-3:]
            older = history[:-3] if len(history) > 3 else history[:1]
            recent_avg = sum(recent) / len(recent)
            older_avg = sum(older) / len(older) if older else recent_avg

            delta = recent_avg - older_avg
            if delta > 300:  # > 0.3s slower recently
                pace_trend = "degrading"
                # Pace degradation suggests higher wear than baseline
                estimated_wear = min(estimated_wear * 1.3, 100.0)
            elif delta < -200:  # Getting faster (fresh tyres?)
                pace_trend = "improving"
                estimated_wear = max(estimated_wear * 0.6, 5.0)

        # Attack/defence assessment
        is_vulnerable = (
            estimated_wear > 50
            and pace_trend == "degrading"
            and gap_ms > 0  # They are ahead
            and gap_ms < 2000
        )
        is_threatening = (
            estimated_wear < 30
            and pace_trend != "degrading"
            and gap_ms < 0  # They are behind
            and abs(gap_ms) < 2000
        )

        return RivalTyreEstimate(
            car_index=car_index,
            driver_code=driver_code,
            gap_ms=gap_ms,
            compound=compound,
            stint_laps=stint_laps,
            estimated_wear_pct=round(estimated_wear, 1),
            pace_trend=pace_trend,
            is_vulnerable=is_vulnerable,
            is_threatening=is_threatening,
        )


# ── HUD Engine (top-level coordinator) ─────────────────────────────────────

@dataclass
class HudState:
    """Computed state for the driver overlay HUD."""
    penalty: PenaltyRisk = field(default_factory=PenaltyRisk)
    damage: DamageAnalysis = field(default_factory=DamageAnalysis)
    pit_decision: PitDecision = field(default_factory=PitDecision)
    car_ahead: RivalTyreEstimate | None = None
    car_behind: RivalTyreEstimate | None = None
    lap: int = 0
    position: int = 0
    total_laps: int = 0
    speed: int = 0
    gear: int = 0
    drs_enabled: bool = False
    tyre_compound: str = "UNKNOWN"
    tyre_wear_pct: float = 0.0
    fuel: float = 0.0
    ers_pct: float = 0.0


class HudEngine:
    """Lightweight engine that computes HUD state from AppState snapshots."""

    def __init__(self) -> None:
        self._rival_estimator = RivalTyreEstimator()
        self._last_laps: dict[int, int] = {}  # car_index → last known lap

    def compute(self, state: dict[str, Any]) -> dict[str, Any]:
        """Take a full AppState dict and return a lightweight HUD dict."""
        player = state.get("player", {})
        leaderboard = state.get("leaderboard", [])

        # ── Penalty risk ──
        penalty = assess_penalty_risk(
            corner_cuts=player.get("corner_cut_warnings", 0),
            total_warnings=player.get("total_warnings", 0),
            time_penalties_s=player.get("time_penalties_s", 0),
        )

        # ── Damage analysis ──
        damage = analyse_damage(
            front_wing=player.get("front_wing_damage", 0),
            rear_wing=player.get("rear_wing_damage", 0),
            floor=player.get("floor_damage", 0),
            diffuser=player.get("diffuser_damage", 0),
            sidepod=player.get("sidepod_damage", 0),
            engine=player.get("engine_damage", 0),
            gearbox=player.get("gearbox_damage", 0),
            tyres_damage=player.get("tyres_damage", [0, 0, 0, 0]),
            brakes_damage=player.get("brakes_damage", [0, 0, 0, 0]),
        )

        # ── Rival estimation — track lap times ──
        for row in leaderboard:
            ci = row.get("car_index", -1)
            lap_ms = row.get("last_lap_ms", 0)
            if lap_ms > 0:
                last = self._last_laps.get(ci, 0)
                if lap_ms != last:
                    self._rival_estimator.record_lap(ci, lap_ms)
                    self._last_laps[ci] = lap_ms

        # ── Find car ahead and behind ──
        player_pos = player.get("position", 0)
        player_ci = state.get("player_car_index", 0)
        car_ahead_est = None
        car_behind_est = None
        for row in leaderboard:
            if row.get("car_index") == player_ci:
                continue
            pos = row.get("position", 0)
            if pos == player_pos - 1 and player_pos > 1:
                gap_ms = int(row.get("gap_to_player_s", 0) * 1000)
                car_ahead_est = self._rival_estimator.estimate(
                    car_index=row.get("car_index", 0),
                    driver_code=row.get("driver_code", "???"),
                    gap_ms=gap_ms,
                    compound=row.get("tyre_compound", "C3"),
                    stint_laps=row.get("stint_lap", 0),
                )
            elif pos == player_pos + 1:
                gap_ms = int(row.get("gap_to_player_s", 0) * 1000)
                car_behind_est = self._rival_estimator.estimate(
                    car_index=row.get("car_index", 0),
                    driver_code=row.get("driver_code", "???"),
                    gap_ms=gap_ms,
                    compound=row.get("tyre_compound", "C3"),
                    stint_laps=row.get("stint_lap", 0),
                )

        # ── Pit decision ──
        pace = state.get("pace", {})
        tyre_wear = sum(player.get("tyres_damage", [0, 0, 0, 0])) / 4.0

        gap_ahead_ms = abs(car_ahead_est.gap_ms) if car_ahead_est else 99000
        gap_behind_ms = abs(car_behind_est.gap_ms) if car_behind_est else 99000

        pit_decision = compute_pit_decision(
            current_lap=player.get("lap", 0),
            total_laps=state.get("total_laps", 0),
            tyre_wear_pct=tyre_wear,
            tyres_age_laps=player.get("tyres_age_laps", 0),
            damage_time_loss_ms=damage.total_time_loss_ms,
            damage_critical=damage.critical,
            best_lap_ms=pace.get("best_lap_ms", 0),
            avg_lap_ms=pace.get("avg_lap_ms", 0),
            gap_ahead_ms=gap_ahead_ms,
            gap_behind_ms=gap_behind_ms,
        )

        ers_max = 4_000_000.0  # F1 regulation: 4 MJ max ERS store
        ers_raw = player.get("ers", 0)
        ers_pct = min(ers_raw / ers_max * 100, 100.0) if ers_max > 0 else 0.0

        hud = HudState(
            penalty=penalty,
            damage=damage,
            pit_decision=pit_decision,
            car_ahead=car_ahead_est,
            car_behind=car_behind_est,
            lap=player.get("lap", 0),
            position=player.get("position", 0),
            total_laps=state.get("total_laps", 0),
            speed=player.get("speed", 0),
            gear=player.get("gear", 0),
            drs_enabled=player.get("drs_enabled", False),
            tyre_compound=player.get("tyre_compound", "UNKNOWN"),
            tyre_wear_pct=round(tyre_wear, 1),
            fuel=round(player.get("fuel", 0), 2),
            ers_pct=round(ers_pct, 1),
        )

        return _hud_to_dict(hud)


def _hud_to_dict(hud: HudState) -> dict[str, Any]:
    """Manually serialize to avoid dataclasses.asdict overhead on hot path."""
    result: dict[str, Any] = {
        "penalty": {
            "corner_cuts": hud.penalty.corner_cuts,
            "total_warnings": hud.penalty.total_warnings,
            "time_penalties_s": hud.penalty.time_penalties_s,
            "level": hud.penalty.level,
            "message": hud.penalty.message,
        },
        "damage": {
            "total_time_loss_ms": hud.damage.total_time_loss_ms,
            "components": [
                {"name": c.name, "damage_pct": c.damage_pct, "time_loss_ms": c.time_loss_ms}
                for c in hud.damage.components
            ],
            "critical": hud.damage.critical,
            "summary": hud.damage.summary,
        },
        "pit_decision": {
            "should_pit": hud.pit_decision.should_pit,
            "urgency": hud.pit_decision.urgency,
            "laps_can_survive": hud.pit_decision.laps_can_survive,
            "pit_cost_s": hud.pit_decision.pit_cost_s,
            "stay_out_loss_s": hud.pit_decision.stay_out_loss_s,
            "pit_gain_s": hud.pit_decision.pit_gain_s,
            "reason": hud.pit_decision.reason,
        },
        "lap": hud.lap,
        "position": hud.position,
        "total_laps": hud.total_laps,
        "speed": hud.speed,
        "gear": hud.gear,
        "drs_enabled": hud.drs_enabled,
        "tyre_compound": hud.tyre_compound,
        "tyre_wear_pct": hud.tyre_wear_pct,
        "fuel": hud.fuel,
        "ers_pct": hud.ers_pct,
    }

    def _rival(r: RivalTyreEstimate | None) -> dict | None:
        if r is None:
            return None
        return {
            "car_index": r.car_index,
            "driver_code": r.driver_code,
            "gap_ms": r.gap_ms,
            "compound": r.compound,
            "stint_laps": r.stint_laps,
            "estimated_wear_pct": r.estimated_wear_pct,
            "pace_trend": r.pace_trend,
            "is_vulnerable": r.is_vulnerable,
            "is_threatening": r.is_threatening,
        }

    result["car_ahead"] = _rival(hud.car_ahead)
    result["car_behind"] = _rival(hud.car_behind)
    return result
