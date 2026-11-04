import { prisma } from '../config/prisma.js';

function isAlphaNumeric(str) {
	if (!str || typeof str !== 'string')
		return false;

	for (let i = 0; i < str.length; ++i) {
		const char = str.charCodeAt(i);

		const isDigit = char >= 48 && char <= 57;
		const isUpper = char >= 65 && char <= 90;
		const isLower = char >= 97 && char <= 122;

		if (!isDigit && !isUpper && !isLower) {
			return false;
		}
	}
	return true;
}

const VALID_AVATAR_IDS = [
  'default',
  'red_car',
  'blue_car',
];

export const PlayerRepository = {

	async createPlayer(account_uuid, username, email, pwHash_encr) {
		return await prisma.playerAccount.create({
			data: {
				accountId: account_uuid,
				displayName: username,
				email: email,
				passwordHash: pwHash_encr
			},
		});
	},

	async getPlayerById(account_uuid) {
		return await prisma.playerAccount.findUnique({
			where: { accountId: account_uuid },
		});
	},

	async getPlayerByUsername(username) {
		return await prisma.playerAccount.findUnique({
			where: { displayName: username },
		});
	},

	/**
	 * Updates player username and/or avatar. No email updates via this method.
	 * @param {string} account_uuid - Player UUID
	 * @param {Object} data - Updates
	 * @param {string} [data.username] - Optional new username
	 * @param {string} [data.avatarId] - Optional avatar image key
	 */
	// select is used to selectively return certain data back to application layer, mostly for frontend updates.
	// passwordHash is not selected for return, for obvious reasons.
	async updateProfile(account_uuid, { username, avatarId }) {
		const trimmed = (typeof username === 'string' ? username.trim() : null);
		const isValidName =
			trimmed &&
			trimmed.length >= 3 &&
			trimmed.length <= 20 &&
			isAlphaNumeric(trimmed);

		if (username !== undefined && !isValidName)
			throw new Error("INVALID_USERNAME");

		if (avatarId !== undefined && !VALID_AVATAR_IDS.includes(avatarId))
    		throw new Error("INVALID_AVATAR_ID");

		return await prisma.playerAccount.update({
			where: { accountId: account_uuid },
			data: {
				...(isValidName && { displayName: trimmed }),
				...(avatarId !== undefined && { avatarId }),
			},
			select: {
				accountId: true,
				displayName: true,
				email: true,
				avatarId: true,
				usernameChangedAt: true,
				createdAt: true,
				updatedAt: true,
			},
		});
	},

	/**
	 * Separate method for update player username and/or avatar.
	 * @param {string} account_uuid - Player UUID
	 * @param {Object} email - New email
	 */
	async updateEmail(account_uuid, email) {
		return await prisma.playerAccount.update({
			where: { accountId: account_uuid },
			data: { email },
		});
	},


		// Used by login to retrieve the account and its password hash.
	// Never return the resulting passwordHash in an HTTP response.
	async getPlayerByEmail(email) {
	  return prisma.playerAccount.findUnique({
	    where: { email },
	  });
	},
};
