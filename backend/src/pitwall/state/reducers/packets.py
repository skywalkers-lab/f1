from pitwall.state.minimap import MinimapTransformer
from pitwall.state.models import AppState
from pitwall.state.reducers.base import ensure_car


def _short_code_from_name(name: str, car_index: int) -> str:
    clean = "".join(ch for ch in name.upper() if ch.isalnum() or ch == " ").strip()
    if not clean:
        return f"C{car_index:02d}"
    parts = [p for p in clean.split(" ") if p]
    if len(parts) >= 2:
        initials = (parts[0][0] + parts[-1][0])[:3]
        if initials:
            return initials
    compact = "".join(ch for ch in clean if ch.isalnum())
    return (compact[:3] or f"C{car_index:02d}")


def reduce_motion(state: AppState, minimap: MinimapTransformer, payload: object, player_car_index: int) -> None:
    active = set(state.active_car_indices)
    cars = payload.cars
    if active:
        cars = [car for car in cars if car.car_index in active]
    # Ensure minimap has the correct track loaded for reference-based rendering
    minimap.set_track(state.track)
    minimap_dict = minimap.update(cars, player_car_index, state.cars)
    state.minimap.mode = minimap_dict["mode"]
    state.minimap.player_car_index = minimap_dict["player_car_index"]
    state.minimap.cars = minimap_dict["cars"]
    state.minimap.track_trace = minimap_dict["track_trace"]
    state.minimap.transform = minimap_dict["transform"]


def reduce_session(state: AppState, payload: object) -> None:
    state.track = f"TRACK_{payload.track_id}"
    state.session_type = f"SESSION_{payload.session_type}"
    state.weather_state = f"WEATHER_{payload.weather}"
    state.total_laps = payload.total_laps
    state.race_control_state = f"SC_{payload.safety_car_status}"
    if hasattr(payload, 'track_temp_c'):
        state.track_temp_c = int(payload.track_temp_c)
    if hasattr(payload, 'air_temp_c'):
        state.air_temp_c = int(payload.air_temp_c)


def reduce_lap_data(state: AppState, payload: object) -> None:
    active = set(state.active_car_indices)
    observed_active: list[int] = []
    for entry in payload.cars:
        if active and entry.car_index not in active:
            continue
        if entry.car_position <= 0 or entry.current_lap_num <= 0:
            continue
        observed_active.append(entry.car_index)
        car = ensure_car(state, entry.car_index)
        car.position = entry.car_position
        car.current_lap = entry.current_lap_num
        car.current_lap_ms = entry.current_lap_time_ms
        car.last_lap_ms = entry.last_lap_time_ms
        car.is_pitting = entry.pit_status in (1, 2)
        car.delta_to_front_ms = entry.delta_to_car_in_front_ms
        car.delta_to_leader_ms = entry.delta_to_race_leader_ms
        car.penalties_s = entry.penalties
        car.total_warnings = entry.total_warnings
        car.corner_cut_warnings = entry.corner_cut_warnings

    # If participants feed is missing/noisy, derive active grid from lap data.
    if observed_active:
        observed_unique = sorted(set(observed_active))
        if not state.active_car_indices or len(observed_unique) < len(state.active_car_indices):
            state.active_car_indices = observed_unique
    player_entry = state.cars.get(state.player_car_index)
    if player_entry is None or player_entry.position <= 0:
        valid_cars = [car for car in state.cars.values() if car.position > 0]
        if valid_cars:
            # Prefer currently tracked index if still visible, otherwise follow the race leader.
            tracked = next((car for car in valid_cars if car.car_index == state.player_car_index), None)
            selected = tracked if tracked is not None else min(valid_cars, key=lambda c: c.position)
            state.player_car_index = selected.car_index
            player_entry = selected

    if player_entry:
        state.player.position = player_entry.position
        state.player.lap = player_entry.current_lap
        state.player.current_lap_ms = player_entry.current_lap_ms
        state.player.last_lap_ms = player_entry.last_lap_ms
        state.player.time_penalties_s = player_entry.penalties_s
        state.player.total_warnings = player_entry.total_warnings
        state.player.corner_cut_warnings = player_entry.corner_cut_warnings


def reduce_event(state: AppState, payload: object) -> None:
    state.last_event_summary = payload.event_code


def reduce_participants(state: AppState, payload: object) -> None:
    active_indices: list[int] = []
    for entry in payload.entries:
        if not (0 <= entry.car_index < 22):
            continue
        if entry.car_index < payload.num_active_cars:
            active_indices.append(entry.car_index)
        if not entry.name:
            continue
        state.driver_names[entry.car_index] = entry.name
        state.driver_codes[entry.car_index] = _short_code_from_name(entry.name, entry.car_index)

    if active_indices:
        state.active_car_indices = sorted(set(active_indices))
        active_set = set(state.active_car_indices)
        stale = [idx for idx in state.cars.keys() if idx not in active_set]
        for idx in stale:
            state.cars.pop(idx, None)


def reduce_car_telemetry(state: AppState, payload: object) -> None:
    active = set(state.active_car_indices)
    if active and payload.player_index not in active:
        return

    # In spectator mode, lock focus index from lap data and avoid per-packet jumps.
    if 0 <= payload.player_index < 22 and (state.player_car_index not in state.cars):
        state.player_car_index = payload.player_index

    if payload.player_index != state.player_car_index and state.player.position > 0:
        return

    state.player.speed = payload.player.speed
    state.player.throttle = payload.player.throttle
    state.player.brake = payload.player.brake
    state.player.gear = payload.player.gear
    state.player.rpm = payload.player.rpm
    state.player.drs_enabled = payload.player.drs > 0
    state.player.brake_temps_c = list(payload.player.brake_temps_c)
    state.player.tyre_surface_temps_c = list(payload.player.tyre_surface_temps_c)
    state.player.tyre_inner_temps_c = list(payload.player.tyre_inner_temps_c)
    state.player.engine_temp_c = payload.player.engine_temp_c


def reduce_car_status(state: AppState, payload: object) -> None:
    active = set(state.active_car_indices)
    if active and payload.player_index not in active:
        return

    if 0 <= payload.player_index < 22 and (state.player_car_index not in state.cars):
        state.player_car_index = payload.player_index

    if payload.player_index != state.player_car_index and state.player.position > 0:
        return

    state.player.fuel = payload.player.fuel_in_tank
    state.player.ers = payload.player.ers_store_energy
    state.player.tyres_age_laps = payload.player.tyres_age_laps
    compound = f"C{payload.player.visual_tyre_compound}"
    state.player.tyre_compound = compound
    player_car = ensure_car(state, state.player_car_index)
    player_car.tyre_compound = compound
    player_car.tyres_age_laps = payload.player.tyres_age_laps


def reduce_car_damage(state: AppState, payload: object) -> None:
    """Update tyre damage percentages for all cars from CAR_DAMAGE packet."""
    active = set(state.active_car_indices)
    for entry in payload.cars:
        if active and entry.car_index not in active:
            continue
        car = state.cars.get(entry.car_index)
        if car is None:
            continue
        # Average front/rear tyre structural damage as a proxy for wear
        avg_damage = sum(entry.tyres_damage) / 4.0
        car.tyre_wear_pct = round(avg_damage, 1)


def reduce_session_history(state: AppState, payload: object) -> None:
    """Update lap history data for a single car from SESSION_HISTORY packet."""
    car_index = payload.car_index
    if not (0 <= car_index < 22):
        return
    # Use sector marks from the latest lap to update sector_marks on leaderboard
    # (store for use in rebuild_leaderboard)
    if payload.num_laps > 0 and payload.lap_history:
        last = payload.lap_history[-1]
        # Store in cars state for leaderboard rebuild
        car = state.cars.get(car_index)
        if car is not None:
            car.last_lap_ms = last.lap_time_ms if last.lap_time_ms > 0 else car.last_lap_ms
