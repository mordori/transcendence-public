class state:
    NUM_CARS = 0
    BALL_POSITION = 1
    BALL_LINEAR_VELOCITY = 4
    BALL_ANGULAR_VELOCITY = 7
    BALL_IN_GOAL = 10
    SCORING_TEAM = 11
    STEP_COUNT = 12

    CAR_BASE_OFFSET = 13
    CAR_SIZE = 16
    CAR_TEAM = 0
    CAR_POSITION = 1
    CAR_ROTATION = 4
    CAR_LINEAR_VELOCITY = 8
    CAR_ANGULAR_VELOCITY = 11
    CAR_ON_GROUND = 14
    CAR_TOUCHED_BALL = 15

class rules:
    PHYSICS_TIME_STEP = 1.0 / 120.0
    CAR_MAX_SPEED = 40.0
    BALL_MAX_SPEED = 60.0
    GOAL_DISTANCE = 58.0
    MATCH_DURATION = 300.0
    ARENA_HALF_EXTENTS = (40.0, 8.9, 54.0)
    BALL_SPAWN_POINT = (0.0, 2.0, 0.0)
    PLAYER_SPAWN_POINTS = [(0.0, 0.5, 35.0), (-15.0, 0.5, 25.0), (15.0, 0.5, 25.0), (0.0, 0.5, -35.0), (-15.0, 0.5, -25.0), (15.0, 0.5, -25.0)]
    GOALS = [{'center': (0.0, 3.85, 60.0), 'half_extents': (9.9, 3.85, 6.0), 'team': 0}, {'center': (0.0, 3.85, -60.0), 'half_extents': (9.9, 3.85, 6.0), 'team': 1}]

class physics:
    WORLD_UP = (0.0, 1.0, 0.0)
    WORLD_FORWARD = (0.0, 0.0, -1.0)