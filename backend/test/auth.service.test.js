import test, { after } from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../src/config/prisma.js';
import { AuthService } from '../src/services/auth.service.js';
import { hashSessionToken } from '../src/utils/session-token.js';
import { closeConnections, withAccount } from './auth-test-helpers.js';

after(closeConnections);

test('registration, duplicate rejection, and logout preserve one session', async () => {
  await withAccount(async ({ registered, email, password }) => {
    const accountId = registered.account.accountId;
    assert.equal(registered.account.email, email);
    assert.equal('passwordHash' in registered.account, false);
    assert.equal('rawToken' in registered.account, false);

    const player = await prisma.playerAccount.findUnique({ where: { accountId } });
    assert.ok(player);
    assert.equal(registered.account.username, player.displayName);
    assert.notEqual(player.passwordHash, password);
    assert.match(player.passwordHash, /^\$argon2id\$/);

    const before = await prisma.session.findUnique({
      where: { playerAccountId: accountId },
    });
    assert.ok(before);
    assert.equal(before.tokenHash, hashSessionToken(registered.rawToken));
    assert.equal(before.revokedAt, null);
    assert.ok(before.expiresAt.getTime() > Date.now());

    await assert.rejects(
      AuthService.login({ email, password: 'wrong-password' }),
      { message: 'INVALID_CREDENTIALS' },
    );
    await assert.rejects(
      AuthService.login({ email, password }),
      { message: 'ACCOUNT_ALREADY_LOGGED_IN' },
    );
    assert.deepEqual(await prisma.session.findUnique({
      where: { playerAccountId: accountId },
    }), before);
    assert.deepEqual(
      await AuthService.getAuthenticatedAccount(registered.rawToken),
      registered.account,
    );

    await AuthService.logout(registered.rawToken);
    assert.equal(await AuthService.getAuthenticatedAccount(registered.rawToken), null);

    // Email normalization still works when a new login is allowed.
    const loggedIn = await AuthService.login({
      email: `  ${email.toUpperCase()}  `,
      password,
    });
    assert.notEqual(loggedIn.rawToken, registered.rawToken);
    const current = await prisma.session.findUnique({
      where: { playerAccountId: accountId },
    });
    assert.equal(current.tokenHash, hashSessionToken(loggedIn.rawToken));
    assert.equal(current.revokedAt, null);
    assert.equal(await prisma.session.count({
      where: { playerAccountId: accountId },
    }), 1);
    assert.equal(await AuthService.getAuthenticatedAccount('not-a-token'), null);

    await AuthService.logout(registered.rawToken);
    assert.deepEqual(
      await AuthService.getAuthenticatedAccount(loggedIn.rawToken),
      registered.account,
    );
    await AuthService.logout(loggedIn.rawToken);
    const revoked = await prisma.session.findUnique({
      where: { playerAccountId: accountId },
    });
    assert.ok(revoked.revokedAt instanceof Date);
    assert.equal(await AuthService.getAuthenticatedAccount(loggedIn.rawToken), null);
    await AuthService.logout(loggedIn.rawToken);
  });
});
