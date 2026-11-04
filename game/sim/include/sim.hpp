#pragma once

#include <string>
#include <vector>

#include "box3d/id.h"
#include "entt/entity/fwd.hpp"
#include "entt/entt.hpp"

namespace core::sim {

namespace state {
inline constexpr int numCars{ 0 };
inline constexpr int ballPosition{ 1 };
inline constexpr int ballLinearVelocity{ 4 };
inline constexpr int ballAngularVelocity{ 7 };
inline constexpr int ballInGoal{ 10 };
inline constexpr int scoringTeam{ 11 };
inline constexpr int stepCount{ 12 };

inline constexpr int carBaseOffset{ 13 };

inline constexpr int carTeam{ 0 };
inline constexpr int carPosition{ 1 };
inline constexpr int carRotation{ 4 };
inline constexpr int carLinearVelocity{ 8 };
inline constexpr int carAngularVelocity{ 11 };
inline constexpr int carOnGround{ 14 };
inline constexpr int carTouchedBall{ 15 };
inline constexpr int carSize{ 16 };
}

class Sim {
public:
	explicit Sim(int numBlue = 1, int numOrange = 0);
	~Sim();

	Sim(const Sim&) = delete;
	Sim& operator=(const Sim&) = delete;

	const std::vector<float>& reset();
	void step(const std::vector<float>& inputs);
	void setState(const std::vector<float>& desired);

	const std::vector<float>& state() const {
		return state_;
	}

	bool hasStadium() const {
		return hasStadium_;
	}

private:
	void buildWorld();
	void readState();
	bool ballTouchedCar() const;

	entt::registry		registry_;
	b3WorldId			worldId_{};
	bool				hasWorld_{};
	bool				hasStadium_{};

	std::vector<entt::entity> cars_;
	entt::entity		ball_{ entt::null };
	int					numBlue_{};
	int					numOrange_{};

	std::vector<float>	state_;
	int					stepCount_{};
};
}
