from typing import Any, Dict

import numpy as np
import random
from rlgym.api import StateMutator
from transcendence_sim import state as layout

from . import common_values as cv
from .state import GameState


def yaw_quaternion(yaw: float) -> np.ndarray:
    return np.array([0.0, np.sin(yaw * 0.5), 0.0, np.cos(yaw * 0.5)], dtype=np.float32)


class MutatorSequence(StateMutator[GameState]):
    def __init__(self, *mutators: StateMutator):
        self.mutators = mutators

    def apply(self, state: GameState, shared_info: Dict[str, Any]) -> None:
        for mutator in self.mutators:
            mutator.apply(state, shared_info)


class KickoffMutator(StateMutator[GameState]):
    def apply(self, state: GameState, shared_info: Dict[str, Any]) -> None:
        blue_idx = 0
        orange_idx = 0

        for car in state.cars.values():
            if car.is_blue:
                # Team 1 (Blue) spawns on the negative Z side (-35)
                spawn = cv.PLAYER_SPAWN_POINTS[3 + (blue_idx % 3)]
                blue_idx += 1
            else:
                # Team 0 (Orange) spawns on the positive Z side (+35)
                spawn = cv.PLAYER_SPAWN_POINTS[orange_idx % 3]
                orange_idx += 1

            to_ball = cv.BALL_SPAWN_POINT - spawn
            yaw = float(np.arctan2(-to_ball[0], -to_ball[2]))

            car.position[:] = spawn
            car.rotation[:] = yaw_quaternion(yaw)
            car.linear_velocity[:] = 0.0
            car.angular_velocity[:] = 0.0
            state.data[car._offset + layout.CAR_ON_GROUND] = 1.0

        state.ball.position[:] = cv.BALL_SPAWN_POINT
        state.ball.linear_velocity[:] = 0.0
        state.ball.angular_velocity[:] = 0.0


class RandomKickoffMutator(StateMutator[GameState]):
    def __init__(self, probability: float = 0.6, car_speed: float = 10.0, ball_speed: float = 8.0, seed=None):
        self.probability = probability
        self.car_speed = car_speed
        self.ball_speed = ball_speed
        self.rng = np.random.default_rng(seed)

    def apply(self, state: GameState, shared_info: Dict[str, Any]) -> None:
        rng = self.rng
        if rng.random() >= self.probability:
            return

        for car in state.cars.values():
            # Orange (Team 0) gets positive side, Blue (Team 1) gets negative side
            z_min = 5.0 if car.is_orange else -45.0
            z_max = 45.0 if car.is_orange else -5.0

            car.position[:] = [
                rng.uniform(-30.0, 30.0),
                0.5,
                rng.uniform(z_min, z_max),
            ]
            car.rotation[:] = yaw_quaternion(rng.uniform(-np.pi, np.pi))
            car.linear_velocity[:] = [
                rng.uniform(-self.car_speed, self.car_speed),
                0.0,
                rng.uniform(-self.car_speed, self.car_speed),
            ]
            car.angular_velocity[:] = 0.0
            state.data[car._offset + layout.CAR_ON_GROUND] = 1.0

        state.ball.position[:] = [
            rng.uniform(-25.0, 25.0),
            rng.uniform(2.0, 6.0),
            rng.uniform(-35.0, 35.0),
        ]
        state.ball.linear_velocity[:] = [
            rng.uniform(-self.ball_speed, self.ball_speed),
            0.0,
            rng.uniform(-self.ball_speed, self.ball_speed),
        ]
        state.ball.angular_velocity[:] = 0.0

class VariableTeamSizeMutator(StateMutator[GameState]):
    def __init__(self, mode_weights: Dict[tuple, float]):
        self.mode_weights = mode_weights

    def apply(self, state: GameState, shared_info: Dict[str, Any]) -> None:
        keys, values = zip(*self.mode_weights.items())
        mode = random.choices(keys, weights=values)[0]
        blue_size, orange_size = mode

        blue_count = 0
        orange_count = 0
        keys_to_remove = []

        for agent, car in state.cars.items():
            if car.is_blue:
                if blue_count < blue_size:
                    blue_count += 1
                else:
                    keys_to_remove.append(agent)
            else:
                if orange_count < orange_size:
                    orange_count += 1
                else:
                    keys_to_remove.append(agent)

        for agent in keys_to_remove:
            car = state.cars[agent]
            car.position[:] = [10000.0, -100.0, 10000.0]  # The Shadow Realm
            car.linear_velocity[:] = 0.0
            car.angular_velocity[:] = 0.0
            del state.cars[agent]