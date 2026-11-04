import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SESSION_TTL_SECONDS,
  createRawSessionToken,
  hashSessionToken,
  getSessionExpiry,
} from '../src/utils/session-token.js';

test('each new login token is different', () => {
  const first = createRawSessionToken();
  const second = createRawSessionToken();

  assert.notEqual(first, second);
  assert.match(first, /^[A-Za-z0-9_-]{43}$/);
  assert.match(second, /^[A-Za-z0-9_-]{43}$/);
});

test('token hash is stable but differs from the raw token', () => {
  const rawToken = createRawSessionToken();
  const firstHash = hashSessionToken(rawToken);
  const secondHash = hashSessionToken(rawToken);

  assert.equal(firstHash, secondHash);
  assert.notEqual(firstHash, rawToken);
  assert.match(firstHash, /^[a-f0-9]{64}$/);
});

test('different tokens produce different hashes', () => {
  const firstHash = hashSessionToken(createRawSessionToken());
  const secondHash = hashSessionToken(createRawSessionToken());

  assert.notEqual(firstHash, secondHash);
});

test('expiry is approximately one session lifetime from now', () => {
  const before = Date.now();
  const expiry = getSessionExpiry();
  const after = Date.now();

  assert.ok(expiry instanceof Date);
  assert.ok(expiry.getTime() >= before + SESSION_TTL_SECONDS * 1000);
  assert.ok(expiry.getTime() <= after + SESSION_TTL_SECONDS * 1000);
});
