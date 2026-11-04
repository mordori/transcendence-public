import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';
import { hashSessionToken } from '../src/utils/session-token.js';
import { closeConnections, withAccount, cookieFrom } from './auth-test-helpers.js';

const AUTH_HEADERS = { 'x-auth-request': '1' };
after(closeConnections);

function protectedCookie(response) {
  const cookie = response.headers['set-cookie'];
  assert.equal(typeof cookie, 'string');
  assert.match(cookie, /^session=/);
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /Secure/i);
  assert.match(cookie, /SameSite=Strict/i);
  return cookieFrom(response);
}

test('real routes reject duplicate login and allow login after logout', async () => {
  await withAccount(async ({ username, email, password }) => {
    const app = buildApp();
    const me = (cookie) => app.inject({
      method: 'GET', url: '/api/auth/me', headers: { cookie },
    });
    const logout = (cookie) => app.inject({
      method: 'POST', url: '/api/auth/logout',
      headers: { ...AUTH_HEADERS, cookie },
    });
    const login = (submittedPassword = password) => app.inject({
      method: 'POST', url: '/api/auth/login', headers: AUTH_HEADERS,
      payload: { email, password: submittedPassword },
    });
    try {
      assert.equal((await app.inject({
        method: 'GET', url: '/api/auth/me',
      })).statusCode, 401);

      const response = await app.inject({
        method: 'POST', url: '/api/auth/register', headers: AUTH_HEADERS,
        payload: { username, email, password },
      });
      assert.equal(response.statusCode, 201);
      const account = response.json().account;
      assert.equal(account.email, email);
      assert.equal(account.username, username);
      assert.equal('rawToken' in response.json(), false);
      assert.equal('rawToken' in account, false);
      assert.equal('passwordHash' in account, false);
      const firstCookie = protectedCookie(response);
      const where = { playerAccountId: account.accountId };
      const before = await prisma.session.findUnique({ where });
      assert.equal(before.tokenHash, hashSessionToken(firstCookie.slice('session='.length)));
      assert.equal(before.revokedAt, null);
      const firstMe = await me(firstCookie);
      assert.equal(firstMe.statusCode, 200);
      assert.deepEqual(firstMe.json(), { account });

      assert.equal((await login('wrong-password')).statusCode, 401);
      const blocked = await login();
      assert.equal(blocked.statusCode, 409);
      assert.deepEqual(blocked.json(), {
        code: 'ACCOUNT_ALREADY_LOGGED_IN',
        error: 'Account already logged in',
      });
      assert.equal(blocked.headers['set-cookie'], undefined);
      assert.deepEqual(await prisma.session.findUnique({ where }), before);
      const stillSignedIn = await me(firstCookie);
      assert.equal(stillSignedIn.statusCode, 200);
      assert.deepEqual(stillSignedIn.json(), { account });

      const signedOut = await logout(firstCookie);
      assert.equal(signedOut.statusCode, 204);
      assert.match(signedOut.headers['set-cookie'], /Max-Age=0|Expires=/i);
      assert.equal((await me(firstCookie)).statusCode, 401);
      const loggedIn = await login();
      assert.equal(loggedIn.statusCode, 200);
      assert.deepEqual(loggedIn.json(), { account });
      const secondCookie = protectedCookie(loggedIn);
      assert.notEqual(secondCookie, firstCookie);
      const current = await prisma.session.findUnique({ where });
      assert.equal(current.tokenHash, hashSessionToken(secondCookie.slice('session='.length)));
      assert.equal(current.revokedAt, null);
      assert.equal((await logout(firstCookie)).statusCode, 204);
      assert.equal((await me(secondCookie)).statusCode, 200);
      assert.equal((await logout(secondCookie)).statusCode, 204);
      const revoked = await prisma.session.findUnique({ where });
      assert.ok(revoked.revokedAt instanceof Date);
      assert.equal((await me(secondCookie)).statusCode, 401);
    } finally {
      await app.close();
    }
  }, { register: false });
});
