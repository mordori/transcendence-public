import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';

test('GET /api/health responds successfully', async () => {
  const app = buildApp();

  try {
	const response = await app.inject({
	  method: 'GET',
	  url: '/api/health',
	});

	assert.equal(response.statusCode, 200);
	assert.deepEqual(response.json(), { status: 'ok' });
  } finally {
	await app.close();
  }
});
