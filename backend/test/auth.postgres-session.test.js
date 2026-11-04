import test, { after } from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../src/config/prisma.js';
import { redis } from '../src/config/redis.js';
import { buildApp } from '../src/app.js';
import { AuthService } from '../src/services/auth.service.js';
import { SessionRepository } from '../src/repositories/session.repository.js';
import { hashSessionToken } from '../src/utils/session-token.js';
import { closeConnections, withAccount } from './auth-test-helpers.js';

after(closeConnections);

async function withoutRedisSessions(t, run) {
  let attempts = 0;
  for (const method of ['get', 'set', 'del']) {
    const original = redis[method];
    t.mock.method(redis, method, function (...args) {
      if (typeof args[0] === 'string' && args[0].startsWith('session:')) {
        attempts += 1;
        throw new Error('REDIS_SESSION_COMMAND_FORBIDDEN');
      }
      return original.apply(this, args);
    });
  }
  await withAccount(async (account) => {
    await run(account);
    assert.equal(attempts, 0, 'authentication must not use Redis session get/set/del');
  }, { t });
}

test('session lifecycle and duplicate rejection do not use Redis sessions',
  { concurrency: false }, async (t) => {
    await withoutRedisSessions(t, async ({ registered, email, password }) => {
      const where = { playerAccountId: registered.account.accountId };
      const before = await prisma.session.findUnique({ where });
      await assert.rejects(AuthService.login({ email, password }), {
        message: 'ACCOUNT_ALREADY_LOGGED_IN',
      });
      assert.deepEqual(await prisma.session.findUnique({ where }), before);
      assert.deepEqual(
        await AuthService.getAuthenticatedAccount(registered.rawToken),
        registered.account,
      );
      await AuthService.logout(registered.rawToken);
      const loggedIn = await AuthService.login({ email, password });
      assert.notEqual(loggedIn.rawToken, registered.rawToken);
      const session = await prisma.session.findUnique({ where });
      assert.equal(session.tokenHash, hashSessionToken(loggedIn.rawToken));
      assert.equal(session.revokedAt, null);
      assert.equal(await AuthService.getAuthenticatedAccount(registered.rawToken), null);
      await AuthService.logout(registered.rawToken);
      assert.deepEqual(
        await AuthService.getAuthenticatedAccount(loggedIn.rawToken),
        registered.account,
      );
      await AuthService.logout(loggedIn.rawToken);
      assert.ok((await prisma.session.findUnique({ where })).revokedAt instanceof Date);
      assert.equal(await AuthService.getAuthenticatedAccount(loggedIn.rawToken), null);
      await AuthService.logout(loggedIn.rawToken);
    });
  });

test('failed session write rolls back to the previous revoked session',
  { concurrency: false }, async (t) => {
    await withoutRedisSessions(t, async ({ registered, email, password }) => {
      await AuthService.logout(registered.rawToken);
      const where = { playerAccountId: registered.account.accountId };
      const before = await prisma.session.findUnique({ where });
      assert.ok(before.revokedAt instanceof Date);
      const original = SessionRepository.createOrReplace;
      const replacement = t.mock.method(
        SessionRepository, 'createOrReplace', async function (...args) {
          await original.apply(this, args);
          throw new Error('SIMULATED_FAILURE_AFTER_SESSION_WRITE');
        },
      );
      await assert.rejects(AuthService.login({ email, password }), {
        message: 'SIMULATED_FAILURE_AFTER_SESSION_WRITE',
      });
      assert.equal(replacement.mock.callCount(), 1);
      replacement.mock.restore();
      assert.deepEqual(await prisma.session.findUnique({ where }), before);
      assert.equal(await AuthService.getAuthenticatedAccount(registered.rawToken), null);
      // The failed transaction must not prevent a later legitimate login.
      const retried = await AuthService.login({ email, password });
      assert.deepEqual(
        await AuthService.getAuthenticatedAccount(retried.rawToken),
        registered.account,
      );
    });
  });

test('failed revocation does not report successful logout or clear the cookie',
  { concurrency: false }, async (t) => {
    await withoutRedisSessions(t, async ({ registered }) => {
      const app = buildApp({ authService: AuthService });
      const revocation = t.mock.method(
        SessionRepository, 'revokeByTokenHash', async () => {
          throw new Error('SIMULATED_REVOCATION_FAILURE');
        },
      );
      try {
        const response = await app.inject({
          method: 'POST', url: '/api/auth/logout',
          headers: { 'x-auth-request': '1', cookie: `session=${registered.rawToken}` },
        });
        assert.equal(response.statusCode, 500);
        assert.equal(response.headers['set-cookie'], undefined);
        assert.equal(revocation.mock.callCount(), 1);
        revocation.mock.restore();
        const session = await prisma.session.findUnique({
          where: { playerAccountId: registered.account.accountId },
        });
        assert.equal(session.revokedAt, null);
        const me = await app.inject({
          method: 'GET', url: '/api/auth/me',
          headers: { cookie: `session=${registered.rawToken}` },
        });
        assert.equal(me.statusCode, 200);
        assert.deepEqual(me.json(), { account: registered.account });
      } finally {
        await app.close();
      }
    });
  });

test('concurrent logins allow only one new session without Redis session storage',
  { concurrency: false }, async (t) => {
    await withoutRedisSessions(t, async ({ registered, email, password }) => {
      await AuthService.logout(registered.rawToken);
      const results = await Promise.allSettled([
        AuthService.login({ email, password }),
        AuthService.login({ email, password }),
      ]);
      const accepted = results.filter((result) => result.status === 'fulfilled');
      const rejected = results.filter((result) => result.status === 'rejected');
      assert.equal(accepted.length, 1);
      assert.equal(rejected.length, 1);
      assert.equal(rejected[0].reason.message, 'ACCOUNT_ALREADY_LOGGED_IN');
      const winner = accepted[0].value;
      const where = { playerAccountId: registered.account.accountId };
      const session = await prisma.session.findUnique({ where });
      assert.equal(session.tokenHash, hashSessionToken(winner.rawToken));
      assert.equal(session.revokedAt, null);
      assert.ok(session.expiresAt.getTime() > Date.now());
      assert.equal(await prisma.session.count({ where }), 1);
      assert.deepEqual(
        await AuthService.getAuthenticatedAccount(winner.rawToken),
        registered.account,
      );
      assert.equal(await AuthService.getAuthenticatedAccount(registered.rawToken), null);
    });
  });
