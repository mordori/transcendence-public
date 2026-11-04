#include <pybind11/pybind11.h>
#include <pybind11/stl.h>

#include "rules.hpp"
#include "sim.hpp"

#include "physics.hpp"

namespace py = pybind11;

PYBIND11_MODULE(transcendence_sim, m) {
	m.doc() = "Headless physics for the game, for reinforcement learning.";

	py::class_<core::sim::Sim>(m, "Sim")
		.def(py::init<int, int>(), py::arg("num_blue") = 1, py::arg("num_orange") = 0)
		.def("reset", &core::sim::Sim::reset)
		.def("step", &core::sim::Sim::step, py::arg("inputs"))
		.def("set_state", &core::sim::Sim::setState, py::arg("desired"))
		.def_property_readonly("state", &core::sim::Sim::state)
		.def_property_readonly("has_stadium", &core::sim::Sim::hasStadium);

	py::module_ state{ m.def_submodule("state") };
	state.attr("NUM_CARS") = core::sim::state::numCars;
	state.attr("BALL_POSITION") = core::sim::state::ballPosition;
	state.attr("BALL_LINEAR_VELOCITY") = core::sim::state::ballLinearVelocity;
	state.attr("BALL_ANGULAR_VELOCITY") = core::sim::state::ballAngularVelocity;
	state.attr("CAR_TOUCHED_BALL") = core::sim::state::carTouchedBall;
	state.attr("BALL_IN_GOAL") = core::sim::state::ballInGoal;
	state.attr("SCORING_TEAM") = core::sim::state::scoringTeam;
	state.attr("STEP_COUNT") = core::sim::state::stepCount;
	state.attr("CAR_BASE_OFFSET") = core::sim::state::carBaseOffset;
	state.attr("CAR_TEAM") = core::sim::state::carTeam;
	state.attr("CAR_POSITION") = core::sim::state::carPosition;
	state.attr("CAR_ROTATION") = core::sim::state::carRotation;
	state.attr("CAR_LINEAR_VELOCITY") = core::sim::state::carLinearVelocity;
	state.attr("CAR_ANGULAR_VELOCITY") = core::sim::state::carAngularVelocity;
	state.attr("CAR_ON_GROUND") = core::sim::state::carOnGround;
	state.attr("CAR_SIZE") = core::sim::state::carSize;

	py::module_ rules{ m.def_submodule("rules") };
	rules.attr("PHYSICS_TIME_STEP") = core::rules::physicsTimeStep;
	rules.attr("CAR_MAX_SPEED") = core::rules::carMaxSpeed;
	rules.attr("BALL_MAX_SPEED") = core::rules::ballMaxSpeed;
	rules.attr("GOAL_DISTANCE") = core::rules::goalDistance;
	rules.attr("MATCH_DURATION") = core::rules::matchDuration;

	rules.attr("ARENA_HALF_EXTENTS") = py::make_tuple(	//
		core::rules::arenaHalfExtents.x, core::rules::arenaHalfExtents.y, core::rules::arenaHalfExtents.z);

	rules.attr("BALL_SPAWN_POINT") = py::make_tuple(	//
		core::rules::ballSpawnPoint.x, core::rules::ballSpawnPoint.y, core::rules::ballSpawnPoint.z);

	py::module_ physics{ m.def_submodule("physics") };
	physics.attr("WORLD_FORWARD") = py::make_tuple(
		core::physics::worldForward.x,
		core::physics::worldForward.y,
		core::physics::worldForward.z);

	physics.attr("WORLD_UP") = py::make_tuple(
		core::physics::worldUp.x,
		core::physics::worldUp.y,
		core::physics::worldUp.z);

	physics.attr("WORLD_RIGHT") = py::make_tuple(
		core::physics::worldRight.x,
		core::physics::worldRight.y,
		core::physics::worldRight.z);
	
	py::list goals;
	for (const auto& goal : core::rules::goals) {
		py::dict entry;
		entry["center"] = py::make_tuple(goal.center.x, goal.center.y, goal.center.z);
		entry["half_extents"] = py::make_tuple(goal.halfExtents.x, goal.halfExtents.y, goal.halfExtents.z);
		entry["team"] = goal.team;
		goals.append(entry);
	}
	rules.attr("GOALS") = goals;

	py::list spawnPoints;
	for (const auto& point : core::rules::team0SpawnPoints)
		spawnPoints.append(py::make_tuple(point.x, point.y, point.z));
	for (const auto& point : core::rules::team1SpawnPoints)
		spawnPoints.append(py::make_tuple(point.x, point.y, point.z));
	rules.attr("PLAYER_SPAWN_POINTS") = spawnPoints;
}
