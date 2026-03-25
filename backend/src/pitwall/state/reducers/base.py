from pitwall.state.models import AppState, CarRaceState


def ensure_car(state: AppState, car_index: int) -> CarRaceState:
    if car_index not in state.cars:
        state.cars[car_index] = CarRaceState(car_index=car_index)
    return state.cars[car_index]
