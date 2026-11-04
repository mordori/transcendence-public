import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { buildApp } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';
import { redis } from '../src/config/redis.js';
import { loginAttemptKey } from '../src/services/login-throttle.js';

const AUTH_HEADERS = { 'x-auth-request': '1' };

after(async () => {
  try {
	await prisma.$disconnect();
  } finally {
	await redis.quit();
  }
});

function cookieFrom(response) {
  const setCookie = response.headers['set-cookie'];
  assert.equal(typeof setCookie, 'string');
  return setCookie.split(';')[0];
}

test('active sessions reject new logins without replacing the original', async () => {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const username = `Single${suffix}`;
  const email = `single-${suffix}@example.test`;
  const password = 'correct-test-password-123';
  const app = buildApp();

  function login(submittedPassword = password) {
	return app.inject({
	  method: 'POST',
	  url: '/api/auth/login',
	  headers: AUTH_HEADERS,
	  payload: { email, password: submittedPassword },
	});
  }

  function me(cookie) {
	return app.inject({
	  method: 'GET',
	  url: '/api/auth/me',
	  headers: { cookie },
	});
  }

  function logout(cookie) {
	return app.inject({
	  method: 'POST',
	  url: '/api/auth/logout',
	  headers: { ...AUTH_HEADERS, cookie },
	});
  }

  try {
	const registered = await app.inject({
	  method: 'POST',
	  url: '/api/auth/register',
	  headers: AUTH_HEADERS,
	  payload: { username, email, password },
	});

	assert.equal(registered.statusCode, 201);

	const account = registered.json().account;
	const firstCookie = cookieFrom(registered);

	const originalSession = await prisma.session.findUnique({
	  where: { playerAccountId: account.accountId },
	});

	// Registration automatically signed the account in.
	const rejected = await login();

	assert.equal(rejected.statusCode, 409);
	assert.deepEqual(rejected.json(), {
	  code: 'ACCOUNT_ALREADY_LOGGED_IN',
	  error: 'Account already logged in',
	});
	assert.equal(rejected.headers['set-cookie'], undefined);

	const unchangedSession = await prisma.session.findUnique({
	  where: { playerAccountId: account.accountId },
	});

	assert.deepEqual(unchangedSession, originalSession);
	assert.equal((await me(firstCookie)).statusCode, 200);

	// Wrong credentials must not reveal the active-session status.
	const wrongPassword = await login('wrong-password');

	assert.equal(wrongPassword.statusCode, 401);
	assert.equal((await me(firstCookie)).statusCode, 200);

	// Logout makes a new login possible.
	assert.equal((await logout(firstCookie)).statusCode, 204);

	// With no active session, exactly one concurrent login wins.
	const attempts = await Promise.all([login(), login()]);

	assert.deepEqual(
	  attempts.map((response) => response.statusCode).sort(),
	  [200, 409],
	);

	const winner = attempts.find(
	  (response) => response.statusCode === 200,
	);
	const loser = attempts.find(
	  (response) => response.statusCode === 409,
	);

	assert.ok(winner);
	assert.ok(loser);
	assert.equal(loser.headers['set-cookie'], undefined);
	assert.equal(
	  loser.json().code,
	  'ACCOUNT_ALREADY_LOGGED_IN',
	);

	const currentCookie = cookieFrom(winner);

	assert.equal((await me(currentCookie)).statusCode, 200);
	assert.equal((await me(firstCookie)).statusCode, 401);

	// Expire only this disposable test account's session.
	await prisma.session.update({
	  where: { playerAccountId: account.accountId },
	  data: { expiresAt: new Date(Date.now() - 1000) },
	});

	const afterExpiry = await login();

	assert.equal(afterExpiry.statusCode, 200);

	const newCookie = cookieFrom(afterExpiry);

	assert.equal((await me(currentCookie)).statusCode, 401);
	assert.equal((await me(newCookie)).statusCode, 200);

	// An old token must not revoke the new session.
	assert.equal((await logout(currentCookie)).statusCode, 204);
	assert.equal((await me(newCookie)).statusCode, 200);

	assert.equal(
	  await prisma.session.count({
		where: { playerAccountId: account.accountId },
	  }),
	  1,
	);
  } finally {
	try {
	  const player = await prisma.playerAccount.findUnique({
		where: { email },
	  });

	  if (player) {
		await prisma.session.deleteMany({
		  where: { playerAccountId: player.accountId },
		});

		await prisma.playerAccount.delete({
		  where: { accountId: player.accountId },
		});
	  }
	} finally {
	  try {
		await redis.del(loginAttemptKey(email));
	  } finally {
		await app.close();
	  }
	}
  }
});


// This is one test containing several checks:

// - Signup creates a working session.
// - Another login returns 409.
// - Rejection leaves the original session unchanged.
// - Rejection sends no replacement cookie.
// - Wrong password still returns 401.
// - Logout allows login again.
// - Two simultaneous logins produce one success and one rejection.
// - Expired sessions can be replaced.
// - Old tokens cannot revoke the newer session.
// - The account keeps only one session row.

// It creates a unique disposable account and attempts cleanup afterward.

// build updated backend image:
// docker compose up -d postgres redis
// docker compose build backend

// Run:
// docker compose run --rm --no-deps --entrypoint sh backend -c '
//   POSTGRES_PASSWORD="$(cat /run/secrets/postgres_password)"
//   export DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}?schema=public&connection_limit=10&pool_timeout=10"

//   REDIS_PASSWORD="$(cat /run/secrets/redis_password)"
//   export REDIS_URL="redis://:${REDIS_PASSWORD}@${REDIS_HOST}:${REDIS_PORT}"

//   exec node --test test/auth.single-session.test.js
// '


// expect: tests 1 pass 1 fail 0
