import { prisma } from '../config/prisma.js';

export const SessionRepository = {
	// The normal caller uses prisma.
	// A transaction can instead pass its own `tx` client.
	async findByAccountId(playerAccountId, db = prisma) {
	return db.session.findUnique({
		where: { playerAccountId },
	});
	},

  // Replace the account's session on login, or create its first one.
  // The schema's unique playerAccountId allows only one row per account.
	async createOrReplace(
	{ playerAccountId, tokenHash, expiresAt },
	db = prisma,
	) {
	return db.session.upsert({
		where: { playerAccountId },
		create: { playerAccountId, tokenHash, expiresAt },
		update: {
		tokenHash,
		expiresAt,
		revokedAt: null,
		},
	});
	},

  // A token proves nothing if its session has expired or been revoked.
  async findActiveByTokenHash(tokenHash) {
	return prisma.session.findFirst({
	  where: {
		tokenHash,
		revokedAt: null,
		expiresAt: { gt: new Date() },
	  },
	});
  },

  // Only revoke the row if it still contains this exact token hash.
  async revokeByTokenHash(tokenHash) {
	return prisma.session.updateMany({
	  where: {
		tokenHash,
		revokedAt: null,
	  },
	  data: {
		revokedAt: new Date(),
	  },
	});
  },
};
