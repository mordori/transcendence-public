import { PlayerRepository } from '../repositories/player.repository.js';
import { UsernameRepository } from '../repositories/username.repository.js';

function publicAccount(player) {
  return {
	accountId: player.accountId,
	username: player.displayName,
	email: player.email,
	avatarId: player.avatarId,
	usernameChangedAt:
	  player.usernameChangedAt?.toISOString() ?? null,
  };
}

function validateUsername(username) {
  if (typeof username !== 'string') {
	throw new Error('INVALID_USERNAME');
  }

  const trimmed = username.trim();

  if (!/^[A-Za-z0-9]{3,20}$/.test(trimmed)) {
	throw new Error('INVALID_USERNAME');
  }

  return trimmed;
}

export const ProfileService = {
  async changeAvatar(accountId, avatarId) {
	const player = await PlayerRepository.updateProfile(
	  accountId,
	  { avatarId },
	);

	return publicAccount(player);
  },

  async changeUsername(accountId, username) {
	const validUsername = validateUsername(username);

	const player = await UsernameRepository.changeUsername(
	  accountId,
	  validUsername,
	);

	return publicAccount(player);
  },
};
