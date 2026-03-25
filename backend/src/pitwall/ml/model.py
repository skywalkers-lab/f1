from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pitwall.domain.strategy import MLInference, MLModel, RaceFeatures


@dataclass(frozen=True)
class TrainingSample:
    action: str
    reward: float
    features: RaceFeatures
    weight: float = 1.0


class ContextualBanditModel(MLModel):
    """Pure-Python online linear learner with per-action weights.

    The model is online-updatable and supports blending data from many users
    by repeatedly calling update/train_batch.
    """

    FEATURE_VERSION = 1

    def __init__(self, actions: tuple[str, ...], ridge_lambda: float = 0.02, learning_rate: float = 0.1) -> None:
        self._actions = tuple(actions)
        self._ridge_lambda = max(1e-6, float(ridge_lambda))
        self._learning_rate = max(1e-5, float(learning_rate))
        self._feature_names = [
            "bias",
            "laps_remaining",
            "stint_length",
            "tyre_age",
            "tyre_wear_mean",
            "fuel_remaining",
            "fuel_delta_per_lap",
            "ers_level_norm",
            "gap_ahead_s",
            "gap_behind_s",
            "relative_pace_s",
            "traffic_density",
            "pit_window_open",
            "sc_active",
            "weather_wet",
            "player_position_norm",
            "base_lap_time_s",
        ]
        dim = len(self._feature_names)
        self._weights: dict[str, list[float]] = {
            action: [0.0 for _ in range(dim)] for action in self._actions
        }
        self._grad_sq: dict[str, list[float]] = {
            action: [1e-8 for _ in range(dim)] for action in self._actions
        }
        self._samples_by_action: dict[str, int] = {action: 0 for action in self._actions}
        self._samples_seen = 0

    def _vectorize(self, features: RaceFeatures) -> list[float]:
        pit_window_open = 1.0 if features.pit_window_status == "OPEN" else 0.0
        sc_active = 1.0 if features.sc_vsc_status.endswith("_2") or features.sc_vsc_status.endswith("_3") else 0.0
        weather_wet = 1.0 if features.weather_state in {"WEATHER_3", "WEATHER_4", "WEATHER_5"} else 0.0
        player_position_norm = min(1.0, max(0.0, (features.player_position - 1) / 21.0))

        values = [
            1.0,
            float(features.laps_remaining),
            float(features.stint_length),
            float(features.tyre_age),
            float(features.tyre_wear_mean),
            float(features.fuel_remaining),
            float(features.fuel_delta_per_lap),
            float(features.ers_level_norm),
            float(features.gap_ahead_s),
            float(features.gap_behind_s),
            float(features.relative_pace_s),
            float(features.traffic_density),
            pit_window_open,
            sc_active,
            weather_wet,
            player_position_norm,
            float(features.base_lap_time_s),
        ]

        # Keep feature scales stable to speed up online convergence.
        scale = [
            1.0,
            60.0,
            40.0,
            40.0,
            1.0,
            120.0,
            8.0,
            1.0,
            8.0,
            8.0,
            3.0,
            1.0,
            1.0,
            1.0,
            1.0,
            1.0,
            130.0,
        ]
        return [v / s for v, s in zip(values, scale)]

    def _dot(self, lhs: list[float], rhs: list[float]) -> float:
        return float(sum(a * b for a, b in zip(lhs, rhs)))

    def predict(self, action: str, features: RaceFeatures) -> MLInference | None:
        if action not in self._weights:
            return None
        x = self._vectorize(features)
        w = self._weights[action]
        score = self._dot(w, x)
        uncertainty = 1.0 / ((self._samples_by_action[action] + 1) ** 0.5)
        confidence = 1.0 / (1.0 + uncertainty)
        return MLInference(action=action, score=score, confidence=confidence)

    def update(self, action: str, features: RaceFeatures, reward: float, weight: float = 1.0) -> bool:
        if action not in self._weights:
            return False
        safe_weight = max(0.01, float(weight))
        x = self._vectorize(features)
        w = self._weights[action]
        g2 = self._grad_sq[action]

        prediction = self._dot(w, x)
        error = float(reward) - prediction

        for i, x_i in enumerate(x):
            grad = -2.0 * safe_weight * error * x_i + self._ridge_lambda * w[i]
            g2[i] += grad * grad
            adjusted_lr = self._learning_rate / (g2[i] ** 0.5)
            w[i] -= adjusted_lr * grad

        self._samples_by_action[action] += 1
        self._samples_seen += 1
        return True

    def train_batch(self, samples: list[TrainingSample]) -> int:
        learned = 0
        for sample in samples:
            learned += 1 if self.update(sample.action, sample.features, sample.reward, sample.weight) else 0
        return learned

    def metadata(self) -> dict[str, Any]:
        return {
            "model": "online_linear_adagrad",
            "feature_version": self.FEATURE_VERSION,
            "actions": list(self._actions),
            "samples_seen": self._samples_seen,
            "ridge_lambda": self._ridge_lambda,
            "learning_rate": self._learning_rate,
            "feature_count": len(self._feature_names),
        }

    def save(self, path: str) -> None:
        payload = {
            "metadata": self.metadata(),
            "feature_names": self._feature_names,
            "weights": {action: self._weights[action] for action in self._actions},
            "grad_sq": {action: self._grad_sq[action] for action in self._actions},
            "samples_by_action": self._samples_by_action,
        }
        output_path = Path(path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(payload, ensure_ascii=True), encoding="utf-8")

    @classmethod
    def load(cls, path: str, actions: tuple[str, ...], ridge_lambda: float = 0.02) -> "ContextualBanditModel":
        instance = cls(actions=actions, ridge_lambda=ridge_lambda)
        file_path = Path(path)
        if not file_path.exists():
            return instance

        payload = json.loads(file_path.read_text(encoding="utf-8"))
        metadata = payload.get("metadata", {})
        if int(metadata.get("feature_version", 0)) != cls.FEATURE_VERSION:
            return instance

        for action in instance._actions:
            if action in payload.get("weights", {}):
                instance._weights[action] = [float(v) for v in payload["weights"][action]]
            if action in payload.get("grad_sq", {}):
                instance._grad_sq[action] = [float(v) for v in payload["grad_sq"][action]]

        raw_samples_by_action = payload.get("samples_by_action", {})
        for action in instance._actions:
            instance._samples_by_action[action] = int(raw_samples_by_action.get(action, 0))
        instance._samples_seen = int(metadata.get("samples_seen", 0))
        return instance
