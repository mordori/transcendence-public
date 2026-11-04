#include "sim.hpp"

#include <array>
#include <cstdlib>
#include <iostream>
#include <streambuf>

#include "box3d/box3d.h"
#include "box3d/id.h"
#include "components/core_input.hpp"
#include "components/events.hpp"
#include "components/match.hpp"
#include "components/physics.hpp"
#include "core_mesh.hpp"
#include "glm/ext/vector_float3.hpp"
#include "glm/gtc/quaternion.hpp"
#include "match.hpp"
#include "physics.hpp"
#include "rules.hpp"
#include "spawn.hpp"

namespace core::sim {

namespace {

class SilenceStdout {
public:
	SilenceStdout() {
		static const bool verbose{ std::getenv("SIM_VERBOSE") != nullptr };
		if (!verbose)
			previous_ = std::cout.rdbuf(nullptr);
	}
	~SilenceStdout() {
		if (previous_ != nullptr)
			std::cout.rdbuf(previous_);
	}

	SilenceStdout(const SilenceStdout&) = delete;
	SilenceStdout& operator=(const SilenceStdout&) = delete;

private:
	std::streambuf* previous_{ nullptr };
};

void writeVec3(std::vector<float>& out, int offset, const glm::vec3& v) {
	out[static_cast<size_t>(offset) + 0] = v.x;
	out[static_cast<size_t>(offset) + 1] = v.y;
	out[static_cast<size_t>(offset) + 2] = v.z;
}

glm::vec3 readVec3(const std::vector<float>& in, int offset) {
	return { in[static_cast<size_t>(offset) + 0],
		in[static_cast<size_t>(offset) + 1],
		in[static_cast<size_t>(offset) + 2] };
}
}

Sim::Sim(int numBlue, int numOrange)
	: numBlue_(numBlue), numOrange_(numOrange) {
	state_.assign(state::carBaseOffset + (numBlue + numOrange) * state::carSize, 0.0f);
	buildWorld();
}

Sim::~Sim() {
	if (hasWorld_) {
		b3DestroyWorld(worldId_);
		hasWorld_ = false;
	}
	registry_.clear();
}

void Sim::buildWorld() {
	SilenceStdout quiet;

	core::physics::setup(registry_);
	core::match::setup(registry_);

	worldId_ = registry_.ctx().get<World>().id;
	hasWorld_ = true;

	std::string assetDir = SIM_DEFAULT_ASSET_DIR;

	auto meshStadiumPlayer{ core::assets::loadMesh(assetDir + "/stadium_col.glb") };
	auto meshStadiumBall{ core::assets::loadMesh(assetDir + "/stadium.glb") };

	hasStadium_ = meshStadiumPlayer.has_value() && meshStadiumBall.has_value();

	if (hasStadium_) {
		core::spawn::stadium(registry_, worldId_, meshStadiumPlayer.value(), COL_STADIUM_PLAYER, COL_PLAYER);
		core::spawn::stadium(registry_, worldId_, meshStadiumBall.value(), COL_STADIUM_BALL, COL_BALL);
	} else {
		core::spawn::ground(worldId_);
	}

	cars_.clear();
	for (int i = 0; i < numBlue_ + numOrange_; ++i) {
		int team = (i < numBlue_) ? 1 : 0;
		int slot = (team == 1) ? (i % 3) : ((i - numBlue_) % 3);
		entt::entity car = core::spawn::player(registry_, worldId_, team, slot);
		cars_.push_back(car);
	}
	ball_ = core::spawn::ball(registry_, worldId_);
	
	readState();
}

const std::vector<float>& Sim::reset() {
	SilenceStdout quiet;

	core::match::reset(registry_);

	auto& match{ registry_.ctx().get<Match>() };
	match.state = core::match::State::ONGOING;
	match.stateTimer = 0.0f;
	match.timer = 0.0f;

	for (auto car : cars_) {
		auto& input{ registry_.get<InputComponent>(car) };
		input = InputComponent{};
	}

	registry_.ctx().get<FrameEvents>().impacts.clear();

	stepCount_ = 0;
	readState();
	return state_;
}

void Sim::step(const std::vector<float>& inputs) {
	SilenceStdout quiet;

	for (size_t i = 0; i < cars_.size(); ++i) {
		if (i * 5 + 4 < inputs.size()) {
			auto& input{ registry_.get<InputComponent>(cars_[i]) };
			input.up = inputs[i * 5 + 0] > 0.5f;
			input.down = inputs[i * 5 + 1] > 0.5f;
			input.left = inputs[i * 5 + 2] > 0.5f;
			input.right = inputs[i * 5 + 3] > 0.5f;
			input.jump = inputs[i * 5 + 4] > 0.5f;
		}
	}

	registry_.ctx().get<FrameEvents>().impacts.clear();

	core::physics::update(
    registry_,
    core::rules::physicsTimeStep,
    core::physics::SimulationMode::Server,
    "default"
);
	++stepCount_;

	readState();
}

void Sim::setState(const std::vector<float>& desired) {
	if (desired.size() < static_cast<size_t>(state::carBaseOffset))
		return;

	SilenceStdout quiet;

	for (size_t i = 0; i < cars_.size(); ++i) {
		int offset = state::carBaseOffset + i * state::carSize;
		if (desired.size() < static_cast<size_t>(offset + state::carSize)) break;

		const glm::vec3 carPos{ readVec3(desired, offset + state::carPosition) };
		const glm::quat carRot{ desired[offset + state::carRotation + 3],
			desired[offset + state::carRotation + 0],
			desired[offset + state::carRotation + 1],
			desired[offset + state::carRotation + 2] };

		auto& carTransform{ registry_.get<Transform>(cars_[i]) };
		auto& carBody{ registry_.get<RigidBody>(cars_[i]) };

		const b3Quat b3CarRot{ .v = { .x = carRot.x, .y = carRot.y, .z = carRot.z }, .s = carRot.w };
		b3Body_SetTransform(carBody.id, core::physics::glmToB3(carPos), b3CarRot);
		b3Body_SetLinearVelocity(carBody.id, core::physics::glmToB3(readVec3(desired, offset + state::carLinearVelocity)));
		b3Body_SetAngularVelocity(carBody.id, core::physics::glmToB3(readVec3(desired, offset + state::carAngularVelocity)));

		carTransform.pos = carTransform.prevPos = carPos;
		carTransform.rot = carTransform.prevRot = carRot;

		auto& controller{ registry_.get<PlayerController>(cars_[i]) };
		controller.velocity = readVec3(desired, offset + state::carLinearVelocity);
	}

	const glm::vec3 ballPos{ readVec3(desired, state::ballPosition) };
	auto& ballTransform{ registry_.get<Transform>(ball_) };
	auto& ballBody{ registry_.get<RigidBody>(ball_) };

	b3Body_SetTransform(ballBody.id, core::physics::glmToB3(ballPos), b3Quat_identity);
	b3Body_SetLinearVelocity(ballBody.id, core::physics::glmToB3(readVec3(desired, state::ballLinearVelocity)));
	b3Body_SetAngularVelocity(ballBody.id, core::physics::glmToB3(readVec3(desired, state::ballAngularVelocity)));

	ballTransform.pos = ballTransform.prevPos = ballPos;
	ballTransform.rot = ballTransform.prevRot = glm::quat{ 1.0f, 0.0f, 0.0f, 0.0f };

	registry_.get<BallTag>(ball_).hasScored = false;

	readState();
}

// void Sim::carTouchedBall() const {
// 	const auto& ballBody{ registry_.get<RigidBody>(ball_) };

// 	std::array<b3ContactData, 16> contacts{};
// 	const int count{ b3Body_GetContactData(ballBody.id, contacts.data(), static_cast<int>(contacts.size())) };

// 	bool touched = false;
// 	for (int i = 0; i < count; ++i) {
// 		const b3BodyId bodyA{ b3Shape_GetBody(contacts[static_cast<size_t>(i)].shapeIdA) };
// 		const b3BodyId bodyB{ b3Shape_GetBody(contacts[static_cast<size_t>(i)].shapeIdB) };

// 		int offset = state::carBaseOffset + i * state::carSize;
// 		for (auto car : cars_) {
// 			const auto& carBody{ registry_.get<RigidBody>(car) };
// 			if (B3_ID_EQUALS(bodyA, carBody.id) || B3_ID_EQUALS(bodyB, carBody.id)) {
// 				touched = true;
// 				break ;
// 			}
// 		}
// 		state_[offset + state::carTouchedBall] = touched ? 1.0f : 0.0f;
// 	}
// }

void Sim::readState() {
	const auto& ballTransform{ registry_.get<Transform>(ball_) };
	const auto& ballBody{ registry_.get<RigidBody>(ball_) };
	const auto& ballTag{ registry_.get<BallTag>(ball_) };
	const auto& match{ registry_.ctx().get<Match>() };

	state_[state::numCars] = static_cast<float>(cars_.size());
	writeVec3(state_, state::ballPosition, ballTransform.pos);
	writeVec3(state_, state::ballLinearVelocity, core::physics::b3ToGlm(b3Body_GetLinearVelocity(ballBody.id)));
	writeVec3(state_, state::ballAngularVelocity, core::physics::b3ToGlm(b3Body_GetAngularVelocity(ballBody.id)));
	state_[state::ballInGoal] = ballTag.hasScored ? 1.0f : 0.0f;
	state_[state::scoringTeam] = static_cast<float>(match.lastTeamToScore);
	state_[state::stepCount] = static_cast<float>(stepCount_);

	std::array<b3ContactData, 16> contacts{};
	const int count{ b3Body_GetContactData(ballBody.id, contacts.data(), static_cast<int>(contacts.size())) };

	for (size_t i = 0; i < cars_.size(); ++i) {
		const auto& carTransform{ registry_.get<Transform>(cars_[i]) };
		const auto& carBody{ registry_.get<RigidBody>(cars_[i]) };
		const auto& controller{ registry_.get<PlayerController>(cars_[i]) };
		// const auto& tag{ registry_.get<PlayerTag>(cars_[i]) };
		
		int offset = state::carBaseOffset + i * state::carSize;
		state_[offset + state::carTeam] = (static_cast<int>(i) < numBlue_) ? 1.0f : 0.0f;
		writeVec3(state_, offset + state::carPosition, carTransform.pos);
		state_[offset + state::carRotation + 0] = carTransform.rot.x;
		state_[offset + state::carRotation + 1] = carTransform.rot.y;
		state_[offset + state::carRotation + 2] = carTransform.rot.z;
		state_[offset + state::carRotation + 3] = carTransform.rot.w;
		writeVec3(
			state_,
			offset + state::carLinearVelocity,
			core::physics::b3ToGlm(b3Body_GetLinearVelocity(carBody.id))
		);
		writeVec3(state_, offset + state::carAngularVelocity, core::physics::b3ToGlm(b3Body_GetAngularVelocity(carBody.id)));
		state_[offset + state::carOnGround] = controller.isGrounded ? 1.0f : 0.0f;

		bool touched = false;
		for (int c = 0; c < count; ++c) {
			const b3BodyId bodyA{ b3Shape_GetBody(contacts[c].shapeIdA) };
			const b3BodyId bodyB{ b3Shape_GetBody(contacts[c].shapeIdB) };
			if (B3_ID_EQUALS(bodyA, carBody.id) || B3_ID_EQUALS(bodyB, carBody.id)) {
				touched = true;
				break;
			}
		}
		state_[offset + state::carTouchedBall] = touched ? 1.0f : 0.0f;
	}
}
}
