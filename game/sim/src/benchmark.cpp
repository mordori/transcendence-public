#include <chrono>
#include <cstdio>
#include <random>

#include "sim.hpp"

int main() {
	core::sim::Sim sim;
	sim.reset();

	std::printf("stadium meshes: %s\n", sim.hasStadium() ? "loaded" : "MISSING (flat plane fallback)");
	std::printf("state size: %zu floats\n\n", sim.state().size());

	constexpr int kSteps{ 1'000'000 };
	constexpr int kEpisodeLength{ 3'000 };

	std::mt19937 rng{ 1234 };
	std::uniform_int_distribution<int> action{ 0, 1 };

	int episodes{};
	int touches{};
	int goals{};
	int sinceReset{};

	auto start{ std::chrono::steady_clock::now() };

	for (int i = 0; i < kSteps; ++i) {
		sim.step(action(rng), action(rng), action(rng), action(rng), action(rng));
		++sinceReset;

		touches += sim.state()[core::sim::state::ballTouched] > 0.5f ? 1 : 0;

		const bool scored{ sim.state()[core::sim::state::ballInGoal] > 0.5f };
		if (scored || sinceReset >= kEpisodeLength) {
			goals += scored ? 1 : 0;
			sim.reset();
			sinceReset = 0;
			++episodes;
		}
	}

	float seconds{ std::chrono::duration<float>(std::chrono::steady_clock::now() - start).count() };

	std::printf("%d steps in %.2f s\n", kSteps, seconds);
	std::printf("%.0f steps/sec\n", kSteps / seconds);
	std::printf("%d episodes, %d goals, %d touch-steps\n\n", episodes, goals, touches);
	std::printf("10M steps would take %.1f minutes\n", (10'000'000.0f / (kSteps / seconds)) / 60.0f);

	return 0;
}
