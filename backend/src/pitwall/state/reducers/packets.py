from pitwall.state.minimap import MinimapTransformer
from pitwall.state.models import AppState
from pitwall.state.reducers.base import ensure_car


def reduce_motion(state: AppState, minimap: MinimapTransformer, payload: object, player_car_index: int) -> None:
    minimap_dict = minimap.update(payload.cars, player_car_index)
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


def reduce_lap_data(state: AppState, payload: object) -> None:
    for entry in payload.cars:
        car = ensure_car(state, entry.car_index)
        car.position = entry.car_position
        car.current_lap = entry.current_lap_num
        car.current_lap_ms = entry.current_lap_time_ms
        car.last_lap_ms = entry.last_lap_time_ms
    player_entry = state.cars.get(state.player_car_index)
    if player_entry:
        state.player.position = player_entry.position
        state.player.lap = player_entry.current_lap
        state.player.current_lap_ms = player_entry.current_lap_ms
        state.player.last_lap_ms = player_entry.last_lap_ms


def reduce_event(state: AppState, payload: object) -> None:
    state.last_event_summary = payload.event_code


def reduce_car_telemetry(state: AppState, payload: object) -> None:
    state.player.ers = payload.player.ers_store_energy


def reduce_car_status(state: AppState, payload: object) -> None:
    state.player.fuel = payload.player.fuel_in_tank
    state.player.ers = payload.player.ers_store_energy
    compound = f"C{payload.player.visual_tyre_compound}"
    state.player.tyre_compound = compound
    player_car = ensure_car(state, state.player_car_index)
    player_car.tyre_compound = compound
