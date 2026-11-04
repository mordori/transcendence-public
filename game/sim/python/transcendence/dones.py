from typing import Any, Dict, List

from rlgym.api import DoneCondition

from . import common_values as cv
from .state import GameState


class GoalCondition(DoneCondition[str, GameState]):
    def reset(self, agents: List[str], initial_state: GameState, shared_info: Dict[str, Any]) -> None:
        pass

    def is_done(self, agents: List[str], state: GameState, shared_info: Dict[str, Any]) -> Dict[str, bool]:
        return {agent: state.ball_in_goal for agent in agents}


class TimeoutCondition(DoneCondition[str, GameState]):
    def __init__(self, timeout_seconds: float):
        self.timeout_ticks = int(round(timeout_seconds * cv.TICK_RATE))

    def reset(self, agents: List[str], initial_state: GameState, shared_info: Dict[str, Any]) -> None:
        pass

    def is_done(self, agents: List[str], state: GameState, shared_info: Dict[str, Any]) -> Dict[str, bool]:
        done = state.step_count >= self.timeout_ticks
        return {agent: done for agent in agents}


class NoTouchTimeoutCondition(DoneCondition[str, GameState]):
    def __init__(self, timeout_seconds: float):
        self.timeout_ticks = int(round(timeout_seconds * cv.TICK_RATE))
        self.last_touch_tick = 0

    def reset(self, agents: List[str], initial_state: GameState, shared_info: Dict[str, Any]) -> None:
        self.last_touch_tick = initial_state.step_count

    def is_done(self, agents: List[str], state: GameState, shared_info: Dict[str, Any]) -> Dict[str, bool]:
        any_touched = any(car.touched_ball for car in state.cars.values())
        if any_touched:
            self.last_touch_tick = state.step_count
        done = state.step_count - self.last_touch_tick >= self.timeout_ticks
        return {agent: done for agent in agents}


class AnyCondition(DoneCondition[str, GameState]):
    def __init__(self, *conditions: DoneCondition):
        self.conditions = conditions

    def reset(self, agents: List[str], initial_state: GameState, shared_info: Dict[str, Any]) -> None:
        for condition in self.conditions:
            condition.reset(agents, initial_state, shared_info)

    def is_done(self, agents: List[str], state: GameState, shared_info: Dict[str, Any]) -> Dict[str, bool]:
        combined = {agent: False for agent in agents}
        for condition in self.conditions:
            values = condition.is_done(agents, state, shared_info)
            for agent in agents:
                combined[agent] = combined[agent] or values[agent]
        return combined


class AllCondition(DoneCondition[str, GameState]):
    def __init__(self, *conditions: DoneCondition):
        self.conditions = conditions

    def reset(self, agents: List[str], initial_state: GameState, shared_info: Dict[str, Any]) -> None:
        for condition in self.conditions:
            condition.reset(agents, initial_state, shared_info)

    def is_done(self, agents: List[str], state: GameState, shared_info: Dict[str, Any]) -> Dict[str, bool]:
        combined = {agent: True for agent in agents}
        for condition in self.conditions:
            values = condition.is_done(agents, state, shared_info)
            for agent in agents:
                combined[agent] = combined[agent] and values[agent]
        return combined
