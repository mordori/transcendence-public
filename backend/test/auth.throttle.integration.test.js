import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { buildApp } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';
import { redis } from '../src/config/redis.js';
import { loginAttemptKey } from '../src/services/login-throttle.js';

after(async () => {
  await prisma.$disconnect();
  await redis.quit();
});

test('sixth login request returns 429', async () => {
  // A unique, nonexistent email avoids touching any real account.
  const email = `throttle-${randomUUID()}@example.test`;
  const key = loginAttemptKey(email);
  const app = buildApp();

  // Every request needs the auth header added in the previous milestone.
  const loginRequest = {
	method: 'POST',
	url: '/api/auth/login',
	headers: { 'x-auth-request': '1' },
	payload: { email, password: 'wrong-test-password' },
  };

  try {
	for (let attempt = 0; attempt < 5; attempt += 1) {
	  const response = await app.inject(loginRequest);
	  assert.equal(response.statusCode, 401);
	}

	const blocked = await app.inject(loginRequest);
	assert.equal(blocked.statusCode, 429);
	assert.equal(
	  blocked.json().error,
	  'Too many login attempts. Try again later.',
	);
  } finally {
	// Remove this test's temporary count even if an assertion fails.
	await redis.del(key);
	await app.close();
  }
});

// Copy the files thi teste needs into the existing container
// docker compose cp backend/src/services/login-throttle.js \
//   backend:/app/src/services/login-throttle.js
// docker compose cp backend/src/services/auth.service.js \
//   backend:/app/src/services/auth.service.js
// docker compose cp backend/src/routes/auth.routes.js \
//   backend:/app/src/routes/auth.routes.js
// docker compose cp backend/test/auth.throttle.integration.test.js \
//   backend:/app/test/auth.throttle.integration.test.js

// Run the test with the same development database and Redis setup
// docker compose exec backend sh -c '
//   POSTGRES_PASSWORD="$(cat /run/secrets/postgres_password)"
//   export DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}?schema=public&connection_limit=10&pool_timeout=10"

//   REDIS_PASSWORD="$(cat /run/secrets/redis_password)"
//   export REDIS_URL="redis://:${REDIS_PASSWORD}@${REDIS_HOST}:${REDIS_PORT}"

//   exec node --test test/auth.throttle.integration.test.js
// '
// expect 1 pass, 0 fail
