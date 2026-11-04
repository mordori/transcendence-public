import test, { after } from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../src/config/prisma.js';
import { AuthService } from '../src/services/auth.service.js';
import { hashSessionToken } from '../src/utils/session-token.js';
import { closeConnections, withAccount } from './auth-test-helpers.js';

after(closeConnections);

test('without an active session, exactly one concurrent login succeeds', async () => {
  await withAccount(async ({ registered, email, password }) => {
    await AuthService.logout(registered.rawToken);
    const outcomes = await Promise.allSettled([
      AuthService.login({ email, password }),
      AuthService.login({ email, password }),
    ]);
    const accepted = outcomes.filter((result) => result.status === 'fulfilled');
    const rejected = outcomes.filter((result) => result.status === 'rejected');
    assert.equal(accepted.length, 1);
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0].reason.message, 'ACCOUNT_ALREADY_LOGGED_IN');

    const winner = accepted[0].value;
    const accountId = registered.account.accountId;
    const session = await prisma.session.findUnique({
      where: { playerAccountId: accountId },
    });
    assert.ok(session);
    assert.equal(session.tokenHash, hashSessionToken(winner.rawToken));
    assert.equal(session.revokedAt, null);
    assert.ok(session.expiresAt.getTime() > Date.now());
    assert.equal(await prisma.session.count({
      where: { playerAccountId: accountId },
    }), 1);
    assert.deepEqual(
      await AuthService.getAuthenticatedAccount(winner.rawToken),
      registered.account,
    );
    assert.equal(await AuthService.getAuthenticatedAccount(registered.rawToken), null);
  });
});

test('with an active session, both concurrent logins are rejected', async () => {
  await withAccount(async ({ registered, email, password }) => {
    const where = { playerAccountId: registered.account.accountId };
    const before = await prisma.session.findUnique({ where });
    const outcomes = await Promise.allSettled([
      AuthService.login({ email, password }),
      AuthService.login({ email, password }),
    ]);
    for (const outcome of outcomes) {
      assert.equal(outcome.status, 'rejected');
      assert.equal(outcome.reason.message, 'ACCOUNT_ALREADY_LOGGED_IN');
    }
    assert.deepEqual(await prisma.session.findUnique({ where }), before);
    assert.deepEqual(
      await AuthService.getAuthenticatedAccount(registered.rawToken),
      registered.account,
    );
  });
});
