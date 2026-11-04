import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';

const AUTH_HEADERS = { 'x-auth-request': '1' };

test('mocked routes reject duplicate login and manage protected cookies', async () => {
  const account = {
    accountId: 'test-account', username: 'TestPlayer',
    email: 'test@example.test', avatarUrl: null,
  };
  let activeToken = null;
  const authService = {
    async register() {
      activeToken = 'first-test-token';
      return { account, rawToken: activeToken };
    },
    async login({ password }) {
      if (password !== 'correct-test-password') {
        throw new Error('INVALID_CREDENTIALS');
      }
      if (activeToken !== null) throw new Error('ACCOUNT_ALREADY_LOGGED_IN');
      activeToken = 'second-test-token';
      return { account, rawToken: activeToken };
    },
    async getAuthenticatedAccount(token) {
      return token === activeToken ? account : null;
    },
    async logout(token) {
      if (token === activeToken) activeToken = null;
    },
  };
  const app = buildApp({ authService });
  const me = (cookie) => app.inject({
    method: 'GET', url: '/api/auth/me', headers: { cookie },
  });
  const logout = (cookie) => app.inject({
    method: 'POST', url: '/api/auth/logout',
    headers: { ...AUTH_HEADERS, cookie },
  });
  const login = (password) => app.inject({
    method: 'POST', url: '/api/auth/login', headers: AUTH_HEADERS,
    payload: { email: account.email, password },
  });
  function cookieFrom(response) {
    const value = response.headers['set-cookie'];
    assert.equal(typeof value, 'string');
    assert.match(value, /HttpOnly/i);
    assert.match(value, /Secure/i);
    assert.match(value, /SameSite=Strict/i);
    return value.split(';')[0];
  }
  try {
    const blocked = await app.inject({
      method: 'POST', url: '/api/auth/register',
      payload: { username: account.username, email: account.email, password: 'correct-test-password' },
    });
    assert.equal(blocked.statusCode, 403);
    assert.equal(activeToken, null);
    assert.equal((await app.inject({
      method: 'GET', url: '/api/auth/me',
    })).statusCode, 401);
    const invalid = await app.inject({
      method: 'POST', url: '/api/auth/register', headers: AUTH_HEADERS,
      payload: { email: account.email },
    });
    assert.equal(invalid.statusCode, 400);
    const registered = await app.inject({
      method: 'POST', url: '/api/auth/register', headers: AUTH_HEADERS,
      payload: { username: account.username, email: account.email, password: 'correct-test-password' },
    });
    assert.equal(registered.statusCode, 201);
    assert.deepEqual(registered.json(), { account });
    const firstCookie = cookieFrom(registered);
    const initial = await me(firstCookie);
    assert.equal(initial.statusCode, 200);
    assert.deepEqual(initial.json(), { account });
    assert.equal((await login('wrong')).statusCode, 401);
    const duplicate = await login('correct-test-password');
    assert.equal(duplicate.statusCode, 409);
    assert.deepEqual(duplicate.json(), {
      code: 'ACCOUNT_ALREADY_LOGGED_IN',
      error: 'Account already logged in',
    });
    assert.equal(duplicate.headers['set-cookie'], undefined);
    assert.equal(activeToken, 'first-test-token');
    assert.equal((await me(firstCookie)).statusCode, 200);
    const firstLogout = await logout(firstCookie);
    assert.equal(firstLogout.statusCode, 204);
    assert.match(firstLogout.headers['set-cookie'], /Max-Age=0|Expires=/i);
    assert.equal((await me(firstCookie)).statusCode, 401);
    const loggedIn = await login('correct-test-password');
    assert.equal(loggedIn.statusCode, 200);
    assert.deepEqual(loggedIn.json(), { account });
    const secondCookie = cookieFrom(loggedIn);
    assert.notEqual(secondCookie, firstCookie);
    assert.equal((await logout(firstCookie)).statusCode, 204);
    assert.equal((await me(secondCookie)).statusCode, 200);
    const signedOut = await logout(secondCookie);
    assert.equal(signedOut.statusCode, 204);
    assert.match(signedOut.headers['set-cookie'], /Max-Age=0|Expires=/i);
    assert.equal((await me(secondCookie)).statusCode, 401);
  } finally {
    await app.close();
  }
});
