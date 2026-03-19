# pyright: reportMissingImports=false

from pitwall.domain.strategy import (
    ACTION_PIT_IN_1,
    ACTION_PIT_IN_2,
    ACTION_PIT_NOW,
    ACTION_STAY_OUT,
    MLInference,
    RaceFeatures,
    StrategyEngine,
)


class BiasStayOutModel:
    def predict(self, action: str, features: RaceFeatures) -> MLInference | None:
        if action == ACTION_STAY_OUT:
            return MLInference(action=action, score=20.0, confidence=0.9)
        return MLInference(action=action, score=-5.0, confidence=0.4)


def test_strategy_engine_is_deterministic_for_same_inputs():
    engine = StrategyEngine()
    kwargs = {
        "race_control_state": "SC_0",
        "player_position": 6,
        "tyre_compound": "C4",
        "fuel_kg": 18.0,
        "ers_energy": 2_400_000.0,
        "current_lap": 24,
        "total_laps": 58,
        "avg_lap_ms": 91_200,
        "best_lap_ms": 90_800,
        "consistency_pct": 88.0,
        "gap_ahead_s": 1.1,
        "gap_behind_s": 1.5,
        "weather_state": "WEATHER_0",
        "track_id": "TRACK_1",
    }
    rec_a = engine.recommend(**kwargs)
    rec_b = engine.recommend(**kwargs)

    assert rec_a.action == rec_b.action
    assert rec_a.score == rec_b.score
    assert rec_a.confidence == rec_b.confidence
    assert rec_a.reason == rec_b.reason


def test_sc_discount_reduces_pit_loss_estimate():
    engine = StrategyEngine()
    base = engine.recommend(
        race_control_state="SC_0",
        player_position=8,
        tyre_compound="C3",
        fuel_kg=20.0,
        ers_energy=1_900_000.0,
        current_lap=20,
        total_laps=58,
        avg_lap_ms=92_000,
        best_lap_ms=91_500,
        consistency_pct=84.0,
        gap_ahead_s=1.8,
        gap_behind_s=1.7,
        weather_state="WEATHER_1",
        track_id="TRACK_1",
    )
    sc = engine.recommend(
        race_control_state="SC_3",
        player_position=8,
        tyre_compound="C3",
        fuel_kg=20.0,
        ers_energy=1_900_000.0,
        current_lap=20,
        total_laps=58,
        avg_lap_ms=92_000,
        best_lap_ms=91_500,
        consistency_pct=84.0,
        gap_ahead_s=1.8,
        gap_behind_s=1.7,
        weather_state="WEATHER_1",
        track_id="TRACK_1",
    )

    assert sc.key_inputs["pit_loss_est_s"] < base.key_inputs["pit_loss_est_s"]


def test_old_soft_tyre_prefers_pit_capable_actions():
    engine = StrategyEngine()
    rec = engine.recommend(
        race_control_state="SC_0",
        player_position=4,
        tyre_compound="C5",
        fuel_kg=12.0,
        ers_energy=2_100_000.0,
        current_lap=32,
        total_laps=58,
        avg_lap_ms=93_000,
        best_lap_ms=90_500,
        consistency_pct=76.0,
        gap_ahead_s=0.9,
        gap_behind_s=1.0,
        weather_state="WEATHER_0",
        track_id="TRACK_2",
    )

    assert rec.action in {ACTION_PIT_NOW, ACTION_PIT_IN_1, ACTION_PIT_IN_2, ACTION_STAY_OUT}
    assert len(rec.candidates) == 4


def test_ml_hook_can_shift_decision_when_alpha_low():
    engine = StrategyEngine(alpha=0.2, ml_model=BiasStayOutModel())
    rec = engine.recommend(
        race_control_state="SC_0",
        player_position=7,
        tyre_compound="C2",
        fuel_kg=22.0,
        ers_energy=1_800_000.0,
        current_lap=18,
        total_laps=58,
        avg_lap_ms=91_900,
        best_lap_ms=91_000,
        consistency_pct=86.0,
        gap_ahead_s=1.6,
        gap_behind_s=1.4,
        weather_state="WEATHER_0",
        track_id="TRACK_0",
    )

    assert rec.key_inputs["ml_enabled"] == 1
    assert rec.action == ACTION_STAY_OUT
