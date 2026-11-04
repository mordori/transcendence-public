import { prisma } from '../config/prisma.js';

const USERNAME_COOLDOWN_MS = 1 * 60 * 60 * 1000;

const publicProfileFields = {
  accountId: true,
  displayName: true,
  email: true,
  avatarId: true,
  usernameChangedAt: true,
};

export const UsernameRepository = {
  async changeUsername(accountId, username) {
	return prisma.$transaction(async (tx) => {
	  const rows = await tx.$queryRaw`
		SELECT "accountId"
		FROM "PlayerAccount"
		WHERE "accountId" = ${accountId}
		FOR UPDATE
	  `;

	  if (rows.length !== 1) {
		throw new Error('ACCOUNT_NOT_FOUND');
	  }

	  const player = await tx.playerAccount.findUnique({
		where: { accountId },
		select: publicProfileFields,
	  });

	  if (!player) {
		throw new Error('ACCOUNT_NOT_FOUND');
	  }

	  // Saving the current name is not a username change.
	  if (player.displayName === username) {
		return player;
	  }

	  const now = new Date();

	  if (player.usernameChangedAt !== null) {
		const availableAt = new Date(
		  player.usernameChangedAt.getTime() +
			USERNAME_COOLDOWN_MS,
		);

		if (now < availableAt) {
		  const error = new Error('USERNAME_COOLDOWN');

		  error.availableAt = availableAt.toISOString();
		  error.retryAfterSeconds = Math.ceil(
			(availableAt.getTime() - now.getTime()) / 1000,
		  );

		  throw error;
		}
	  }

	  return tx.playerAccount.update({
		where: { accountId },
		data: {
		  displayName: username,
		  usernameChangedAt: now,
		},
		select: publicProfileFields,
	  });
	});
  },
};
