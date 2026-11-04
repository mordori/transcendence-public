const COOKIE_NAME = 'session';

const avatarBody = {
  type: 'object',
  required: ['avatarId'],
  additionalProperties: false,
  properties: {
	avatarId: {
	  type: 'string',
	  enum: ['default', 'red_car', 'blue_car'],
	},
  },
};

const usernameBody = {
  type: 'object',
  required: ['username'],
  additionalProperties: false,
  properties: {
	username: {
	  type: 'string',
	  minLength: 3,
	  maxLength: 100,
	},
  },
};

export async function registerProfileRoutes(
  app,
  { authService, profileService } = {},
) {
  async function authentication() {
	if (authService) {
	  return authService;
	}

	const module = await import('../services/auth.service.js');
	return module.AuthService;
  }

  async function profiles() {
	if (profileService) {
	  return profileService;
	}

	const module = await import('../services/profile.service.js');
	return module.ProfileService;
  }

  // Route 1: Change the avatar.
  app.patch(
	'/api/profile/avatar',
	{
	  schema: {
		body: avatarBody,
	  },

	  onRequest: async (request, reply) => {
		if (request.headers['x-auth-request'] !== '1') {
		  return reply.code(403).send({
			error: 'Forbidden request',
		  });
		}
	  },
	},
	async (request, reply) => {
	  const rawToken = request.cookies?.[COOKIE_NAME];

	  if (!rawToken) {
		return reply.code(401).send({
		  error: 'Not authenticated',
		});
	  }

	  const account = await (
		await authentication()
	  ).getAuthenticatedAccount(rawToken);

	  if (!account) {
		return reply.code(401).send({
		  error: 'Not authenticated',
		});
	  }

	  try {
		const updatedAccount = await (
		  await profiles()
		).changeAvatar(
		  account.accountId,
		  request.body.avatarId,
		);

		return reply.send({
		  account: updatedAccount,
		});
	  } catch (error) {
		if (error.message === 'INVALID_AVATAR_ID') {
		  return reply.code(400).send({
			error: 'Choose one of the available avatars.',
		  });
		}

		if (error.code === 'P2025') {
		  return reply.code(401).send({
			error: 'Not authenticated',
		  });
		}

		throw error;
	  }
	},
  );

  // Route 2: Change the username.
  // This starts AFTER the avatar app.patch(...) has ended.
  app.patch(
	'/api/profile/username',
	{
	  schema: {
		body: usernameBody,
	  },

	  onRequest: async (request, reply) => {
		if (request.headers['x-auth-request'] !== '1') {
		  return reply.code(403).send({
			error: 'Forbidden request',
		  });
		}
	  },
	},
	async (request, reply) => {
	  const rawToken = request.cookies?.[COOKIE_NAME];

	  if (!rawToken) {
		return reply.code(401).send({
		  error: 'Not authenticated',
		});
	  }

	  const account = await (
		await authentication()
	  ).getAuthenticatedAccount(rawToken);

	  if (!account) {
		return reply.code(401).send({
		  error: 'Not authenticated',
		});
	  }

	  try {
		const updatedAccount = await (
		  await profiles()
		).changeUsername(
		  account.accountId,
		  request.body.username,
		);

		return reply.send({
		  account: updatedAccount,
		});
	  } catch (error) {
		if (error.message === 'INVALID_USERNAME') {
		  return reply.code(400).send({
			code: 'INVALID_USERNAME',
			error:
			  'Use 3–20 characters containing only letters and numbers.',
		  });
		}

		if (error.message === 'USERNAME_COOLDOWN') {
		  reply.header(
			'Retry-After',
			String(error.retryAfterSeconds),
		  );

		  return reply.code(429).send({
			code: 'USERNAME_COOLDOWN',
			error:
			  'You can change your username once every hour.',
			availableAt: error.availableAt,
		  });
		}

		if (error.code === 'P2002') {
		  return reply.code(409).send({
			code: 'USERNAME_TAKEN',
			error: 'That username is already taken.',
		  });
		}

		if (
		  error.message === 'ACCOUNT_NOT_FOUND' ||
		  error.code === 'P2025'
		) {
		  return reply.code(401).send({
			error: 'Not authenticated',
		  });
		}

		throw error;
	  }
	},
  );
}
