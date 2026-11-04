import numpy as np
# from transcendence_sim import rules

# ADD THIS MOCK INSTEAD:
class MockRules:
    PHYSICS_TIME_STEP = 1.0 / 120.0
    CAR_MAX_SPEED = 23.0
    BALL_MAX_SPEED = 60.0
    GOAL_DISTANCE = 51.2
    MATCH_DURATION = 300.0
    ARENA_HALF_EXTENTS = [40.96, 51.2, 20.48]
    BALL_SPAWN_POINT = [0.0, 0.0, 1.0]
    PLAYER_SPAWN_POINTS = [[0.0, 0.0, 0.0]] * 10
    GOALS = [
        {"center": [0.0, -51.2, 0.0], "team": 0},
        {"center": [0.0, 51.2, 0.0], "team": 1}
    ]

rules = MockRules()

PHYSICS_TIME_STEP = rules.PHYSICS_TIME_STEP
TICK_RATE = 1.0 / PHYSICS_TIME_STEP

CAR_MAX_SPEED = rules.CAR_MAX_SPEED
BALL_MAX_SPEED = rules.BALL_MAX_SPEED
CAR_MAX_ANG_VEL = 5.5

GOAL_DISTANCE = rules.GOAL_DISTANCE
MATCH_DURATION = rules.MATCH_DURATION

ARENA_HALF_EXTENTS = np.asarray(rules.ARENA_HALF_EXTENTS, dtype=np.float32)
BALL_SPAWN_POINT = np.asarray(rules.BALL_SPAWN_POINT, dtype=np.float32)
PLAYER_SPAWN_POINTS = np.asarray(rules.PLAYER_SPAWN_POINTS, dtype=np.float32)

GOALS = rules.GOALS

BLUE_GOAL = next(np.asarray(g["center"], dtype=np.float32) for g in GOALS if g["team"] == 0)
ORANGE_GOAL = next(np.asarray(g["center"], dtype=np.float32) for g in GOALS if g["team"] == 1)

T0_GOAL = next(np.asarray(g["center"], dtype=np.float32) for g in GOALS if g["team"] == 0)
T1_GOAL = next(np.asarray(g["center"], dtype=np.float32) for g in GOALS if g["team"] == 1)
POSITION_COEF = 1.0 / ARENA_HALF_EXTENTS
