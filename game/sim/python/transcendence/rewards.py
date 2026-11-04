from typing import Any, Dict, List, Tuple, Callable

import numpy as np
from rlgym.api import RewardFunction

from . import common_values as cv
from .state import GameState
from statistics import fmean

class CombinedReward(RewardFunction[str, GameState, float]):
    def __init__(self, *rewards_and_weights: Tuple[RewardFunction, float]):
        self.rewards = [pair[0] for pair in rewards_and_weights]
        self.weights = [pair[1] for pair in rewards_and_weights]

    def reset(self, agents: List[str], initial_state: GameState, shared_info: Dict[str, Any]) -> None:
        for reward in self.rewards:
            reward.reset(agents, initial_state, shared_info)

    def get_rewards(
        self,
        agents: List[str],
        state: GameState,
        is_terminated: Dict[str, bool],
        is_truncated: Dict[str, bool],
        shared_info: Dict[str, Any],
    ) -> Dict[str, float]:
        combined = {agent: 0.0 for agent in agents}
        for reward, weight in zip(self.rewards, self.weights):
            values = reward.get_rewards(agents, state, is_terminated, is_truncated, shared_info)
            for agent in agents:
                combined[agent] += values[agent] * weight
        return combined

class DistributeRewardsWrapper(RewardFunction[str, GameState, float]):
    def __init__(
            self,
            reward_fn: RewardFunction,
            *,
            selflessness: float = 1.0,
            selfishness: float = None,
            team_coef: float = 0.5,
            opp_coef: float = None,
            agg_method: Callable[[list[float]], float] = fmean,
    ):
        self.reward_fn = reward_fn
        self.selflessness = selflessness
        self.selfishness = selfishness if selfishness is not None else (1 - selflessness)
        self.team_coef = team_coef
        self.opp_coef = opp_coef if opp_coef is not None else (1 - team_coef)
        self.agg_method = agg_method

    def reset(self, agents: List[str], initial_state: GameState, shared_info: Dict[str, Any]) -> None:
        self.reward_fn.reset(agents, initial_state, shared_info)
        
    def get_rewards(self, agents: List[str], state: GameState, is_terminated: Dict[str, bool],
                    is_truncated: Dict[str, bool], shared_info: Dict[str, Any]) -> Dict[str, float]:
        base_rewards = self.reward_fn.get_rewards(
            list(state.cars.keys()), state, is_terminated, is_truncated, shared_info
        )
        blue_rewards = []
        orange_rewards = []
        for agent, car in state.cars.items():
            if car.is_blue:
                blue_rewards.append(base_rewards[agent])
            else:
                orange_rewards.append(base_rewards[agent])
        
        # Safe fallback if a team is empty
        agg_blue = self.agg_method(blue_rewards) if blue_rewards else 0.0
        agg_orange = self.agg_method(orange_rewards) if orange_rewards else 0.0
        adjusted_rewards = {}
        for agent in agents:
            rew = base_rewards[agent]
            if state.cars[agent].is_blue:
                team_agg, opp_agg = agg_blue, agg_orange
            else:
                team_agg, opp_agg = agg_orange, agg_blue
                
            spirit_reward = self.selfishness * rew + self.selflessness * team_agg
            adjusted_reward = self.team_coef * spirit_reward - self.opp_coef * opp_agg
            adjusted_rewards[agent] = adjusted_reward
        return adjusted_rewards


class GoalReward(RewardFunction[str, GameState, float]):
    def reset(self, agents: List[str], initial_state: GameState, shared_info: Dict[str, Any]) -> None:
        pass

    def get_rewards(self, agents, state, is_terminated, is_truncated, shared_info):
        rewards = {}
        for agent in agents:
            car = state.cars[agent]
            scored = 0.0
            conceded = 0.0

            if state.ball_in_goal:
                if state.scoring_team == car.team:
                    scored = 1.0
                else:
                    conceded = -1.0

            rewards[agent] = scored + conceded
        return rewards

class JumpPenaltyReward(RewardFunction[str, GameState, float]):
    def reset(self, agents: List[str], initial_state: GameState, shared_info: Dict[str, Any]) -> None:
        pass

    def get_rewards(self, agents: List[str], state: GameState, is_terminated: Dict[str, bool], is_truncated: Dict[str, bool], shared_info: Dict[str, Any]) -> Dict[str, float]:
        rewards = {}
        for agent in agents:
            car = state.cars[agent]
            distance = np.linalg.norm(state.ball.position - car.position)
            if not car.on_ground and distance > 15.0:
                rewards[agent] = -1.0
            else:
                rewards[agent] = 0.0
        return rewards
        
class TouchReward(RewardFunction[str, GameState, float]):
    def reset(self, agents: List[str], initial_state: GameState, shared_info: Dict[str, Any]) -> None:
        pass

    def get_rewards(self, agents, state, is_terminated, is_truncated, shared_info):
        return {agent: 1.0 if state.cars[agent].touched_ball else 0.0 for agent in agents}

class AdvancedTouchReward(RewardFunction[str, GameState, float]):
    def __init__(self, touch_reward: float = 1.0, acceleration_reward: float = 0.0):
        self.touch_reward = touch_reward
        self.acceleration_reward = acceleration_reward
        self.prev_ball_vel = np.zeros(3, dtype=np.float32)

    def reset(self, agents: List[str], initial_state: GameState, shared_info: Dict[str, Any]) -> None:
        self.prev_ball_vel = initial_state.ball.linear_velocity

    def get_rewards(self, agents, state, is_terminated, is_truncated, shared_info):
        rewards = {agent: 0.0 for agent in agents}
        
        # Calculate how much the ball's velocity changed
        dv = np.linalg.norm(state.ball.linear_velocity - self.prev_ball_vel)
        acceleration = float(dv / cv.BALL_MAX_SPEED)
        
        for agent in agents:
            if state.cars[agent].touched_ball:
                # Add the flat reward
                rewards[agent] += self.touch_reward
                
                # Add the acceleration bonus
                rewards[agent] += acceleration * self.acceleration_reward
                
        self.prev_ball_vel = state.ball.linear_velocity
        return rewards     

class SpeedTowardBallReward(RewardFunction[str, GameState, float]):
    def reset(self, agents: List[str], initial_state: GameState, shared_info: Dict[str, Any]) -> None:
        pass

    def get_rewards(self, agents, state, is_terminated, is_truncated, shared_info):
        rewards = {}
        for agent in agents:
            car = state.cars[agent]
            to_ball = state.ball.position - car.position
            distance = np.linalg.norm(to_ball)
            if distance < 1e-4:
                value = 0.0
            else:
                speed = np.dot(car.linear_velocity, to_ball / distance)
                value = float(max(speed / cv.CAR_MAX_SPEED, 0.0))
            rewards[agent] = value
        return rewards


def trajectory_comparison(pos1: np.ndarray, vel1: np.ndarray, pos2: np.ndarray, vel2: np.ndarray):
    """Calculates the time 't' when the two linear trajectories will be closest to each other, respecting arena walls."""
    
    # 1. Find the exact moment either object hits a wall
    max_time = 3.0  # Hard cap at 3 seconds anyway
    
    # In your engine, X/Z are width/length, Y is height. Floor is 0, ceiling is 2*half_Y.
    bounds = np.array([
        [-cv.ARENA_HALF_EXTENTS[0], 0.0, -cv.ARENA_HALF_EXTENTS[2]],
        [ cv.ARENA_HALF_EXTENTS[0], cv.ARENA_HALF_EXTENTS[1] * 2.0, cv.ARENA_HALF_EXTENTS[2]]
    ])
    
    for pos, vel in ((pos1, vel1), (pos2, vel2)):
        # Avoid division by zero by adding a tiny number if vel is 0
        safe_vel = vel + (vel == 0) * 1e-8
        times = (bounds - pos) / safe_vel
        
        # We only care about collisions in the future (t > 0)
        times = times[times > 0]
        if len(times) > 0:
            t_impact = float(np.min(times))
            max_time = min(max_time, t_impact)
            
    # 2. Predict interception (up to the wall impact)
    pos_diff = pos1 - pos2
    vel_diff = vel1 - vel2

    denom = np.dot(vel_diff, vel_diff)
    if denom == 0:
        t = 0.0
    else:
        t = -np.dot(pos_diff, vel_diff) / denom

    # Capped at the moment they hit the wall!
    t = float(np.clip(t, 0.0, max_time))

    curr_dist = np.linalg.norm(pos_diff)
    min_dist = np.linalg.norm(pos_diff + t * vel_diff)
    
    return float(curr_dist), float(min_dist), t

class TrajectorySpeedTowardBallReward(RewardFunction[str, GameState, float]):
    def reset(self, agents: List[str], initial_state: GameState, shared_info: Dict[str, Any]) -> None:
        pass

    def get_rewards(self, agents, state, is_terminated, is_truncated, shared_info):
        rewards = {}
        for agent in agents:
            car = state.cars[agent]
            
            curr_dist, min_dist, t = trajectory_comparison(
                car.position, car.linear_velocity,
                state.ball.position, state.ball.linear_velocity
            )
            
            if t == 0:
                vel = 0.0
            else:
                # How fast is the distance shrinking to the future interception point?
                vel = (curr_dist - min_dist) / t
                
            # Normalize by max possible closing speed
            norm_vel = vel / (cv.CAR_MAX_SPEED + cv.BALL_MAX_SPEED)
            
            # Clip between 0 and 1 so it acts identically to our old SpeedTowardBall
            rewards[agent] = float(max(norm_vel, 0.0))
            
        return rewards

class VelocityBallToGoalReward(RewardFunction[str, GameState, float]):
    def reset(self, agents: List[str], initial_state: GameState, shared_info: Dict[str, Any]) -> None:
        pass

    def get_rewards(self, agents, state, is_terminated, is_truncated, shared_info):
        rewards = {}
        for agent in agents:
            car = state.cars[agent]
            goal = cv.T1_GOAL if car.team == 0 else cv.T0_GOAL
            to_goal = goal - state.ball.position
            distance = np.linalg.norm(to_goal)
            if distance < 1e-4:
                value = 0.0
            else:
                speed = np.dot(state.ball.linear_velocity, to_goal / distance)
                value = float(max(speed / cv.BALL_MAX_SPEED, 0.0))
            rewards[agent] = value
        return rewards


class BallToGoalDistanceReward(RewardFunction[str, GameState, float]):
    def reset(self, agents: List[str], initial_state: GameState, shared_info: Dict[str, Any]) -> None:
        self.previous_orange_target_dist = float(np.linalg.norm(cv.BLUE_GOAL - initial_state.ball.position))
        self.previous_blue_target_dist = float(np.linalg.norm(cv.ORANGE_GOAL - initial_state.ball.position))

    def get_rewards(self, agents, state, is_terminated, is_truncated, shared_info):
        dist_to_blue_goal = float(np.linalg.norm(cv.BLUE_GOAL - state.ball.position))
        dist_to_orange_goal = float(np.linalg.norm(cv.ORANGE_GOAL - state.ball.position))
        
        # How much closer did the ball get to the Blue Goal? (Orange's Target)
        val_orange_target = (self.previous_orange_target_dist - dist_to_blue_goal) / cv.GOAL_DISTANCE
        
        # How much closer did the ball get to the Orange Goal? (Blue's Target)
        val_blue_target = (self.previous_blue_target_dist - dist_to_orange_goal) / cv.GOAL_DISTANCE
        
        self.previous_orange_target_dist = dist_to_blue_goal
        self.previous_blue_target_dist = dist_to_orange_goal
        
        rewards = {}
        for agent in agents:
            car = state.cars[agent]
            rewards[agent] = val_orange_target if car.team == 0 else val_blue_target
        return rewards


class FaceBallReward(RewardFunction[str, GameState, float]):
    def reset(self, agents: List[str], initial_state: GameState, shared_info: Dict[str, Any]) -> None:
        pass

    def get_rewards(self, agents, state, is_terminated, is_truncated, shared_info):
        rewards = {}
        for agent in agents:
            car = state.cars[agent]
            to_ball = state.ball.position - car.position
            distance = np.linalg.norm(to_ball)
            value = 0.0 if distance < 1e-4 else float(np.dot(car.forward, to_ball / distance))
            rewards[agent] = value
        return rewards


class InAirReward(RewardFunction[str, GameState, float]):
    def reset(self, agents: List[str], initial_state: GameState, shared_info: Dict[str, Any]) -> None:
        pass

    def get_rewards(self, agents, state, is_terminated, is_truncated, shared_info):
        rewards = {}
        for agent in agents:
            car = state.cars[agent]
            rewards[agent] = 0.0 if car.on_ground else 1.0
        return rewards
