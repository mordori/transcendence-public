import { createHash } from 'node:crypto';
import { redis } from '../config/redis.js';

const MAX_ATTEMPTS = 5;
const WINDOW_SECONDS = 60;

// Redis runs this whole script as one operation. The first attempt
// starts a 60-second expiry; later attempts increase the same count.
redis.defineCommand('countLoginAttempt', {
  numberOfKeys: 1,
  lua: `
    local count = redis.call('INCR', KEYS[1])
    if count == 1 then
      redis.call('EXPIRE', KEYS[1], ARGV[1])
    end
    return count
  `,
});

export function loginAttemptKey(email) {
  const normalizedEmail = email.trim().toLowerCase();
  const emailHash = createHash('sha256')
    .update(normalizedEmail)
    .digest('hex');

  // The Redis key contains a hash, not the readable email address.
  return `auth:login-attempts:${emailHash}`;
}

export async function checkLoginAttempt(email) {
  const count = await redis.countLoginAttempt(
    loginAttemptKey(email),
    WINDOW_SECONDS,
  );

  if (count > MAX_ATTEMPTS) {
    throw new Error('LOGIN_RATE_LIMITED');
  }
}
