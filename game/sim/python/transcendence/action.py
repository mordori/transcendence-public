from typing import Any, Dict, List, Tuple

import numpy as np
from rlgym.api import ActionParser

from .state import GameState

LOOKUP_TABLE = np.array(
    [
        [0, 0, 0, 0, 0],
        [1, 0, 0, 0, 0],
        [1, 0, 1, 0, 0],
        [1, 0, 0, 1, 0],
        [0, 1, 0, 0, 0],
        [0, 1, 1, 0, 0],
        [0, 1, 0, 1, 0],
        [0, 0, 1, 0, 0],
        [0, 0, 0, 1, 0],
        [0, 0, 0, 0, 1],
        [1, 0, 0, 0, 1],
        [1, 0, 1, 0, 1],
        [1, 0, 0, 1, 1],
    ],
    dtype=np.float32,
)


class LookupTableAction(ActionParser[str, np.ndarray, np.ndarray, GameState, Tuple[str, int]]):
    def get_action_space(self, agent: str) -> Tuple[str, int]:
        return "discrete", len(LOOKUP_TABLE)

    def reset(self, agents: List[str], initial_state: GameState, shared_info: Dict[str, Any]) -> None:
        pass

    def parse_actions(
        self, actions: Dict[str, np.ndarray], state: GameState, shared_info: Dict[str, Any]
    ) -> Dict[str, np.ndarray]:
        return {agent: LOOKUP_TABLE[int(np.asarray(action).flatten()[0])] for agent, action in actions.items()}


class RepeatAction(ActionParser[str, np.ndarray, np.ndarray, GameState, Tuple[str, int]]):
    def __init__(self, parser: ActionParser, repeats: int = 8):
        self.parser = parser
        self.repeats = repeats

    def get_action_space(self, agent: str) -> Tuple[str, int]:
        return self.parser.get_action_space(agent)

    def reset(self, agents: List[str], initial_state: GameState, shared_info: Dict[str, Any]) -> None:
        self.parser.reset(agents, initial_state, shared_info)

    def parse_actions(
        self, actions: Dict[str, np.ndarray], state: GameState, shared_info: Dict[str, Any]
    ) -> Dict[str, np.ndarray]:
        parsed = self.parser.parse_actions(actions, state, shared_info)
        return {agent: np.repeat(action[np.newaxis, :], self.repeats, axis=0) for agent, action in parsed.items()}
