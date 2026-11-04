// backend/src/routes/auth.routes.js

const COOKIE_NAME = 'session';

const cookieOptions = {
  path: '/',
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
};

// Require an explicit header on requests that change authentication state.
// A plain cross-origin HTML form cannot add this custom header.
function requireAuthRequestHeader(request, reply) {
  if (request.headers['x-auth-request'] !== '1') {
    return reply.code(403).send({ error: 'Forbidden request' });
  }
}

// Fastify checks the shape of incoming JSON before calling the service.
// The service still performs its own stricter email/password validation.
const registerBody = {
  type: 'object',
  required: ['username', 'email', 'password'],
  additionalProperties: false,
  properties: {
    username: { type: 'string' },
    email: { type: 'string' },
    password: { type: 'string' },
  },
};

const loginBody = {
  type: 'object',
  required: ['email', 'password'],
  additionalProperties: false,
  properties: {
    email: { type: 'string' },
    password: { type: 'string' },
  },
};

function sendAuthError(error, reply) {
  if (error.message === 'ACCOUNT_ALREADY_LOGGED_IN') {
	return reply.code(409).send({
		code: 'ACCOUNT_ALREADY_LOGGED_IN',
		error: 'Account already logged in',
	});
  }
  if (
    error.message === 'INVALID_EMAIL' ||
    error.message === 'INVALID_USERNAME' ||
    error.message === 'INVALID_PASSWORD'
  ) {
    return reply.code(400).send({ error: 'Invalid input' });
  }

  if (error.message === 'INVALID_CREDENTIALS') {
    return reply.code(401).send({ error: 'Invalid credentials' });
  }

  // Prisma's unique-constraint error: email or username already exists.
  if (error.code === 'P2002') {
    return reply.code(409).send({ error: 'Account already exists' });
  }

  // Too many login attempts for this email during the current minute.
  if (error.message === 'LOGIN_RATE_LIMITED') {
    return reply.code(429).send({
      error: 'Too many login attempts. Try again later.',
    });
  }

  // Let Fastify handle unexpected infrastructure errors as server errors.
  throw error;
}

export async function registerAuthRoutes(app, { authService } = {}) {
  // The normal server loads the real service when an auth route is called.
  // Tests can supply a small fake service without opening DB/Redis connections.
  async function service() {
    if (authService) return authService;

    const module = await import('../services/auth.service.js');
    return module.AuthService;
  }

  // This plugin contains the register, login, logout, and /me routes.
  // The hook checks its POST requests; GET /me needs no CSRF check.
  app.addHook('onRequest', async (request, reply) => {
    if (request.method === 'POST') {
      return requireAuthRequestHeader(request, reply);
    }
  });

  app.post(
    '/api/auth/register',
    { schema: { body: registerBody } },
    async (request, reply) => {
      try {
        const result = await (await service()).register(request.body);

        reply.setCookie(COOKIE_NAME, result.rawToken, cookieOptions);
        return reply.code(201).send({ account: result.account });
      } catch (error) {
        return sendAuthError(error, reply);
      }
    },
  );

  app.post(
    '/api/auth/login',
    { schema: { body: loginBody } },
    async (request, reply) => {
      try {
        const result = await (await service()).login(request.body);

        reply.setCookie(COOKIE_NAME, result.rawToken, cookieOptions);
        return reply.send({ account: result.account });
      } catch (error) {
        return sendAuthError(error, reply);
      }
    },
  );

  app.get('/api/auth/me', async (request, reply) => {
    const rawToken = request.cookies?.[COOKIE_NAME];
    if (!rawToken) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const account =
      await (await service()).getAuthenticatedAccount(rawToken);

    if (!account) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    return { account };
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const rawToken = request.cookies?.[COOKIE_NAME];

    if (rawToken) {
      // Do not clear the browser cookie if revocation fails: the caller
      // must see the failure rather than believe logout succeeded.
      await (await service()).logout(rawToken);
    }

    reply.clearCookie(COOKIE_NAME, { path: '/' });
    return reply.code(204).send();
  });
}
