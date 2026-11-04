import { createHash, randomBytes } from 'node:crypto';

// One day. We will use this same value for the cookie and Redis TTL.
export const SESSION_TTL_SECONDS = 24 * 60 * 60;

export function createRawSessionToken() {
  // 32 random bytes make a new, unpredictable token.
  // base64url turns those bytes into a string suitable for a cookie.
  return randomBytes(32).toString('base64url');
}

export function hashSessionToken(rawToken) {
  // Store this hash in PostgreSQL and use it in the Redis key.
  // Give the raw token to the browser, never to either database.
  return createHash('sha256').update(rawToken).digest('hex');
}

export function getSessionExpiry() {
  return new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
}
