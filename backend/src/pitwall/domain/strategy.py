from dataclasses import dataclass


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


class StrategyEngine:
    def _score_candidates(
        self,
        race_control_state: str,
        player_position: int,
        tyre_compound: str,
        fuel_kg: float,
        ers_energy: float,
    ) -> tuple[list[CandidateScore], dict]:
        sc_discount = 8.0 if "SC_" in race_control_state and not race_control_state.endswith("_0") else 0.0
        tyre_risk = 0.35 if tyre_compound in {"C5", "C4"} else 0.20
        fuel_risk = 0.30 if fuel_kg < 5.0 else 0.10
        traffic_risk = 0.25 if player_position <= 8 else 0.15
        ers_buffer = 0.10 if ers_energy > 2_000_000 else 0.25
        pit_loss_est = 22.5 - sc_discount

        candidates = [
            CandidateScore(
                action="PIT_NOW",
                score=tyre_risk + fuel_risk + (0.2 if sc_discount > 0 else 0.0) - traffic_risk,
                reason=f"Immediate stop benefit with pit loss {pit_loss_est:.1f}s",
            ),
            CandidateScore(
                action="PIT_IN_1",
                score=tyre_risk + 0.05 - (traffic_risk * 0.8),
                reason="Delay one lap to reduce rejoin congestion risk.",
            ),
            CandidateScore(
                action="PIT_IN_2",
                score=tyre_risk - 0.05 - (traffic_risk * 0.6),
                reason="Delay two laps to maximize stint but increase tyre exposure.",
            ),
            CandidateScore(
                action="STAY_OUT",
                score=ers_buffer + traffic_risk - tyre_risk,
                reason="Track position protection outweighs pit gain.",
            ),
        ]
        ranked = sorted(candidates, key=lambda c: c.score, reverse=True)
        key_inputs = {
            "pit_loss_est_s": round(pit_loss_est, 2),
            "tyre_compound": tyre_compound,
            "player_position": player_position,
            "fuel_kg": round(fuel_kg, 2),
            "ers_energy": round(ers_energy, 2),
            "sc_discount_s": round(sc_discount, 2),
        }
        return ranked, key_inputs

    def recommend(
        self,
        race_control_state: str,
        player_position: int,
        tyre_compound: str,
        fuel_kg: float,
        ers_energy: float,
    ) -> StrategyRecommendation:
        ranked, key_inputs = self._score_candidates(
            race_control_state, player_position, tyre_compound, fuel_kg, ers_energy
        )
        best = ranked[0]
        runner_up = ranked[1] if len(ranked) > 1 else best
        score = min(1.0, max(0.0, best.score + 0.4))
        confidence = "high" if score > 0.75 else "medium" if score > 0.55 else "low"
        reason = f"{best.reason} Rejected {runner_up.action}: lower score by {(best.score - runner_up.score):.3f}."
        return StrategyRecommendation(
            action=best.action,
            score=score,
            confidence=confidence,
            reason=reason,
            key_inputs=key_inputs,
            candidates=ranked,
        )
