from dataclasses import dataclass
from typing import Protocol


ACTION_PIT_NOW = "PIT_NOW"
ACTION_PIT_IN_1 = "PIT_IN_1"
ACTION_PIT_IN_2 = "PIT_IN_2"
ACTION_STAY_OUT = "STAY_OUT"
DEFAULT_TOTAL_LAPS = 58
DEFAULT_BASE_LAP_TIME = 89.0
MAX_TRACK_POSITION = 22
ERS_MAX_J = 5_000_000.0


@dataclass(frozen=True)
class CandidateScore:
    action: str
    score: float
    reason: str


@dataclass(frozen=True)
class StrategyRecommendation:
    action: str
    score: float
    confidence: str
    reason: str
    key_inputs: dict
    candidates: list[CandidateScore]


@dataclass(frozen=True)
class RaceFeatures:
    laps_remaining: int
    stint_length: int
    tyre_compound: str
    tyre_age: int
    tyre_wear_mean: float
    fuel_remaining: float
    fuel_delta_per_lap: float
    ers_level_norm: float
    gap_ahead_s: float
    gap_behind_s: float
    relative_pace_s: float
    traffic_density: float
    pit_window_status: str
    sc_vsc_status: str
    weather_state: str
    player_position: int
    track_id: str
    base_lap_time_s: float


@dataclass(frozen=True)
class TyreProjection:
    expected_lap_time_s: float
    degradation_rate_s: float
    remaining_life_laps: float
    cliff_risk: float


@dataclass(frozen=True)
class SimulationResult:
    action: str
    total_time_s: float
    final_position: int
    stint_plan: list[dict]
    traffic_events: list[str]
    traffic_penalty_s: float
    risk_factor: float
    track_position_weight: float
    pit_loss_s: float


@dataclass(frozen=True)
class MLInference:
    action: str
    score: float
    confidence: float


class MLModel(Protocol):
    def predict(self, action: str, features: RaceFeatures) -> MLInference | None:
        ...


class FeatureExtractor:
    def extract(
        self,
        race_control_state: str,
        player_position: int,
        tyre_compound: str,
        fuel_kg: float,
        ers_energy: float,
        current_lap: int,
        total_laps: int,
        avg_lap_ms: int,
        best_lap_ms: int,
        consistency_pct: float,
        gap_ahead_s: float,
        gap_behind_s: float,
        weather_state: str,
        track_id: str,
    ) -> RaceFeatures:
        safe_total_laps = total_laps if total_laps > 0 else DEFAULT_TOTAL_LAPS
        safe_lap = max(1, current_lap)
        laps_remaining = max(0, safe_total_laps - safe_lap)
        safe_position = min(MAX_TRACK_POSITION, max(1, player_position or 1))

        base_lap_time = (best_lap_ms / 1000.0) if best_lap_ms > 0 else DEFAULT_BASE_LAP_TIME
        avg_lap_time = (avg_lap_ms / 1000.0) if avg_lap_ms > 0 else base_lap_time
        relative_pace = avg_lap_time - base_lap_time

        inferred_stint = max(1, safe_lap - 1)
        tyre_age = inferred_stint
        tyre_wear_mean = min(1.0, tyre_age / 30.0)
        fuel_delta_per_lap = fuel_kg / max(1, laps_remaining)
        ers_level_norm = min(1.0, max(0.0, ers_energy / ERS_MAX_J))
        traffic_density = min(1.0, (max(0.0, 9.0 - safe_position) / 9.0) + max(0.0, 1.0 - consistency_pct / 100.0) * 0.2)

        pit_window_status = "OPEN" if 8 <= safe_lap <= max(8, safe_total_laps - 10) else "CLOSED"
        sc_vsc_status = race_control_state

        return RaceFeatures(
            laps_remaining=laps_remaining,
            stint_length=inferred_stint,
            tyre_compound=tyre_compound,
            tyre_age=tyre_age,
            tyre_wear_mean=tyre_wear_mean,
            fuel_remaining=fuel_kg,
            fuel_delta_per_lap=fuel_delta_per_lap,
            ers_level_norm=ers_level_norm,
            gap_ahead_s=max(0.0, gap_ahead_s),
            gap_behind_s=max(0.0, gap_behind_s),
            relative_pace_s=relative_pace,
            traffic_density=traffic_density,
            pit_window_status=pit_window_status,
            sc_vsc_status=sc_vsc_status,
            weather_state=weather_state,
            player_position=safe_position,
            track_id=track_id,
            base_lap_time_s=base_lap_time,
        )


class TyreModel:
    _COMPOUND_OFFSET = {
        "C5": -0.55,
        "C4": -0.30,
        "C3": 0.00,
        "C2": 0.25,
        "C1": 0.50,
    }
    _DEG_RATE = {
        "C5": 0.080,
        "C4": 0.065,
        "C3": 0.050,
        "C2": 0.040,
        "C1": 0.035,
    }
    _CLIFF_AGE = {
        "C5": 16,
        "C4": 20,
        "C3": 24,
        "C2": 30,
        "C1": 36,
    }
    _MAX_LIFE = {
        "C5": 18,
        "C4": 23,
        "C3": 28,
        "C2": 34,
        "C1": 40,
    }

    def expected_lap_time(self, base_lap_time_s: float, tyre_age: int, compound: str) -> TyreProjection:
        compound_key = compound if compound in self._COMPOUND_OFFSET else "C3"
        compound_offset = self._COMPOUND_OFFSET[compound_key]
        deg_rate = self._DEG_RATE[compound_key]
        cliff_age = self._CLIFF_AGE[compound_key]
        max_life = self._MAX_LIFE[compound_key]

        cliff_penalty = max(0.0, tyre_age - cliff_age) * 0.12
        expected = base_lap_time_s + compound_offset + (deg_rate * max(0, tyre_age)) + cliff_penalty
        remaining_life = max(0.0, float(max_life - tyre_age))
        cliff_risk = min(1.0, max(0.0, (tyre_age - cliff_age + 1) / 8.0))
        return TyreProjection(
            expected_lap_time_s=expected,
            degradation_rate_s=deg_rate,
            remaining_life_laps=remaining_life,
            cliff_risk=cliff_risk,
        )


class FuelModel:
    _PENALTY_PER_KG = 0.032
    _SC_MULTIPLIER = 0.55
    _SAVE_MODE_MULTIPLIER = 0.75

    def lap_time_penalty(self, fuel_remaining: float, fuel_delta_per_lap: float, sc_active: bool, save_mode: bool) -> float:
        effective_fuel = max(0.0, fuel_remaining - fuel_delta_per_lap)
        penalty = effective_fuel * self._PENALTY_PER_KG
        if save_mode:
            penalty *= self._SAVE_MODE_MULTIPLIER
        if sc_active:
            penalty *= self._SC_MULTIPLIER
        return penalty


class PitLossModel:
    _BASE_TRACK_LOSS = {
        "TRACK_0": 20.5,
        "TRACK_1": 22.0,
        "TRACK_2": 24.0,
    }
    _DEFAULT_TRACK_LOSS = 22.5
    _STATIONARY_TIME = 2.6
    _ENTRY_EXIT_LOSS = 1.8
    _SC_DISCOUNT = 7.5
    _VSC_DISCOUNT = 4.0

    def estimate(self, track_id: str, sc_vsc_status: str) -> float:
        pit_lane = self._BASE_TRACK_LOSS.get(track_id, self._DEFAULT_TRACK_LOSS)
        total = pit_lane + self._STATIONARY_TIME + self._ENTRY_EXIT_LOSS
        if sc_vsc_status.endswith("_3"):
            total -= self._SC_DISCOUNT
        elif sc_vsc_status.endswith("_2"):
            total -= self._VSC_DISCOUNT
        return max(12.0, total)


class TrafficModel:
    _ACTION_BASE = {
        ACTION_PIT_NOW: 1.4,
        ACTION_PIT_IN_1: 1.1,
        ACTION_PIT_IN_2: 0.9,
        ACTION_STAY_OUT: 0.6,
    }

    def estimate(self, action: str, traffic_density: float, gap_ahead_s: float, gap_behind_s: float) -> tuple[float, float]:
        base = self._ACTION_BASE.get(action, 1.0)
        gap_effect = 0.0
        if gap_ahead_s < 1.2:
            gap_effect += 0.5
        if gap_behind_s < 1.2 and action != ACTION_STAY_OUT:
            gap_effect += 0.4
        traffic_penalty = base * (0.5 + traffic_density) + gap_effect
        clean_air_probability = max(0.0, min(1.0, 1.0 - (traffic_density * 0.85) - (gap_effect * 0.15)))
        return traffic_penalty, clean_air_probability


class OpponentModel:
    def infer_pit_window_pressure(self, player_position: int, traffic_density: float) -> float:
        position_pressure = max(0.0, 1.0 - (player_position / MAX_TRACK_POSITION))
        return min(1.0, 0.6 * position_pressure + 0.4 * traffic_density)


class RaceSimulator:
    _ACTIONS = (ACTION_PIT_NOW, ACTION_PIT_IN_1, ACTION_PIT_IN_2, ACTION_STAY_OUT)

    def __init__(
        self,
        tyre_model: TyreModel,
        fuel_model: FuelModel,
        pit_loss_model: PitLossModel,
        traffic_model: TrafficModel,
        opponent_model: OpponentModel,
    ) -> None:
        self._tyre_model = tyre_model
        self._fuel_model = fuel_model
        self._pit_loss_model = pit_loss_model
        self._traffic_model = traffic_model
        self._opponent_model = opponent_model

    def actions(self) -> tuple[str, ...]:
        return self._ACTIONS

    def _pit_lap_index(self, action: str) -> int | None:
        if action == ACTION_PIT_NOW:
            return 0
        if action == ACTION_PIT_IN_1:
            return 1
        if action == ACTION_PIT_IN_2:
            return 2
        return None

    def simulate(self, action: str, features: RaceFeatures) -> SimulationResult:
        pit_lap = self._pit_lap_index(action)
        total_time = 0.0
        traffic_penalty_total = 0.0
        traffic_events: list[str] = []
        stint_plan: list[dict] = []
        tyre_age = features.tyre_age
        fuel_remaining = features.fuel_remaining
        pit_loss = self._pit_loss_model.estimate(features.track_id, features.sc_vsc_status)
        opponent_pressure = self._opponent_model.infer_pit_window_pressure(features.player_position, features.traffic_density)

        horizon = max(1, features.laps_remaining)
        for lap_offset in range(horizon):
            if pit_lap is not None and lap_offset == pit_lap:
                total_time += pit_loss
                stint_plan.append({"lap_offset": lap_offset, "event": "pit_stop", "compound": "C3"})
                tyre_age = 0

            tyre_projection = self._tyre_model.expected_lap_time(features.base_lap_time_s, tyre_age, features.tyre_compound)
            sc_active = features.sc_vsc_status.endswith("_2") or features.sc_vsc_status.endswith("_3")
            fuel_penalty = self._fuel_model.lap_time_penalty(
                fuel_remaining=fuel_remaining,
                fuel_delta_per_lap=features.fuel_delta_per_lap,
                sc_active=sc_active,
                save_mode=features.fuel_remaining < max(4.0, features.laps_remaining * 0.08),
            )
            traffic_penalty, clean_air_probability = self._traffic_model.estimate(
                action=action,
                traffic_density=features.traffic_density,
                gap_ahead_s=features.gap_ahead_s,
                gap_behind_s=features.gap_behind_s,
            )

            lap_time = tyre_projection.expected_lap_time_s + fuel_penalty + traffic_penalty
            total_time += lap_time
            traffic_penalty_total += traffic_penalty

            if clean_air_probability < 0.45:
                traffic_events.append(f"lap+{lap_offset}:dirty_air")

            fuel_remaining = max(0.0, fuel_remaining - features.fuel_delta_per_lap)
            tyre_age += 1

        total_position_shift = round((total_time / max(1, horizon) - features.base_lap_time_s) / 1.8 + opponent_pressure)
        final_position = min(MAX_TRACK_POSITION, max(1, features.player_position + total_position_shift))
        risk_factor = min(1.0, (features.tyre_wear_mean * 0.6) + (traffic_penalty_total / max(1.0, horizon * 3.0)) * 0.4)
        track_position_weight = max(0.0, 1.0 - (final_position - 1) / MAX_TRACK_POSITION)

        return SimulationResult(
            action=action,
            total_time_s=total_time,
            final_position=final_position,
            stint_plan=stint_plan,
            traffic_events=traffic_events,
            traffic_penalty_s=traffic_penalty_total,
            risk_factor=risk_factor,
            track_position_weight=track_position_weight,
            pit_loss_s=pit_loss if pit_lap is not None else 0.0,
        )


class StrategyEvaluator:
    def score(self, result: SimulationResult) -> float:
        return (
            -result.total_time_s
            -result.traffic_penalty_s
            -result.risk_factor * 4.0
            +result.track_position_weight * 6.0
        )


class DecisionCombiner:
    def __init__(self, alpha: float) -> None:
        self._alpha = min(1.0, max(0.0, alpha))

    def combine(self, simulation_score: float, ml_score: float | None) -> float:
        if ml_score is None:
            return simulation_score
        return (self._alpha * simulation_score) + ((1.0 - self._alpha) * ml_score)


class StrategyEngine:
    def __init__(self, alpha: float = 0.85, ml_model: MLModel | None = None) -> None:
        self._features = FeatureExtractor()
        self._tyre_model = TyreModel()
        self._fuel_model = FuelModel()
        self._pit_loss_model = PitLossModel()
        self._traffic_model = TrafficModel()
        self._opponent_model = OpponentModel()
        self._simulator = RaceSimulator(
            tyre_model=self._tyre_model,
            fuel_model=self._fuel_model,
            pit_loss_model=self._pit_loss_model,
            traffic_model=self._traffic_model,
            opponent_model=self._opponent_model,
        )
        self._evaluator = StrategyEvaluator()
        self._combiner = DecisionCombiner(alpha=alpha)
        self._alpha = min(1.0, max(0.0, alpha))
        self._ml_model = ml_model

    def _confidence(self, best_score: float, second_score: float) -> str:
        score_gap = best_score - second_score
        if score_gap > 2.5:
            return "high"
        if score_gap > 0.9:
            return "medium"
        return "low"

    def _normalized_score(self, best_score: float, second_score: float) -> float:
        spread = max(0.01, abs(best_score - second_score))
        return min(1.0, max(0.0, 0.5 + spread / 6.0))

    def recommend(
        self,
        race_control_state: str,
        tyre_compound: str,
        fuel_kg: float,
        ers_energy: float,
        player_position: int = 1,
        current_lap: int = 1,
        total_laps: int = DEFAULT_TOTAL_LAPS,
        avg_lap_ms: int = 0,
        best_lap_ms: int = 0,
        consistency_pct: float = 70.0,
        gap_ahead_s: float = 1.2,
        gap_behind_s: float = 1.2,
        weather_state: str = "WEATHER_0",
        track_id: str = "TRACK_UNKNOWN",
        **_ignored_kwargs: object,
    ) -> StrategyRecommendation:
        features = self._features.extract(
            race_control_state=race_control_state,
            player_position=player_position,
            tyre_compound=tyre_compound,
            fuel_kg=fuel_kg,
            ers_energy=ers_energy,
            current_lap=current_lap,
            total_laps=total_laps,
            avg_lap_ms=avg_lap_ms,
            best_lap_ms=best_lap_ms,
            consistency_pct=consistency_pct,
            gap_ahead_s=gap_ahead_s,
            gap_behind_s=gap_behind_s,
            weather_state=weather_state,
            track_id=track_id,
        )

        results: list[tuple[SimulationResult, float, float | None, float | None]] = []
        for action in self._simulator.actions():
            sim_result = self._simulator.simulate(action=action, features=features)
            simulation_score = self._evaluator.score(sim_result)
            ml_score: float | None = None
            ml_confidence: float | None = None
            if self._ml_model is not None:
                inference = self._ml_model.predict(action=action, features=features)
                if inference is not None and inference.action == action:
                    ml_score = inference.score
                    ml_confidence = inference.confidence
            final_score = self._combiner.combine(simulation_score=simulation_score, ml_score=ml_score)
            results.append((sim_result, final_score, ml_score, ml_confidence))

        ranked = sorted(results, key=lambda item: item[1], reverse=True)
        best_result, best_score, best_ml_score, best_ml_confidence = ranked[0]
        second_result, second_score, _, _ = ranked[1] if len(ranked) > 1 else ranked[0]

        candidates = [
            CandidateScore(
                action=result.action,
                score=score,
                reason=(
                    f"total={result.total_time_s:.2f}s, pit_loss={result.pit_loss_s:.2f}s, "
                    f"traffic={result.traffic_penalty_s:.2f}s, final_pos={result.final_position}"
                    + (f", ml={ml_score:.3f}" if ml_score is not None else "")
                ),
            )
            for result, score, ml_score, _ in ranked
        ]

        confidence = self._confidence(best_score, second_score)
        normalized_score = self._normalized_score(best_score, second_score)

        reason = (
            f"{best_result.action} selected from forward simulation. "
            f"Key drivers: tyre_age={features.tyre_age}, traffic_density={features.traffic_density:.2f}, "
            f"pit_loss={best_result.pit_loss_s:.2f}s, laps_remaining={features.laps_remaining}. "
            f"Compared to {second_result.action}, score delta={best_score - second_score:.3f}."
        )
        if best_ml_score is not None and best_ml_confidence is not None:
            reason = (
                f"{reason} ML blend active (alpha={self._alpha:.2f}, "
                f"ml_score={best_ml_score:.3f}, ml_confidence={best_ml_confidence:.2f})."
            )

        key_inputs = {
            "laps_remaining": features.laps_remaining,
            "stint_length": features.stint_length,
            "tyre_compound": features.tyre_compound,
            "tyre_age": features.tyre_age,
            "fuel_remaining_kg": round(features.fuel_remaining, 3),
            "fuel_delta_per_lap": round(features.fuel_delta_per_lap, 3),
            "ers_level_norm": round(features.ers_level_norm, 3),
            "gap_ahead_s": round(features.gap_ahead_s, 3),
            "gap_behind_s": round(features.gap_behind_s, 3),
            "relative_pace_s": round(features.relative_pace_s, 3),
            "traffic_density": round(features.traffic_density, 3),
            "pit_window_status": features.pit_window_status,
            "sc_vsc_status": features.sc_vsc_status,
            "weather_state": features.weather_state,
            "pit_loss_est_s": round(best_result.pit_loss_s, 2),
            "decision_alpha": round(self._alpha, 3),
            "ml_enabled": 1 if self._ml_model is not None else 0,
        }

        return StrategyRecommendation(
            action=best_result.action,
            score=normalized_score,
            confidence=confidence,
            reason=reason,
            key_inputs=key_inputs,
            candidates=candidates,
        )
