import { prisma } from '../config/prisma.js';

export const MatchRepository = {
	async saveMatchResult({ matchId, winningTeam, finalScore }) {
		return await prisma.matchHistory.create({
			data: {
				matchId,
				winningTeam,
				finalScore,
			},
		});
	},

	async getMatchById(matchId) {
		return await prisma.matchHistory.findUnique({
			where: { matchId },
		});
	},
};