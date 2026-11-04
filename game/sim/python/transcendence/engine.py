from typing import Any, Dict, List

import numpy as np
import transcendence_sim
from rlgym.api import TransitionEngine
from transcendence_sim import state as layout

from .state import GameState



class TranscendenceEngine(TransitionEngine[str, GameState, np.ndarray]):
    def __init__(self, asset_dir: str ="", spawn_opponents=True):
        num_blue = 3
        num_orange = 3 if spawn_opponents else 0
        self._sim = transcendence_sim.Sim(num_blue, num_orange)
        if not self._sim.has_stadium:
            raise RuntimeError(
                "stadium collision meshes could not be loaded; the simulation fell back to a flat "
                "plane and would train against a game that does not exist. Set TRANSCENDENCE_ASSETS "
                "to the directory holding stadium.glb and stadium_col.glb."
            )
        self._state = GameState.from_sim(self._sim)
        self._config: Dict[str, Any] = {}
        self._agents = list(self._state.cars.keys())
        self._max_num_agents = 6

    @property
    def agents(self) -> List[str]:
        return self._agents

    @property
    def max_num_agents(self) -> int:
        return self._max_num_agents

    @property
    def state(self) -> GameState:
        return self._state

    @property
    def config(self) -> Dict[str, Any]:
        return self._config

    @config.setter
    def config(self, value: Dict[str, Any]):
        self._config = value

    def step(self, actions, shared_info):
        sequences = {
            agent: np.atleast_2d(np.asarray(action, dtype=np.float32))
            for agent, action in actions.items()
        }
        for sequence in sequences.values():
            if sequence.shape[1] != 5:
                raise ValueError("Expected five buttons per action")

        ticks = max((len(s) for s in sequences.values()), default=1)
        ticks = max(ticks, 1)
        num_cars = int(self._state.data[layout.NUM_CARS])
        inputs = np.zeros((num_cars, 5), dtype=np.float32)
        touches = {agent: False for agent in self._agents}

        for tick in range(ticks):
            inputs.fill(0)

            for agent in self._agents:
                sequence = sequences.get(agent)
                if sequence is None or tick >= len(sequence):
                    continue

                car = self._state.cars[agent]
                slot = (
                    car._offset - layout.CAR_BASE_OFFSET
                ) // layout.CAR_SIZE
                inputs[slot] = sequence[tick]

            self._sim.step(inputs.ravel().tolist())
            state = GameState.from_sim(self._sim)

            for agent in list(state.cars):
                if agent not in self._agents:
                    del state.cars[agent]

            for agent, car in state.cars.items():
                touches[agent] |= car.touched_ball

            if state.ball_in_goal:
                break

        for agent, car in state.cars.items():
            state.data[
                car._offset + layout.CAR_TOUCHED_BALL
            ] = float(touches[agent])

        self._state = state
        return state

    def create_base_state(self) -> GameState:
        self._sim.reset()
        return GameState.from_sim(self._sim)

    def set_state(self, desired_state: GameState, shared_info: Dict[str, Any]) -> GameState:
        self._sim.set_state(desired_state.data.tolist())
        self._state = GameState.from_sim(self._sim)

        self._agents = list(desired_state.cars.keys())
        
        for agent in list(self._state.cars.keys()):
            if agent not in self._agents:
                del self._state.cars[agent]

        return self._state

    def close(self) -> None:
        pass
