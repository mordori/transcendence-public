import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { redis } from '../src/config/redis.js';
import {
  checkLoginAttempt,
  loginAttemptKey,
} from '../src/services/login-throttle.js';

// Close this test process's Redis connection when tests finish.
after(async () => {
  await redis.quit();
});

test('sixth login attempt is blocked for one email', async () => {
  // Unique addresses prevent this test from using another run's counts.
  const email = `limit-${randomUUID()}@example.test`;
  const otherEmail = `limit-${randomUUID()}@example.test`;
  const key = loginAttemptKey(email);
  const otherKey = loginAttemptKey(otherEmail);

  try {
	// These five calls should not throw an error.
	for (let attempt = 0; attempt < 5; attempt += 1) {
	  await checkLoginAttempt(email);
	}

	// The next call should report that this email has reached its limit.
	await assert.rejects(
	  checkLoginAttempt(email),
	  /LOGIN_RATE_LIMITED/,
	);

	// Redis should remove the count automatically after its time limit.
	const remainingSeconds = await redis.ttl(key);
	assert.ok(remainingSeconds > 0 && remainingSeconds <= 60);

	// Limiting one email must not limit a different email.
	await checkLoginAttempt(otherEmail);
  } finally {
	// Clean up both test keys, even when an assertion fails.
	await redis.del(key, otherKey);
  }
});


// # Ensure both test dependencies are running.
// docker compose up -d postgres redis

// # Package your current source and test files into the image.
// docker compose build backend

// docker compose run --rm --no-deps --entrypoint sh backend -c '
//   POSTGRES_PASSWORD="$(cat /run/secrets/postgres_password)"
//   export DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}?schema=public&connection_limit=10&pool_timeout=10"

//   REDIS_PASSWORD="$(cat /run/secrets/redis_password)"
//   export REDIS_URL="redis://:${REDIS_PASSWORD}@${REDIS_HOST}:${REDIS_PORT}"

//   node --test test/login-throttle.test.js &&
//   node --test test/auth.throttle.integration.test.js
// '
// expect 1 pass, 0 fail
