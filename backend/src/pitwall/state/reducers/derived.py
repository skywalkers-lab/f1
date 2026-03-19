from statistics import pstdev
from pitwall.domain.strategy import StrategyEngine
from pitwall.state.models import AppState, LeaderboardRow, PaceSample, StrategyCandidateState, StrategyState


def rebuild_leaderboard(state: AppState) -> None:
    player_pos = state.player.position or 1
    rows: list[LeaderboardRow] = []
    for car in state.cars.values():
        if car.position <= 0:
            continue
        gap = (car.position - player_pos) * 0.85
        rows.append(
            LeaderboardRow(
                position=car.position,
                car_index=car.car_index,
                driver_code=f"C{car.car_index:02d}",
                gap_to_player_s=gap,
                tyre_compound=car.tyre_compound,
                is_pitting=car.is_pitting,
                last_lap_ms=car.last_lap_ms,
            )
        )
    state.leaderboard = sorted(rows, key=lambda r: r.position)[:22]


def rebuild_pace(state: AppState) -> None:
    player = state.player
    if player.last_lap_ms <= 0:
        return
    recent = state.pace.recent[-5:] + [PaceSample(lap=player.lap, lap_time_ms=player.last_lap_ms)]
    dedup: dict[int, PaceSample] = {sample.lap: sample for sample in recent}
    ordered = sorted(dedup.values(), key=lambda s: s.lap)[-6:]
    state.pace.recent = ordered
    laps = [s.lap_time_ms for s in ordered if s.lap_time_ms > 0]
    if laps:
        best = min(laps)
        avg = int(sum(laps) / len(laps))
        dev = pstdev(laps) if len(laps) > 1 else 0.0
        consistency = max(0.0, 100.0 - (dev / max(avg, 1)) * 1000)
        state.pace.best_lap_ms = best
        state.pace.avg_lap_ms = avg
        state.pace.consistency_pct = round(consistency, 1)


def rebuild_strategy(state: AppState, strategy_engine: StrategyEngine) -> None:
    player_pos = state.player.position or 1
    ahead = next((r for r in state.leaderboard if r.position == player_pos - 1), None)
    behind = next((r for r in state.leaderboard if r.position == player_pos + 1), None)

    rec = strategy_engine.recommend(
        race_control_state=state.race_control_state,
        player_position=state.player.position,
        tyre_compound=state.player.tyre_compound,
        fuel_kg=state.player.fuel,
        ers_energy=state.player.ers,
        current_lap=state.player.lap,
        total_laps=state.total_laps,
        avg_lap_ms=state.pace.avg_lap_ms,
        best_lap_ms=state.pace.best_lap_ms,
        consistency_pct=state.pace.consistency_pct,
        gap_ahead_s=abs(ahead.gap_to_player_s) if ahead else 2.0,
        gap_behind_s=abs(behind.gap_to_player_s) if behind else 2.0,
        weather_state=state.weather_state,
        track_id=state.track,
    )
    state.strategy = StrategyState(
        action=rec.action,
        score=rec.score,
        confidence=rec.confidence,
        reason=rec.reason,
        key_inputs=rec.key_inputs,
        candidates=[
            StrategyCandidateState(action=c.action, score=c.score, reason=c.reason)
            for c in rec.candidates
        ],
    )
