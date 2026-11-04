from rlgym.api import RLGym
from rlgym_ppo.util import RLGymV2GymWrapper

from .action import LookupTableAction, RepeatAction
from .dones import AnyCondition, GoalCondition, NoTouchTimeoutCondition, TimeoutCondition
from .engine import TranscendenceEngine
from .mutators import KickoffMutator, MutatorSequence, RandomKickoffMutator, VariableTeamSizeMutator
from .obs import DefaultObs
from .common_values import ACTION_REPEAT
from .rewards import (
    BallToGoalDistanceReward,
    CombinedReward,
    FaceBallReward,
    GoalReward,
    SpeedTowardBallReward,
    TouchReward,
    VelocityBallToGoalReward,
    InAirReward,
    AdvancedTouchReward,
    TrajectorySpeedTowardBallReward,
    DistributeRewardsWrapper,
    JumpPenaltyReward
)


def build_rlgym_env(action_repeat=ACTION_REPEAT, no_touch_timeout_seconds=15.0, episode_seconds=45.0, randomize=True, spawn_opponents=True):
    action_parser = RepeatAction(LookupTableAction(), repeats=action_repeat)

    termination_condition = GoalCondition()
    truncation_condition = AnyCondition(
        NoTouchTimeoutCondition(timeout_seconds=no_touch_timeout_seconds),
        TimeoutCondition(timeout_seconds=episode_seconds),
    )
    # reward_fn = CombinedReward(
    #     (GoalReward(), 100.0),
    #     (VelocityBallToGoalReward(), 0.5),
    #     (TrajectorySpeedTowardBallReward(), 0.01),
    #     (AdvancedTouchReward(touch_reward=0.1, acceleration_reward=0.9), 0.1),
    #     (FaceBallReward(), 0.001)
    # )
    # reward_fn = CombinedReward(
    # (GoalReward(), 120.0),
    # (VelocityBallToGoalReward(), 2.0)
    # )
    

    # reward_fn = CombinedReward(
    #     (TouchReward(), 50@.0),
    #     (SpeedTowardBallReward(), 5.0),
    #     (FaceBallReward(), 1.0),
    #     (InAirReward(), 0.15)
    # )
    
    team_reward = CombinedReward(
        (GoalReward(), 30.0),
        (VelocityBallToGoalReward(), 2.0),
        (TrajectorySpeedTowardBallReward(), 1.0),
        (AdvancedTouchReward(touch_reward=0.1, acceleration_reward=0.9), 1.0),
        (FaceBallReward(), 0.1)
    )
    distributed_team_reward = DistributeRewardsWrapper(team_reward)

    final_reward = CombinedReward(
        (distributed_team_reward, 1.0),
        (JumpPenaltyReward(), 0.1)
    )


    state_mutator = MutatorSequence(
        VariableTeamSizeMutator({
            (1, 1): 0.1,
            (2, 2): 0.2,
            (3, 3): 0.7
        }),
        KickoffMutator(), 
        RandomKickoffMutator()
    ) if randomize else KickoffMutator()

    return RLGym(
        state_mutator=state_mutator,
        obs_builder=DefaultObs(),
        action_parser=action_parser,
        reward_fn=final_reward,
        termination_cond=termination_condition,
        truncation_cond=truncation_condition,
        transition_engine=TranscendenceEngine(spawn_opponents=spawn_opponents),
    )


def build_env():
    env = build_rlgym_env(spawn_opponents=True)

    env.reset()

    return RLGymV2GymWrapper(env)
