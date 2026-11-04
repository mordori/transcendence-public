"""
Headless simulation of the game, for reinforcement learning.
"""
from __future__ import annotations
import typing
__all__: list[str] = ['FIXED_TIMESTEP', 'OBSERVATION_SIZE', 'Sim']
class Sim:
    def __init__(self) -> None:
        ...
    def observe(self) -> list[float]:
        """
        Current observation.
        """
    def reset(self, seed: typing.SupportsInt | typing.SupportsIndex = 0) -> list[float]:
        """
        Start a fresh episode. Returns the first observation.
        """
    def step(self, up: bool, down: bool, left: bool, right: bool, jump: bool) -> None:
        """
        Apply one action and advance a single fixed timestep.
        """
    @property
    def done(self) -> bool:
        ...
    @property
    def reward(self) -> float:
        ...
    @property
    def step_count(self) -> int:
        ...
FIXED_TIMESTEP: float = 0.01666666753590107
OBSERVATION_SIZE: int = 13
