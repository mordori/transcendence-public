import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';

const existingAccount = {
  accountId: 'test-account-id',
  username: 'Daniel42',
  email: 'daniel@example.com',
  avatarId: 'default',
};

function setup(t) {
  const changes = [];

  const authService = {
	async getAuthenticatedAccount(rawToken) {
	  if (rawToken !== 'valid-test-token') {
		return null;
	  }

	  return existingAccount;
	},
  };

  const profileService = {
	async changeAvatar(accountId, avatarId) {
	  changes.push({ accountId, avatarId });

	  return {
		...existingAccount,
		avatarId,
	  };
	},
  };

  const app = buildApp({
	authService,
	profileService,
  });

  t.after(async () => {
	await app.close();
  });

  return { app, changes };
}

test('saves an avatar for the authenticated account', async (t) => {
  const { app, changes } = setup(t);

  const response = await app.inject({
	method: 'PATCH',
	url: '/api/profile/avatar',
	headers: {
	  'x-auth-request': '1',
	  cookie: 'session=valid-test-token',
	},
	payload: {
	  avatarId: 'red_car',
	},
  });

  assert.equal(response.statusCode, 200);

  assert.deepEqual(response.json(), {
	account: {
	  ...existingAccount,
	  avatarId: 'red_car',
	},
  });

  assert.deepEqual(changes, [
	{
	  accountId: existingAccount.accountId,
	  avatarId: 'red_car',
	},
  ]);
});

test('rejects a request without the custom header', async (t) => {
  const { app, changes } = setup(t);

  const response = await app.inject({
	method: 'PATCH',
	url: '/api/profile/avatar',
	headers: {
	  cookie: 'session=valid-test-token',
	},
	payload: {
	  avatarId: 'red_car',
	},
  });

  assert.equal(response.statusCode, 403);
  assert.equal(changes.length, 0);
});

test('rejects a request without a session cookie', async (t) => {
  const { app, changes } = setup(t);

  const response = await app.inject({
	method: 'PATCH',
	url: '/api/profile/avatar',
	headers: {
	  'x-auth-request': '1',
	},
	payload: {
	  avatarId: 'red_car',
	},
  });

  assert.equal(response.statusCode, 401);
  assert.equal(changes.length, 0);
});

test('rejects an invalid or expired session', async (t) => {
  const { app, changes } = setup(t);

  const response = await app.inject({
	method: 'PATCH',
	url: '/api/profile/avatar',
	headers: {
	  'x-auth-request': '1',
	  cookie: 'session=invalid-test-token',
	},
	payload: {
	  avatarId: 'red_car',
	},
  });

  assert.equal(response.statusCode, 401);
  assert.equal(changes.length, 0);
});

for (const avatarId of ['unknown_avatar', '', null]) {
  test(`rejects invalid avatar ID: ${String(avatarId)}`, async (t) => {
	const { app, changes } = setup(t);

	const response = await app.inject({
	  method: 'PATCH',
	  url: '/api/profile/avatar',
	  headers: {
		'x-auth-request': '1',
		cookie: 'session=valid-test-token',
	  },
	  payload: {
		avatarId,
	  },
	});

	assert.equal(response.statusCode, 400);
	assert.equal(changes.length, 0);
  });
}

test('rejects a request without avatarId', async (t) => {
  const { app, changes } = setup(t);

  const response = await app.inject({
	method: 'PATCH',
	url: '/api/profile/avatar',
	headers: {
	  'x-auth-request': '1',
	  cookie: 'session=valid-test-token',
	},
	payload: {},
  });

  assert.equal(response.statusCode, 400);
  assert.equal(changes.length, 0);
});


// What these tests establish
// They check that the route:
// Calls the save operation with the authenticated account’s ID.

// Returns updated account information.

// Rejects missing request protection.

// Rejects missing or invalid sessions.

// Rejects unsupported or missing avatar IDs.

// Does not call the save operation for rejected requests.

// Run the automated tests:
// cd backend

// # Install the backend's existing dependencies if necessary.
// npm ci

// # Run only the new profile-route tests.
// node --test test/profile.routes.test.js

// *should have 8 passing tests
