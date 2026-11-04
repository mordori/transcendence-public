import numpy as np

class Layout:
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

layout = Layout()

WORLD_FORWARD = np.array([1.0, 0.0, 0.0], dtype=np.float32)
WORLD_UP = np.array([0.0, 0.0, 1.0], dtype=np.float32)

def rotate(quat, vec):
    q = np.asarray(quat[:3], dtype=np.float32)
    w = np.float32(quat[3])
    t = np.cross(q, vec) + w * vec
    return vec + 2.0 * np.cross(q, t)

def inverse_rotate(quat, vec):
    q = -np.asarray(quat[:3], dtype=np.float32)
    w = np.float32(quat[3])
    t = np.cross(q, vec) + w * vec
    return vec + 2.0 * np.cross(q, t)

def invert_vector(vec):
    v = np.array(vec, dtype=np.float32)
    v[0] = -v[0]
    v[1] = -v[1]
    return v

def invert_quat(quat):
    q = np.array(quat, dtype=np.float32)
    q[0] = -q[0]
    q[1] = -q[1]
    return q

class PhysicsObject:
    __slots__ = ("position", "linear_velocity", "angular_velocity", "rotation")

    def __init__(self, data, position, linear_velocity, angular_velocity, invert=False, rotation=None):
        if not invert:
            self.position = data[position:position + 3]
            self.linear_velocity = data[linear_velocity:linear_velocity + 3]
            self.angular_velocity = data[angular_velocity:angular_velocity + 3]
            self.rotation = rotation
        else:
            self.position = invert_vector(data[position:position + 3])
            self.linear_velocity = invert_vector(data[linear_velocity:linear_velocity + 3])
            self.angular_velocity = invert_vector(data[angular_velocity:angular_velocity + 3])
            self.rotation = invert_quat(rotation) if rotation is not None else None

class Car(PhysicsObject):
    __slots__ = ("team", "is_orange", "is_blue", "_data", "_offset", "_inverted_physics")

    def __init__(self, data, offset, invert=False):
        raw_rot = data[offset + layout.CAR_ROTATION:offset + layout.CAR_ROTATION + 4]

        super().__init__(
            data,
            offset + layout.CAR_POSITION,
            offset + layout.CAR_LINEAR_VELOCITY,
            offset + layout.CAR_ANGULAR_VELOCITY,
            invert=invert,
            rotation=raw_rot
        )

        self.team = int(data[offset + layout.CAR_TEAM])
        self.is_blue = (self.team == 0)
        self.is_orange = (self.team == 1)
        self._data = data
        self._offset = offset

        # Create matching inverted physics object reference with rotation included
        self._inverted_physics = PhysicsObject(
            data,
            offset + layout.CAR_POSITION,
            offset + layout.CAR_LINEAR_VELOCITY,
            offset + layout.CAR_ANGULAR_VELOCITY,
            invert=True,
            rotation=raw_rot
        )

    @property
    def on_ground(self):
        return bool(self._data[self._offset + layout.CAR_ON_GROUND] > 0.5)

    @property
    def touched_ball(self):
        return bool(self._data[self._offset + layout.CAR_TOUCHED_BALL] > 0.5)

    @property
    def forward(self):
        return rotate(self.rotation, WORLD_FORWARD)

    @property
    def up(self):
        return rotate(self.rotation, WORLD_UP)

    def to_local(self, world_vector):
        return inverse_rotate(self.rotation, np.asarray(world_vector, dtype=np.float32))

    @property
    def physics(self):
        return self

    @property
    def inverted_physics(self):
        return self._inverted_physics

class GameState:
    __slots__ = ("data", "cars", "ball", "inverted_ball")

    def __init__(self, data=None):
        if data is None:
            raise ValueError("GameState must be initialized with raw float array data.")
        self.data = data

        self.ball = PhysicsObject(
            data, layout.BALL_POSITION, layout.BALL_LINEAR_VELOCITY, layout.BALL_ANGULAR_VELOCITY, invert=False)
        self.inverted_ball = PhysicsObject(
            data, layout.BALL_POSITION, layout.BALL_LINEAR_VELOCITY, layout.BALL_ANGULAR_VELOCITY, invert=True)

        self.cars = {}
        num_cars = int(data[layout.NUM_CARS])
        blue_idx = 0
        orange_idx = 0
        for i in range(num_cars):
            offset = layout.CAR_BASE_OFFSET + i * layout.CAR_SIZE
            car_team = int(data[offset + layout.CAR_TEAM])
            is_orange = (car_team == 1)

            car = Car(data, offset, invert=is_orange)
            if car.is_blue:
                agent_id = f"blue_{blue_idx}"
                blue_idx += 1
            else:
                agent_id = f"orange_{orange_idx}"
                orange_idx += 1
            self.cars[agent_id] = car

    def copy(self):
        return GameState(self.data.copy())

    @property
    def ball_in_goal(self):
        return bool(self.data[layout.BALL_IN_GOAL] > 0.5)

    @property
    def scoring_team(self):
        return int(self.data[layout.SCORING_TEAM])

    @property
    def step_count(self):
        return int(self.data[layout.STEP_COUNT])
