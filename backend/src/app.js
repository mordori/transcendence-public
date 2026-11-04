import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { registerAuthRoutes } from './routes/auth.routes.js';
import { registerRoomRoutes } from './routes/room.routes.js';
import { registerProfileRoutes } from './routes/profile.routes.js';

// Build the HTTP app without starting a network listener.
// This lets tests call routes using app.inject().
export function buildApp({ authService, lifecycle, profileService, roomRepository, gameServerAddress } = {}) {
  const app = Fastify({ logger: true });

  app.register(cookie);
  app.register(registerAuthRoutes, { authService });
  app.register(registerProfileRoutes, {authService, profileService});
  app.register(registerRoomRoutes, {
    authService,
    roomRepository,
    gameServerAddress,
  });

  // Liveness: proves that HTTP routing works.
  // It does not connect to PostgreSQL or Redis.
  app.get('/api/health', async () => {
    return { status: 'ok' };
  });

  // Readiness: 200 only when both PostgreSQL and Redis answer.
  // Like auth, the real lifecycle module is loaded on first use so tests can supply a fake.
  app.get('/api/health/ready', async (request, reply) => {
    const { DatabaseLifecycle } = lifecycle
      ? { DatabaseLifecycle: lifecycle }
      : await import('./database/lifecycle.js');
    const { error, ...health } = await DatabaseLifecycle.checkHealth();
    const ready = health.postgres === 'UP' && health.redis === 'UP';

    // The error text stays in the server log, not in the public response.
    if (error) request.log.error({ health, error }, 'readiness check failed');
    return reply.code(ready ? 200 : 503).send({ status: ready ? 'ready' : 'unavailable', ...health });
  });

  return app;
}
