import { randomBytes, randomUUID } from 'node:crypto';

const COOKIE_NAME = 'session';
const GAME_TICKET_COOKIE_NAME = 'game_ticket';
const GAME_TICKET_TTL_MS = 60_000;

const createRoomBody = {
  type: 'object',
  required: ['name'],
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 3, maxLength: 50 },
    password: {
      anyOf: [
        { type: 'string', minLength: 3, maxLength: 72 },
        { type: 'null' },
      ],
    },
  },
};

export async function registerRoomRoutes(
  app,
  {
    authService,
    roomRepository,
    gameServerAddress = process.env.GAME_SERVER_ADDRESS || 'game-server:9001',
  } = {},
) {
  async function getAuthService() {
    if (authService) return authService;
    const module = await import('../services/auth.service.js');
    return module.AuthService;
  }

  async function getRoomRepository() {
    if (roomRepository) return roomRepository;
    const module = await import('../repositories/cache.repository.js');
    return module.CacheRepository;
  }

  app.addHook('onRequest', async (request, reply) => {
    if (request.method === 'POST' && request.headers['x-auth-request'] !== '1') {
      return reply.code(403).send({ error: 'Forbidden request' });
    }
  });

  app.post(
    '/api/rooms',
    { schema: { body: createRoomBody } },
    async (request, reply) => {
      const rawToken = request.cookies?.[COOKIE_NAME];
      if (!rawToken) {
        return reply.code(401).send({ error: 'Not authenticated' });
      }

      const account = await (await getAuthService()).getAuthenticatedAccount(rawToken);
      if (!account) {
        return reply.code(401).send({ error: 'Not authenticated' });
      }

      const name = request.body.name.trim();
      const password = request.body.password || undefined;
      if (name.length < 3) {
        return reply.code(400).send({ error: 'Room name must be at least 3 characters' });
      }
      if (password && Buffer.byteLength(password, 'utf8') > 72) {
        return reply.code(400).send({ error: 'Room password is too long' });
      }

      const matchId = randomUUID();
      await (await getRoomRepository()).createRoom(matchId, {
        hostId: account.accountId,
        serverAddress: gameServerAddress,
        name,
        password,
      });

      return reply.code(201).send({
        room: {
          id: matchId,
          name,
          locked: Boolean(password),
          playerCount: 1,
        },
      });
    },
  );

  app.post('/api/rooms/:matchId/join', async (request, reply) => {
    const rawToken = request.cookies?.[COOKIE_NAME];
    if (!rawToken) return reply.code(401).send({ error: 'Not authenticated' });
    const account = await (await getAuthService()).getAuthenticatedAccount(rawToken);
    if (!account) return reply.code(401).send({ error: 'Not authenticated' });

    const matchId = request.params.matchId;
    const password = request.body?.password ?? undefined;
    const repo = await getRoomRepository();

    let result;
    try {
      result = await repo.joinPlayerToRoomPassword({
        matchId,
        accountId: account.accountId,
        password,
      });
    } catch (err) {
      // A player who already joined receives a conflict response.
      return reply.code(409).send({
        error: err instanceof Error ? err.message : 'Could not join room',
      });
    }

    if (result?.success === false) {
      return reply.code(400).send({ error: result.status });
    }

    const room = await repo.getRoom(matchId);
    return reply.send({
      room: {
        id: matchId,
        name: room.name,
        locked: Boolean(room.passwordHash),
        playerCount: Number(room.playerCount),
      },
    });
  });

  app.post('/api/rooms/:matchId/game-ticket', async (request, reply) => {
    const rawToken = request.cookies?.[COOKIE_NAME];
    if (!rawToken) return reply.code(401).send({ error: 'Not authenticated' });
    const account = await (await getAuthService())
      .getAuthenticatedAccount(rawToken);
    if (!account) return reply.code(401).send({ error: 'Not authenticated' });
    const matchId = request.params.matchId;
    const repo = await getRoomRepository();
    const room = await repo.getRoom(matchId);
    if (!room) return reply.code(404).send({ error: 'Room not found' });
    const players = await repo.getRoomPlayers(matchId);
    if (!players.includes(account.accountId)) {
      return reply.code(403).send({ error: 'Not a member of this room' });
    }
    const ticket = randomBytes(32).toString('base64url');
    await (await getRoomRepository()).saveGameTicket(matchId, ticket, {
      accountId: account.accountId,
      username: account.username,
      avatarId: account.avatarId ?? '',
    }, GAME_TICKET_TTL_MS);
    reply.setCookie(GAME_TICKET_COOKIE_NAME, ticket, {
      path: '/game',
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      maxAge: GAME_TICKET_TTL_MS / 1000,
    });
    return reply.code(204).send();
  });
  
  app.get('/api/rooms', async (request, reply) => {
    const rawToken = request.cookies?.[COOKIE_NAME];
    if (!rawToken) return reply.code(401).send({ error: 'Not authenticated' });
    const account = await (await getAuthService()).getAuthenticatedAccount(rawToken);
    if (!account) return reply.code(401).send({ error: 'Not authenticated' });

    const rooms = await (await getRoomRepository()).listActiveRooms();
    return reply.send({ rooms });
  });
}