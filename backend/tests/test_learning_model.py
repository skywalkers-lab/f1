# pyright: reportMissingImports=false

from pathlib import Path

from pitwall.domain.strategy import (
    ACTION_PIT_IN_1,
    ACTION_PIT_IN_2,
    ACTION_PIT_NOW,
    ACTION_STAY_OUT,
    RaceFeatures,
)
from pitwall.ml.model import ContextualBanditModel, TrainingSample


def _features() -> RaceFeatures:
    return RaceFeatures(
        laps_remaining=20,
        stint_length=18,
        tyre_compound="C4",
        tyre_age=18,
        tyre_wear_mean=0.6,
        fuel_remaining=24.0,
        fuel_delta_per_lap=1.2,
        ers_level_norm=0.4,
        gap_ahead_s=1.0,
        gap_behind_s=1.8,
        relative_pace_s=0.35,
        traffic_density=0.55,
        pit_window_status="OPEN",
        sc_vsc_status="SC_0",
        weather_state="WEATHER_0",
        player_position=7,
        track_id="TRACK_1",
        base_lap_time_s=91.2,
    )


def test_contextual_bandit_learns_from_batch_feedback():
    actions = (ACTION_PIT_NOW, ACTION_PIT_IN_1, ACTION_PIT_IN_2, ACTION_STAY_OUT)
    model = ContextualBanditModel(actions=actions)
    feat = _features()

    samples = [
        TrainingSample(action=ACTION_PIT_NOW, reward=1.6, features=feat),
        TrainingSample(action=ACTION_PIT_NOW, reward=1.3, features=feat),
        TrainingSample(action=ACTION_PIT_IN_1, reward=0.6, features=feat),
        TrainingSample(action=ACTION_PIT_IN_2, reward=0.3, features=feat),
        TrainingSample(action=ACTION_STAY_OUT, reward=-0.9, features=feat),
    ]
    learned = model.train_batch(samples)

    assert learned == len(samples)

    scores = {
        action: model.predict(action, feat).score
        for action in actions
    }
    best_action = max(scores.items(), key=lambda item: item[1])[0]
    assert best_action == ACTION_PIT_NOW


def test_contextual_bandit_save_and_load_roundtrip(tmp_path: Path):
    actions = (ACTION_PIT_NOW, ACTION_PIT_IN_1, ACTION_PIT_IN_2, ACTION_STAY_OUT)
    model = ContextualBanditModel(actions=actions)
    feat = _features()
    model.update(action=ACTION_STAY_OUT, features=feat, reward=0.8)

    target = tmp_path / "strategy_model.json"
    model.save(str(target))

    loaded = ContextualBanditModel.load(str(target), actions=actions)
    before = model.predict(ACTION_STAY_OUT, feat)
    after = loaded.predict(ACTION_STAY_OUT, feat)

    assert before is not None
    assert after is not None
    assert abs(before.score - after.score) < 1e-9
    assert loaded.metadata()["samples_seen"] == model.metadata()["samples_seen"]
