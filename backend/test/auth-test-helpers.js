import { randomUUID } from 'node:crypto';
import { prisma } from '../src/config/prisma.js';
import { redis } from '../src/config/redis.js';
import { AuthService } from '../src/services/auth.service.js';
import { loginAttemptKey } from '../src/services/login-throttle.js';

export async function closeConnections() {
  try {
    await prisma.$disconnect();
  } finally {
    await redis.quit();
  }
}

// Use a different disposable account for each test. Never use production data.
export async function withAccount(run, { t, register = true } = {}) {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const username = `Auth${suffix}`;
  const email = `auth-${suffix}@example.test`;
  const password = 'correct-test-password-123';

  try {
    const registered = register
      ? await AuthService.register({ username, email, password })
      : null;
    await run({ registered, username, email, password });
  } finally {
    // Restore injected failures before running cleanup.
    if (t) t.mock.restoreAll();
    try {
      const player = await prisma.playerAccount.findUnique({ where: { email } });
      if (player) {
        await prisma.session.deleteMany({
          where: { playerAccountId: player.accountId },
        });
        await prisma.playerAccount.delete({
          where: { accountId: player.accountId },
        });
      }
    } finally {
      await redis.del(loginAttemptKey(email));
    }
  }
}

export function cookieFrom(response) {
  const cookie = response.headers['set-cookie'];
  if (typeof cookie !== 'string') throw new Error('Expected a session cookie');
  return cookie.split(';')[0];
}
