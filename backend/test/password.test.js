import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from '../src/utils/password.js';

// A saved hash must work with the password that produced it.
test('correct password verifies successfully', async () => {
  const password = 'my-test-password';
  const passwordHash = await hashPassword(password);

  assert.equal(await verifyPassword(passwordHash, password), true);
});

// Someone supplying a different password must not be authenticated.
test('wrong password is rejected', async () => {
  const passwordHash = await hashPassword('correct-password');

  assert.equal(
    await verifyPassword(passwordHash, 'wrong-password'),
    false,
  );
});

// We should save a hash, never the readable password.
// The prefix also confirms that Argon2id was selected.
test('password is stored as an Argon2id hash', async () => {
  const password = 'my-test-password';
  const passwordHash = await hashPassword(password);

  assert.notEqual(passwordHash, password);
  assert.match(passwordHash, /^\$argon2id\$/);
});

// Argon2 uses a new salt for each hash. Equal passwords should therefore
// produce different stored hashes, while both still verify correctly.
test('hashing the same password twice produces different hashes', async () => {
  const password = 'my-test-password';
  const firstHash = await hashPassword(password);
  const secondHash = await hashPassword(password);

  assert.notEqual(firstHash, secondHash);
  assert.equal(await verifyPassword(firstHash, password), true);
  assert.equal(await verifyPassword(secondHash, password), true);
});
