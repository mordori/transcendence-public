from typing import Any, Dict, List, Tuple

import numpy as np
from rlgym.api import ObsBuilder

from . import common_values as cv
from .state import GameState

OBS_VECTORS = 8
OBS_SCALARS = 4
NUM_CARS = 5
SIZE_CAR = 16
OBS_SIZE = (OBS_VECTORS * 3 + OBS_SCALARS) + (NUM_CARS * SIZE_CAR)



class DefaultObs(ObsBuilder[str, np.ndarray, GameState, Tuple[str, int]]):
    def __init__(
        self,
        pos_coef=None,
        lin_vel_coef=None,
        ang_vel_coef=None,
    ):
        self.pos_coef = cv.POSITION_COEF if pos_coef is None else np.asarray(pos_coef, dtype=np.float32)
        self.lin_vel_coef = 1.0 / cv.CAR_MAX_SPEED if lin_vel_coef is None else lin_vel_coef
        self.ang_vel_coef = 1.0 / cv.CAR_MAX_ANG_VEL if ang_vel_coef is None else ang_vel_coef

    def get_obs_space(self, agent: str) -> Tuple[str, int]:
        return "real", OBS_SIZE

    def reset(self, agents: List[str], initial_state: GameState, shared_info: Dict[str, Any]) -> None:
        pass

    def build_obs(self, agents: List[str], state: GameState, shared_info: Dict[str, Any]) -> Dict[str, np.ndarray]:
        obs_dict = {}
        for agent in agents:
            obs = self._build(state, agent)
            if obs.shape[0] != OBS_SIZE:
                raise ValueError(f"obs builder produced {obs.shape[0]} values but get_obs_space reports {OBS_SIZE}")
            obs_dict[agent] = obs
        return obs_dict

    def _build(self, state: GameState, agent_id: str) -> np.ndarray:
        car = state.cars[agent_id]
        ball = state.ball
        attacking_goal = cv.T1_GOAL if car.team == 0 else cv.T0_GOAL
        defending_goal = cv.T0_GOAL if car.team == 0 else cv.T1_GOAL

        to_ball = ball.position - car.position
        to_attacking = attacking_goal - car.position
        to_defending = defending_goal - car.position
        ball_to_attacking = attacking_goal - ball.position


        obs = [
            car.to_local(to_ball) * self.pos_coef,
            car.to_local(to_attacking) * self.pos_coef,
            car.to_local(to_defending) * self.pos_coef,
            car.to_local(ball_to_attacking) * self.pos_coef,
            car.to_local(car.linear_velocity) * self.lin_vel_coef,
            car.to_local(ball.linear_velocity - car.linear_velocity) * self.lin_vel_coef,
            car.to_local(car.angular_velocity) * self.ang_vel_coef,
            car.up,
            [
                1.0 if car.on_ground else 0.0,
                1.0 if car.touched_ball else 0.0,
                np.linalg.norm(to_ball) * self.pos_coef[2],
                ball.position[1] * self.pos_coef[1],
            ]
        ]

        teammates = [c for name, c in state.cars.items() if name != agent_id and c.team == car.team]
        for i in range(2):
            if i < len(teammates):
                other = teammates[i]
                obs.extend([
                    car.to_local(other.position - car.position) * self.pos_coef,
                    car.to_local(other.linear_velocity) * self.lin_vel_coef,
                    car.to_local(other.angular_velocity) * self.ang_vel_coef,
                    car.to_local(other.forward),
                    car.to_local(other.up),
                    [1.0 if other.on_ground else 0.0],
                ])
            else:
                obs.append(np.zeros(16, dtype=np.float32))

        opponents = [c for name, c in state.cars.items() if c.team != car.team]

        for i in range(3):
            if i < len(opponents):
                other = opponents[i]
                obs.extend([
                    car.to_local(other.position - car.position) * self.pos_coef,
                    car.to_local(other.linear_velocity) * self.lin_vel_coef,
                    car.to_local(other.angular_velocity) * self.ang_vel_coef,
                    car.to_local(other.forward),
                    car.to_local(other.up),
                    [1.0 if other.on_ground else 0.0],
                ])
            else:
                obs.append(np.zeros(16, dtype=np.float32))

        return np.concatenate(obs).astype(np.float32)