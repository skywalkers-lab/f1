from __future__ import annotations

from dataclasses import dataclass
from threading import Lock

from pitwall.domain.strategy import (
    ACTION_PIT_IN_1,
    ACTION_PIT_IN_2,
    ACTION_PIT_NOW,
    ACTION_STAY_OUT,
    FeatureExtractor,
    RaceFeatures,
)
from pitwall.ml.model import ContextualBanditModel, TrainingSample


@dataclass(frozen=True)
class FeedbackSample:
    action: str
    reward: float
    weight: float = 1.0
    features: RaceFeatures | None = None


class StrategyLearningService:
    def __init__(self, model: ContextualBanditModel) -> None:
        self._model = model
        self._lock = Lock()
        self._features = FeatureExtractor()

    @property
    def valid_actions(self) -> tuple[str, ...]:
        return (
            ACTION_PIT_NOW,
            ACTION_PIT_IN_1,
            ACTION_PIT_IN_2,
            ACTION_STAY_OUT,
        )

    def _coerce_action(self, action: str) -> str:
        normalized = (action or "").strip().upper()
        if normalized not in self.valid_actions:
            raise ValueError(f"unsupported_action:{normalized}")
        return normalized

    def features_from_state(self, snapshot: dict) -> RaceFeatures:
        player = snapshot.get("player", {})
        pace = snapshot.get("pace", {})
        leaderboard = snapshot.get("leaderboard", [])

        player_position = int(player.get("position", 1) or 1)
        ahead = next((r for r in leaderboard if int(r.get("position", 0)) == player_position - 1), None)
        behind = next((r for r in leaderboard if int(r.get("position", 0)) == player_position + 1), None)

        return self._features.extract(
            race_control_state=str(snapshot.get("race_control_state", "GREEN")),
            player_position=player_position,
            tyre_compound=str(player.get("tyre_compound", "C3")),
            fuel_kg=float(player.get("fuel", 0.0) or 0.0),
            ers_energy=float(player.get("ers", 0.0) or 0.0),
            current_lap=int(player.get("lap", 1) or 1),
            total_laps=int(snapshot.get("total_laps", 58) or 58),
            avg_lap_ms=int(pace.get("avg_lap_ms", 0) or 0),
            best_lap_ms=int(pace.get("best_lap_ms", 0) or 0),
            consistency_pct=float(pace.get("consistency_pct", 75.0) or 75.0),
            gap_ahead_s=abs(float(ahead.get("gap_to_player_s", 2.0))) if ahead else 2.0,
            gap_behind_s=abs(float(behind.get("gap_to_player_s", 2.0))) if behind else 2.0,
            weather_state=str(snapshot.get("weather_state", "WEATHER_0")),
            track_id=str(snapshot.get("track", "TRACK_UNKNOWN")),
        )

    def add_feedback(self, sample: FeedbackSample, fallback_snapshot: dict | None = None) -> bool:
        action = self._coerce_action(sample.action)
        features = sample.features
        if features is None:
            if fallback_snapshot is None:
                raise ValueError("missing_features")
            features = self.features_from_state(fallback_snapshot)

        with self._lock:
            return self._model.update(
                action=action,
                features=features,
                reward=float(sample.reward),
                weight=float(sample.weight),
            )

    def train_feedback_batch(self, samples: list[FeedbackSample], fallback_snapshot: dict | None = None) -> int:
        training_samples: list[TrainingSample] = []
        for sample in samples:
            action = self._coerce_action(sample.action)
            features = sample.features
            if features is None:
                if fallback_snapshot is None:
                    raise ValueError("missing_features")
                features = self.features_from_state(fallback_snapshot)
            training_samples.append(
                TrainingSample(
                    action=action,
                    reward=float(sample.reward),
                    features=features,
                    weight=float(sample.weight),
                )
            )

        with self._lock:
            return self._model.train_batch(training_samples)

    def save(self, path: str) -> None:
        with self._lock:
            self._model.save(path)

    def status(self) -> dict:
        with self._lock:
            return self._model.metadata()
