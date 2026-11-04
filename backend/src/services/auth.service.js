import { prisma } from '../config/prisma.js';

import { randomUUID } from 'node:crypto';

import { PlayerRepository } from '../repositories/player.repository.js';
import { SessionRepository } from '../repositories/session.repository.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import { checkLoginAttempt } from './login-throttle.js';
import {
  createRawSessionToken,
  hashSessionToken,
  getSessionExpiry,
} from '../utils/session-token.js';
import { Session } from 'node:inspector';

// Return only information that is safe to show to the frontend.
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

function normalizeEmail(email) {
  if (typeof email !== 'string') {
	throw new Error('INVALID_EMAIL');
  }

  const normalized = email.trim().toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
	throw new Error('INVALID_EMAIL');
  }

  return normalized;
}

function validateUsername(username) {
  if (typeof username !== 'string') {
	throw new Error('INVALID_USERNAME');
  }

  const trimmed = username.trim();

  // Match the existing profile-update policy.
  if (!/^[A-Za-z0-9]{3,20}$/.test(trimmed)) {
	throw new Error('INVALID_USERNAME');
  }

  return trimmed;
}

function validatePassword(password) {
  if (
	typeof password !== 'string' ||
	password.length < 12 ||
	password.length > 128
  ) {
	throw new Error('INVALID_PASSWORD');
  }
}

// PostgreSQL owns session creation.
// Lock the account before checking whether it already has an active session.
async function startSession(player) {
  return prisma.$transaction(async (tx) => {
	const rows = await tx.$queryRaw`
	  SELECT "accountId"
	  FROM "PlayerAccount"
	  WHERE "accountId" = ${player.accountId}
	  FOR UPDATE
	`;

	if (rows.length !== 1) {
	  throw new Error('ACCOUNT_NOT_FOUND');
	}

	const session = await SessionRepository.findByAccountId(
		player.accountId,
		tx,
	);

	const now = new Date();

	const hasActiveSession =
		session !== null &&
		session.revokedAt === null &&
		session.expiresAt > now;

	if (hasActiveSession) {
		throw new Error('ACCOUNT_ALREADY_LOGGED_IN');
	}

	const rawToken = createRawSessionToken();
	const tokenHash = hashSessionToken(rawToken);
	const expiresAt = getSessionExpiry();

	// The existing upsert replaces the account's previous token
	// and clears revokedAt for the new session.
	await SessionRepository.createOrReplace(
	  {
		playerAccountId: player.accountId,
		tokenHash,
		expiresAt,
	  },
	  tx,
	);

	return {
	  account: publicAccount(player),
	  rawToken,
	};
  });
}

// Our session-token utility generates 32 random bytes as a
// 43-character base64url string.
function isRawSessionToken(value) {
  return (
	typeof value === 'string' &&
	/^[A-Za-z0-9_-]{43}$/.test(value)
  );
}

export const AuthService = {
  async register({ username, email, password }) {
	const validUsername = validateUsername(username);
	const validEmail = normalizeEmail(email);
	validatePassword(password);

	const passwordHash = await hashPassword(password);

	const player = await PlayerRepository.createPlayer(
	  randomUUID(),
	  validUsername,
	  validEmail,
	  passwordHash,
	);

	return startSession(player);
  },

  async login({ email, password }) {
	const validEmail = normalizeEmail(email);

	// Use the same response later for unknown email and wrong password.
	if (typeof password !== 'string') {
	  throw new Error('INVALID_CREDENTIALS');
	}

	// Stop the sixth attempt before looking up or checking the password.
	await checkLoginAttempt(validEmail);

	const player = await PlayerRepository.getPlayerByEmail(validEmail);

	if (
	  !player ||
	  !(await verifyPassword(player.passwordHash, password))
	) {
	  throw new Error('INVALID_CREDENTIALS');
	}

	return startSession(player);
  },

	// PostgreSQL alone decides whether this token is valid.
	// SessionRepository already checks expiry and revocation.
	async getAuthenticatedAccount(rawToken) {
	if (!isRawSessionToken(rawToken)) {
		return null;
	}

	const tokenHash = hashSessionToken(rawToken);
	const session =
		await SessionRepository.findActiveByTokenHash(tokenHash);

	if (!session) {
		return null;
	}

	const player = await PlayerRepository.getPlayerById(
		session.playerAccountId,
	);

	if (!player) {
		return null;
	}

	return publicAccount(player);
	},

	// Revoke exactly the presented token.
	// An old browser's token must not revoke a newer login.
	// Repeating logout is harmless because the repository updates
	// only matching sessions that have not already been revoked.
	async logout(rawToken) {
	if (!isRawSessionToken(rawToken)) {
		return;
	}

	const tokenHash = hashSessionToken(rawToken);

	// Do not swallow database failures.
	// The route clears the cookie only after this succeeds.
	await SessionRepository.revokeByTokenHash(tokenHash);
	},
};
