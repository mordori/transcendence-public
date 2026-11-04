import numpy as np
import transcendence_sim
from transcendence_sim import state as layout

# SIZE = layout.SIZE


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


class PhysicsObject:
    __slots__ = ("position", "linear_velocity", "angular_velocity")

    def __init__(self, data, position, linear_velocity, angular_velocity):
        self.position = data[position:position + 3]
        self.linear_velocity = data[linear_velocity:linear_velocity + 3]
        self.angular_velocity = data[angular_velocity:angular_velocity + 3]


class Car(PhysicsObject):
    __slots__ = ("rotation", "team", "is_orange", "is_blue", "_data", "_offset")

    def __init__(self, data, offset):
        super().__init__(data, offset + layout.CAR_POSITION, offset + layout.CAR_LINEAR_VELOCITY, offset + layout.CAR_ANGULAR_VELOCITY)
        self.rotation = data[offset + layout.CAR_ROTATION:offset + layout.CAR_ROTATION + 4]
        self.team = int(data[offset + layout.CAR_TEAM])
        self.is_orange = (self.team == 0)
        self.is_blue = (self.team == 1)
        self._data = data
        self._offset = offset

    @property
    def on_ground(self):
        return bool(self._data[self._offset + layout.CAR_ON_GROUND] > 0.5)

    @property
    def touched_ball(self):
        return bool(self._data[self._offset + layout.CAR_TOUCHED_BALL] > 0.5)

    @property
    def forward(self):
        forward_vec = np.array(transcendence_sim.physics.WORLD_FORWARD, dtype=np.float32)
        return rotate(self.rotation, forward_vec)

    @property
    def up(self):
        up_vec = np.array(transcendence_sim.physics.WORLD_UP, dtype=np.float32)
        return rotate(self.rotation, up_vec)

    def to_local(self, world_vector):
        return inverse_rotate(self.rotation, np.asarray(world_vector, dtype=np.float32))

    @property
    def physics(self):
        # Compatibility with RLGym inverted_physics vs physics
        return self

    @property
    def inverted_physics(self):
        # We'd need an inverted physics object here if we used inverted states. For simplicity returning self
        return self

class GameState:
    __slots__ = ("data", "cars", "ball", "inverted_ball", "blue_idx", "orange_idx")

    def __init__(self, data=None):
        if data is None:
            raise ValueError("GameState must be initialized with raw float array data from the C++ sim.")
        self.data = data

        self.ball = PhysicsObject(
            data, layout.BALL_POSITION, layout.BALL_LINEAR_VELOCITY, layout.BALL_ANGULAR_VELOCITY)
        self.inverted_ball = self.ball # Mock for inverted

        self.cars = {}
        num_cars = int(data[layout.NUM_CARS])
        blue_idx = 0
        orange_idx = 0
        for i in range(num_cars):
            offset = layout.CAR_BASE_OFFSET + i * layout.CAR_SIZE
            car = Car(data, offset)
            if car.is_blue:
                agent_id = f"blue_{blue_idx}"
                blue_idx += 1
            else:
                agent_id = f"orange_{orange_idx}"
                orange_idx += 1
            self.cars[agent_id] = car

        self.blue_idx = blue_idx
        self.orange_idx = orange_idx

    @classmethod
    def from_sim(cls, sim):
        return cls(np.asarray(sim.state, dtype=np.float32))

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
