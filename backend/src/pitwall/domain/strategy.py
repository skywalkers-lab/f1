from dataclasses import dataclass


@dataclass(frozen=True)
class StrategyRecommendation:
    action: str
    score: float
    confidence: str
    reason: str
    key_inputs: dict


class StrategyEngine:
    def recommend(
        self,
        race_control_state: str,
        player_position: int,
        tyre_compound: str,
        fuel_kg: float,
        ers_energy: float,
    ) -> StrategyRecommendation:
        sc_discount = 8.0 if "SC_" in race_control_state and not race_control_state.endswith("_0") else 0.0
        tyre_risk = 0.35 if tyre_compound in {"C5", "C4"} else 0.20
        fuel_risk = 0.30 if fuel_kg < 5.0 else 0.10
        traffic_risk = 0.25 if player_position <= 8 else 0.15
        ers_buffer = 0.10 if ers_energy > 2_000_000 else 0.25

        pit_loss_est = 22.5 - sc_discount
        pit_now_score = tyre_risk + fuel_risk + (0.2 if sc_discount > 0 else 0.0) - traffic_risk
        stay_out_score = ers_buffer + traffic_risk - tyre_risk

        if pit_now_score > stay_out_score:
            action = "PIT_NOW"
            score = min(1.0, max(0.0, pit_now_score + 0.4))
            reason = (
                f"Pit now favored: tyre/fuel risk high, estimated pit loss {pit_loss_est:.1f}s"
                + (" with SC discount applied." if sc_discount > 0 else ".")
            )
        else:
            action = "STAY_OUT"
            score = min(1.0, max(0.0, stay_out_score + 0.4))
            reason = "Stay out favored: track position/traffic penalty outweighs immediate stop gain."

        confidence = "high" if score > 0.75 else "medium" if score > 0.55 else "low"
        return StrategyRecommendation(
            action=action,
            score=score,
            confidence=confidence,
            reason=reason,
            key_inputs={
                "pit_loss_est_s": round(pit_loss_est, 2),
                "tyre_compound": tyre_compound,
                "player_position": player_position,
                "fuel_kg": round(fuel_kg, 2),
                "ers_energy": round(ers_energy, 2),
                "sc_discount_s": round(sc_discount, 2),
            },
        )
