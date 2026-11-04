import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { redis } from '../src/config/redis.js';
import { RedisKeys } from '../src/database/keys.js';
import { CacheRepository } from '../src/repositories/cache.repository.js';
import {
  createRawSessionToken,
  hashSessionToken,
} from '../src/utils/session-token.js';

// Close this test process's Redis connection so Node can exit.
after(async () => {
  await redis.quit();
});

test('auth session can be saved, read, and deleted', async () => {
  const tokenHash = hashSessionToken(createRawSessionToken());
  const accountId = randomUUID();
  const key = RedisKeys.sessionKey(tokenHash);

  try {
    await CacheRepository.saveAuthSession(tokenHash, accountId, 5);

    assert.equal(
      await CacheRepository.getAuthSessionAccountId(tokenHash),
      accountId,
    );

    const remainingSeconds = await redis.ttl(key);
    assert.ok(remainingSeconds > 0 && remainingSeconds <= 5);

    await CacheRepository.deleteAuthSession(tokenHash);

    assert.equal(
      await CacheRepository.getAuthSessionAccountId(tokenHash),
      null,
    );
  } finally {
    // Clean up even if an assertion fails.
    await CacheRepository.deleteAuthSession(tokenHash);
  }
});

test('auth session expires automatically', async () => {
  const tokenHash = hashSessionToken(createRawSessionToken());
  const accountId = randomUUID();

  try {
    await CacheRepository.saveAuthSession(tokenHash, accountId, 1);
    assert.equal(
      await CacheRepository.getAuthSessionAccountId(tokenHash),
      accountId,
    );

    await new Promise((resolve) => setTimeout(resolve, 1200));

    assert.equal(
      await CacheRepository.getAuthSessionAccountId(tokenHash),
      null,
    );
  } finally {
    await CacheRepository.deleteAuthSession(tokenHash);
  }
});

test('auth session rejects an invalid TTL', async () => {
  await assert.rejects(
    CacheRepository.saveAuthSession('unused-test-hash', 'unused-account', 0),
    /INVALID_SESSION_TTL/,
  );
});


// Run from the repository root to test
//
// docker compose exec backend sh -c '
//   REDIS_PASSWORD="$(cat /run/secrets/redis_password)"
//   export REDIS_URL="redis://:${REDIS_PASSWORD}@${REDIS_HOST}:${REDIS_PORT}"
//   exec node --test test/cache-auth-session.test.js
// '
