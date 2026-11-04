// backend/src/utils/DB-testers.js
//
// Backend test suite built on node:test and node:assert/strict.
//
//   node --test src/utils/DB-testers.js
//
// Test names carry a ZOMBIES tag:
//   [Z]ero  [O]ne  [M]any  [B]oundary  [I]nterface  [E]xceptions  [S]imple
//
// Layers
//   0. Module graph integrity  - every relative import in src/ resolves.
//   A. Unit                    - pure helpers, validators, payload builders,
//                                and every repository/service branch driven
//                                through in-process stubs (no network).
//   B. Regression              - Lua numeric conversion, Prisma FK types,
//                                partial-update preservation.
//   C. Integration             - Fastify routes via inject(), real Redis
//                                rooms + Lua, real PostgreSQL repositories,
//                                auth/session lifecycle, DB lifecycle.
//
// Live services (layer C, and the live halves of layer B) are used only when
// connection settings are present and reachable:
//   DATABASE_URL                                            -> PostgreSQL
//   REDIS_URL, or REDIS_HOST + REDIS_PORT + REDIS_PASSWORD_FILE -> Redis
// Otherwise those tests are skipped and the skip message says why.
// Run them against a DEVELOPMENT database only; every test uses unique ids
// and removes the rows and keys it creates.
//
// Module redirection
//   The source files import their clients from ../config/prisma.js and
//   ../config/redis.js. Those modules create real clients when loaded, so a
//   loader hook below resolves both paths to shims exporting the clients this
//   suite controls (live or stubbed).

import test, { describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC_URL = new URL('../', import.meta.url);
const BACKEND_URL = new URL('../../', import.meta.url);

const readSource = (rel) => readFileSync(new URL(rel, SRC_URL), 'utf8');

// ---------------------------------------------------------------------------
// Client registry
// ---------------------------------------------------------------------------

const OFFLINE = Symbol('offline');

// Stands in for a client with no live connection: every call rejects.
function offlineClient(path) {
	return new Proxy(function () {}, {
		get(_, prop) {
			if (prop === OFFLINE) return true;
			if (prop === 'then' || typeof prop === 'symbol') return undefined;
			return offlineClient(`${path}.${prop}`);
		},
		apply() {
			return Promise.reject(new Error(`NO_LIVE_CONNECTION: ${path}()`));
		},
	});
}

const live = { prisma: null, redis: null };
const offlineReason = {
	postgres: 'DATABASE_URL is not set',
	redis: 'REDIS_URL / REDIS_HOST is not set',
};

// What source modules currently talk to. Tests swap these with withClients().
const targets = {
	prisma: offlineClient('prisma'),
	redis: offlineClient('redis'),
};

// Lua scripts registered by source modules through redis.defineCommand().
const luaScripts = new Map();

function delegateTo(name) {
	return new Proxy(Object.create(null), {
		get(_, prop) {
			if (name === 'redis' && prop === 'defineCommand') {
				return (command, definition) => {
					luaScripts.set(command, definition);
					live.redis?.defineCommand(command, definition);
				};
			}

			const target = targets[name];
			const value = target[prop];

			// Real clients need `this`; stubs are proxies that must stay unbound.
			if (typeof value === 'function' && target === live[name]) {
				return value.bind(target);
			}
			return value;
		},
	});
}

const CLIENTS_KEY = 'transcendence.testers.clients';
globalThis[Symbol.for(CLIENTS_KEY)] = {
	prisma: delegateTo('prisma'),
	redis: delegateTo('redis'),
};

// Run `fn` while source modules see the given stub clients.
async function withClients(stubs, fn) {
	const saved = { ...targets };
	Object.assign(targets, stubs);
	try {
		return await fn();
	} finally {
		Object.assign(targets, saved);
	}
}

// A recording stub client. `handlers` maps a dotted call path such as
// 'playerAccount.update' or 'hgetall' to its implementation. Calling a path
// without a handler throws UNSTUBBED_CALL so unexpected I/O is visible.
function stubClient(handlers = {}) {
	const calls = [];

	const node = (path) =>
		new Proxy(function () {}, {
			get(_, prop) {
				if (prop === 'then' || typeof prop === 'symbol') return undefined;
				return node(path ? `${path}.${prop}` : prop);
			},
			apply(_, __, args) {
				calls.push({ path, args });
				if (!(path in handlers)) {
					throw new Error(`UNSTUBBED_CALL: ${path}`);
				}
				return handlers[path](...args);
			},
		});

	return {
		client: node(''),
		calls,
		callsTo: (path) => calls.filter((call) => call.path === path),
	};
}

// A Redis pipeline stub that records queued commands until exec().
function pipelineStub(execResult = []) {
	const ops = [];
	let execCount = 0;

	const pipeline = new Proxy(
		{},
		{
			get(_, command) {
				if (command === 'exec') {
					return async () => {
						execCount += 1;
						return execResult;
					};
				}
				return (...args) => {
					ops.push([command, ...args]);
					return pipeline;
				};
			},
		},
	);

	return { pipeline, ops, execCount: () => execCount };
}

// ---------------------------------------------------------------------------
// Loader hook: resolve missing/broken client modules to shims
// ---------------------------------------------------------------------------

const shim = (body) =>
	`data:text/javascript,${encodeURIComponent(
		`const c = globalThis[Symbol.for('${CLIENTS_KEY}')];\n${body}`,
	)}`;

const PRISMA_SHIM = shim(
	'export default c.prisma; export const prisma = c.prisma;',
);
const REDIS_SHIM = shim(
	'export default c.redis; export const redis = c.redis; export const redisClient = c.redis;',
);

const REDIRECTS = {
	[new URL('config/prisma.js', SRC_URL).href]: PRISMA_SHIM,
	[new URL('config/redis.js', SRC_URL).href]: REDIS_SHIM,
};

const RESOLVE_HOOKS = `
let redirects = {};
export async function initialize(data) { redirects = data; }
export async function resolve(specifier, context, nextResolve) {
	if (context.parentURL && specifier.startsWith('.')) {
		const url = new URL(specifier, context.parentURL);
		url.search = '';
		url.hash = '';
		if (redirects[url.href]) return { url: redirects[url.href], shortCircuit: true };
	}
	return nextResolve(specifier, context);
}`;

register(`data:text/javascript,${encodeURIComponent(RESOLVE_HOOKS)}`, {
	data: REDIRECTS,
});

// ---------------------------------------------------------------------------
// Live connections (optional)
// ---------------------------------------------------------------------------

async function withTimeout(promise, ms, label) {
	let timer;
	const timeout = new Promise((_, reject) => {
		timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
	});
	try {
		return await Promise.race([promise, timeout]);
	} finally {
		clearTimeout(timer);
	}
}

async function connectPostgres() {
	if (!process.env.DATABASE_URL) return;

	let client;
	try {
		const [{ PrismaClient }, { PrismaPg }] = await Promise.all([
			import('@prisma/client'),
			import('@prisma/adapter-pg'),
		]);
		client = new PrismaClient({
			adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
		});
		await withTimeout(client.$queryRaw`SELECT 1`, 5000, 'PostgreSQL');
		live.prisma = client;
		targets.prisma = client;
	} catch (error) {
		offlineReason.postgres = `PostgreSQL unreachable: ${error.message}`;
		await client?.$disconnect().catch(() => {});
	}
}

function redisSettings() {
	if (process.env.REDIS_URL) return process.env.REDIS_URL;
	if (!process.env.REDIS_HOST) return null;

	return {
		host: process.env.REDIS_HOST,
		port: Number(process.env.REDIS_PORT) || 6379,
		password: process.env.REDIS_PASSWORD_FILE
			? readFileSync(process.env.REDIS_PASSWORD_FILE, 'utf8').trim()
			: undefined,
	};
}

async function connectRedis() {
	let client;
	try {
		const settings = redisSettings();
		if (!settings) return;

		const { default: Redis } = await import('ioredis');
		const options = {
			lazyConnect: true,
			maxRetriesPerRequest: 1,
			retryStrategy: () => null,
		};
		client =
			typeof settings === 'string'
				? new Redis(settings, options)
				: new Redis({ ...settings, ...options });

		// Failures surface through rejected commands instead.
		client.on('error', () => {});

		await withTimeout(client.connect(), 5000, 'Redis');
		const pong = await client.ping();
		if (pong !== 'PONG') throw new Error(`PING answered ${pong}`);

		live.redis = client;
		targets.redis = client;
	} catch (error) {
		offlineReason.redis = `Redis unreachable: ${error.message}`;
		client?.disconnect();
	}
}

// Connect before importing source modules so their defineCommand() calls
// reach the live Redis client.
await Promise.all([connectPostgres(), connectRedis()]);

after(async () => {
	if (live.redis && live.redis.status !== 'end') {
		await live.redis.quit().catch(() => live.redis.disconnect());
	}
	await live.prisma?.$disconnect().catch(() => {});
});

const needsRedis = { skip: live.redis ? false : offlineReason.redis };
const needsPostgres = { skip: live.prisma ? false : offlineReason.postgres };
const needsBoth = {
	skip: !live.prisma
		? offlineReason.postgres
		: !live.redis
			? offlineReason.redis
			: false,
};

// ---------------------------------------------------------------------------
// Source modules under test
// ---------------------------------------------------------------------------

async function load(rel) {
	try {
		return { module: await import(new URL(rel, SRC_URL).href) };
	} catch (error) {
		return { error };
	}
}

const loaded = {
	keys: await load('database/keys.js'),
	sessionToken: await load('utils/session-token.js'),
	password: await load('utils/password.js'),
	playerRepo: await load('repositories/player.repository.js'),
	matchRepo: await load('repositories/match.repository.js'),
	sessionRepo: await load('repositories/session.repository.js'),
	cacheRepo: await load('repositories/cache.repository.js'),
	throttle: await load('services/login-throttle.js'),
	auth: await load('services/auth.service.js'),
	routes: await load('routes/auth.routes.js'),
	app: await load('app.js'),
	lifecycle: await load('database/lifecycle.js'),
	redisCommands: await load('database/redis-commands.js'),
};

// config/redis.js is replaced by a shim, so the Lua commands it registers on
// load are registered here instead (recorded in luaScripts + live client).
loaded.redisCommands.module?.registerRedisCommands(globalThis[Symbol.for(CLIENTS_KEY)].redis);

// An import failure fails only the tests that need that module.
function use(name) {
	const entry = loaded[name];
	if (entry.error) {
		throw new Error(`Could not import src module "${name}": ${entry.error.message}`, {
			cause: entry.error,
		});
	}
	return entry.module;
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const uniq = () => randomUUID().replaceAll('-', '').slice(0, 12);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

const RAW_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const VALID_PASSWORD = 'correct-test-password-123';

// Raw key strings shared with the C++ game server. Spelled out here so
// tests check the wire contract independently of RedisKeys.
const wire = {
	room: (id) => `room:${id}`,
	players: (id) => `room:${id}:players`,
	spectators: (id) => `room:${id}:spectators`,
	slots: (id) => `room:${id}:slots`,
	status: (id) => `player:status:${id}`,
	session: (hash) => `session:${hash}`,
	active: 'rooms:active',
};

const VALID_USERNAMES = [
	['[B] exact minimum length (3)', 'abc', 'abc'],
	['[B] exact maximum length (20)', 'a'.repeat(20), 'a'.repeat(20)],
	['[B] ASCII 48 "0"', 'a0a', 'a0a'],
	['[B] ASCII 57 "9"', 'a9a', 'a9a'],
	['[B] ASCII 65 "A"', 'aAa', 'aAa'],
	['[B] ASCII 90 "Z"', 'aZa', 'aZa'],
	['[B] ASCII 97 "a"', 'zaz', 'zaz'],
	['[B] ASCII 122 "z"', 'aza', 'aza'],
	['[O] digits only', '123', '123'],
	['[S] mixed case and digits', 'Player42X', 'Player42X'],
	['[B] surrounding spaces are trimmed', '  abc  ', 'abc'],
	['[B] tabs and newlines are trimmed', '\tabc\n', 'abc'],
	['[B] 20 chars after trimming', `  ${'b'.repeat(20)}  `, 'b'.repeat(20)],
];

const INVALID_USERNAMES = [
	['[Z] empty string', ''],
	['[Z] whitespace only', '   '],
	['[B] 2 chars', 'ab'],
	['[B] 21 chars', 'a'.repeat(21)],
	['[B] 2 chars after trimming', '  ab  '],
	['[B] ASCII 47 "/"', 'ab/'],
	['[B] ASCII 58 ":"', 'ab:'],
	['[B] ASCII 64 "@"', 'ab@'],
	['[B] ASCII 91 "["', 'ab['],
	['[B] ASCII 96 "`"', 'ab`'],
	['[B] ASCII 123 "{"', 'ab{'],
	['[E] inner space', 'ab cd'],
	['[E] underscore', 'ab_cd'],
	['[E] hyphen', 'ab-cd'],
	['[E] accented letter', 'José'],
	['[E] diaeresis', 'naïve'],
	['[E] emoji', 'abc😀'],
	['[E] full-width letters', 'ａｂｃ'],
	['[E] Arabic-Indic digits', '١٢٣'],
	['[E] NUL character', 'ab\u0000c'],
	['[E] null', null],
	['[E] number', 12345],
	['[E] object', {}],
	['[E] boolean', true],
];

// ===========================================================================
// Layer 0 - Module graph integrity
// ===========================================================================

function listSourceFiles(dirUrl = SRC_URL, prefix = '') {
	return readdirSync(dirUrl, { withFileTypes: true }).flatMap((entry) => {
		if (entry.isDirectory()) {
			return listSourceFiles(new URL(`${entry.name}/`, dirUrl), `${prefix}${entry.name}/`);
		}
		return entry.name.endsWith('.js') ? [`${prefix}${entry.name}`] : [];
	});
}

function exportedNames(source) {
	const names = new Set();
	if (/export\s+default\b/.test(source)) names.add('default');

	const declared =
		/export\s+(?:async\s+)?(?:const|let|var|function\*?|class)\s+([A-Za-z_$][\w$]*)/g;
	for (const match of source.matchAll(declared)) names.add(match[1]);

	for (const match of source.matchAll(/export\s*\{([^}]*)\}/g)) {
		for (const part of match[1].split(',')) {
			const name = part.trim().split(/\s+as\s+/).pop();
			if (name) names.add(name);
		}
	}
	return names;
}

function importProblems(rel) {
	const source = readSource(rel);
	const fileUrl = new URL(rel, SRC_URL);
	const problems = [];

	const staticImport = /import\s+([^'";]+?)\s+from\s+['"](\.{1,2}\/[^'"]+)['"]/g;
	for (const [, clause, specifier] of source.matchAll(staticImport)) {
		const targetUrl = new URL(specifier, fileUrl);
		if (!existsSync(targetUrl)) {
			problems.push(`'${specifier}' does not exist`);
			continue;
		}

		const exported = exportedNames(readFileSync(targetUrl, 'utf8'));
		const wanted = [];
		const defaultName = clause.match(/^([A-Za-z_$][\w$]*)/);
		if (defaultName) wanted.push('default');

		const named = clause.match(/\{([^}]*)\}/);
		if (named) {
			for (const part of named[1].split(',')) {
				const name = part.trim().split(/\s+as\s+/)[0];
				if (name) wanted.push(name);
			}
		}

		for (const name of wanted) {
			if (!exported.has(name)) {
				problems.push(`'${specifier}' has no ${name === 'default' ? 'default export' : `export named '${name}'`}`);
			}
		}
	}

	const dynamicImport = /import\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g;
	for (const [, specifier] of source.matchAll(dynamicImport)) {
		if (!existsSync(new URL(specifier, fileUrl))) {
			problems.push(`dynamic import '${specifier}' does not exist`);
		}
	}

	return problems;
}

describe('Layer 0 - Module graph integrity', () => {
	// utils/testers.js was the old suite; this file is the suite itself.
	const skipped = new Set(['utils/testers.js']);

	for (const rel of listSourceFiles().filter((file) => !skipped.has(file))) {
		test(`[I] src/${rel} resolves every relative import and imported name`, () => {
			assert.deepEqual(importProblems(rel), [], `broken imports in src/${rel}`);
		});
	}
});

// ===========================================================================
// Layer A - Unit tests
// ===========================================================================

describe('Layer A - RedisKeys (database/keys.js)', () => {
	test('[S] room keys follow the room:<id> wire contract shared with C++', () => {
		const { RedisKeys } = use('keys');
		assert.equal(RedisKeys.roomKey('m1'), 'room:m1');
		assert.equal(RedisKeys.roomPlayersKey('m1'), 'room:m1:players');
		assert.equal(RedisKeys.roomSlotsKey('m1'), 'room:m1:slots');
		assert.equal(RedisKeys.roomSpectatorsKey('m1'), 'room:m1:spectators');
	});

	test('[S] session, status and room-set keys', () => {
		const { RedisKeys } = use('keys');
		assert.equal(RedisKeys.sessionKey('abc'), 'session:abc');
		assert.equal(RedisKeys.playerStatusKey('acc'), 'player:status:acc');
		assert.equal(RedisKeys.allRoomsKey(), 'rooms:active');
	});

	test('[Z] empty id still produces a namespaced key', () => {
		const { RedisKeys } = use('keys');
		assert.equal(RedisKeys.roomKey(''), 'room:');
		assert.equal(RedisKeys.roomPlayersKey(''), 'room::players');
	});

	test('[M] distinct ids never collide across key families', () => {
		const { RedisKeys } = use('keys');
		const ids = ['a', 'b', 'a:players', '1'];
		const keys = ids.flatMap((id) => [
			RedisKeys.roomKey(id),
			RedisKeys.roomSlotsKey(id),
			RedisKeys.roomSpectatorsKey(id),
			RedisKeys.sessionKey(id),
			RedisKeys.playerStatusKey(id),
		]);
		assert.equal(new Set(keys).size, keys.length);
	});

	test('[I] every factory is a function returning a string', () => {
		const { RedisKeys } = use('keys');
		assert.deepEqual(Object.keys(RedisKeys).sort(), [
			'allRoomsKey',
			'gameEventsStream',
			'gameTicketKey',
			'playerStatusKey',
			'roomKey',
			'roomPlayersKey',
			'roomPresenceKey',
			'roomSlotsKey',
			'roomSpectatorsKey',
			'sessionKey',
		]);
		for (const factory of Object.values(RedisKeys)) {
			assert.equal(typeof factory('x'), 'string');
		}
	});
});

describe('Layer A - Session tokens (utils/session-token.js)', () => {
	test('[S] TTL is exactly one day', () => {
		assert.equal(use('sessionToken').SESSION_TTL_SECONDS, 86400);
	});

	test('[O] raw token is 43 base64url characters (32 random bytes)', () => {
		const token = use('sessionToken').createRawSessionToken();
		assert.match(token, RAW_TOKEN_PATTERN);
		assert.equal(Buffer.from(token, 'base64url').length, 32);
	});

	test('[M] 1000 raw tokens are all unique', () => {
		const { createRawSessionToken } = use('sessionToken');
		const tokens = new Set(Array.from({ length: 1000 }, createRawSessionToken));
		assert.equal(tokens.size, 1000);
	});

	test('[I] hash is lowercase SHA-256 hex, stable, and differs from the token', () => {
		const { createRawSessionToken, hashSessionToken } = use('sessionToken');
		const raw = createRawSessionToken();
		assert.match(hashSessionToken(raw), /^[a-f0-9]{64}$/);
		assert.equal(hashSessionToken(raw), hashSessionToken(raw));
		assert.notEqual(hashSessionToken(raw), raw);
		assert.equal(
			hashSessionToken('abc'),
			'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
		);
	});

	test('[Z] hash of the empty string is the SHA-256 empty digest', () => {
		assert.equal(
			use('sessionToken').hashSessionToken(''),
			'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
		);
	});

	test('[E] hashing a non-string throws TypeError', () => {
		const { hashSessionToken } = use('sessionToken');
		assert.throws(() => hashSessionToken(undefined), TypeError);
		assert.throws(() => hashSessionToken(42), TypeError);
	});

	test('[B] expiry is one TTL from now', () => {
		const { getSessionExpiry, SESSION_TTL_SECONDS } = use('sessionToken');
		const before = Date.now();
		const expiry = getSessionExpiry();
		const afterCall = Date.now();
		assert.ok(expiry instanceof Date);
		assert.ok(expiry.getTime() >= before + SESSION_TTL_SECONDS * 1000);
		assert.ok(expiry.getTime() <= afterCall + SESSION_TTL_SECONDS * 1000);
	});
});

describe('Layer A - Password hashing (utils/password.js)', () => {
	test('[S] hash is Argon2id and verifies the original password', async () => {
		const { hashPassword, verifyPassword } = use('password');
		const hash = await hashPassword('my-test-password');
		assert.match(hash, /^\$argon2id\$/);
		assert.notEqual(hash, 'my-test-password');
		assert.equal(await verifyPassword(hash, 'my-test-password'), true);
	});

	test('[E] wrong password does not verify', async () => {
		const { hashPassword, verifyPassword } = use('password');
		const hash = await hashPassword('correct-password');
		assert.equal(await verifyPassword(hash, 'wrong-password'), false);
		assert.equal(await verifyPassword(hash, 'correct-passwor'), false);
	});

	test('[M] same password hashes differently (random salt), both verify', async () => {
		const { hashPassword, verifyPassword } = use('password');
		const [first, second] = await Promise.all([
			hashPassword('same-password'),
			hashPassword('same-password'),
		]);
		assert.notEqual(first, second);
		assert.equal(await verifyPassword(first, 'same-password'), true);
		assert.equal(await verifyPassword(second, 'same-password'), true);
	});

	test('[B] non-ASCII password round-trips', async () => {
		const { hashPassword, verifyPassword } = use('password');
		const hash = await hashPassword('pässwörd-🔐-密码');
		assert.equal(await verifyPassword(hash, 'pässwörd-🔐-密码'), true);
		assert.equal(await verifyPassword(hash, 'passwort-🔐-密码'), false);
	});

	test('[E] malformed stored hash rejects', async () => {
		await assert.rejects(use('password').verifyPassword('not-a-hash', 'x'));
	});
});

describe('Layer A - Username validation (PlayerRepository.updateProfile)', () => {
	// Captures the Prisma update payload without touching a database.
	async function profileUpdate(fields) {
		const db = stubClient({
			'playerAccount.update': async (args) => ({ accountId: args.where.accountId }),
		});
		const { PlayerRepository } = use('playerRepo');
		await withClients({ prisma: db.client }, () =>
			PlayerRepository.updateProfile('acc-1', fields),
		);
		return db;
	}

	for (const [label, input, stored] of VALID_USERNAMES) {
		test(`${label}: ${JSON.stringify(input)} is accepted and stored as ${JSON.stringify(stored)}`, async () => {
			const db = await profileUpdate({ username: input });
			const [call] = db.callsTo('playerAccount.update');
			assert.equal(call.args[0].data.displayName, stored);
		});
	}

	for (const [label, input] of INVALID_USERNAMES) {
		test(`${label}: ${JSON.stringify(input)} is rejected with INVALID_USERNAME before any DB write`, async () => {
			const db = stubClient();
			const { PlayerRepository } = use('playerRepo');
			await withClients({ prisma: db.client }, () =>
				assert.rejects(
					PlayerRepository.updateProfile('acc-1', { username: input }),
					{ message: 'INVALID_USERNAME' },
				),
			);
			assert.equal(db.calls.length, 0);
		});
	}
});

describe('Layer A - Payload generators (PlayerRepository)', () => {
	const capture = async (method, ...args) => {
		const db = stubClient({
			'playerAccount.create': async (query) => query,
			'playerAccount.findUnique': async (query) => query,
			'playerAccount.update': async (query) => query,
		});
		const { PlayerRepository } = use('playerRepo');
		await withClients({ prisma: db.client }, () => PlayerRepository[method](...args));
		assert.equal(db.calls.length, 1);
		return db.calls[0];
	};

	test('[I] createPlayer maps parameters to Prisma field names', async () => {
		const call = await capture('createPlayer', 'uuid-1', 'Alice', 'a@x.test', 'HASH');
		assert.equal(call.path, 'playerAccount.create');
		assert.deepEqual(call.args[0], {
			data: {
				accountId: 'uuid-1',
				displayName: 'Alice',
				email: 'a@x.test',
				passwordHash: 'HASH',
			},
		});
	});

	test('[I] getPlayerById / getPlayerByUsername / getPlayerByEmail query the right unique field', async () => {
		assert.deepEqual((await capture('getPlayerById', 'u1')).args[0], {
			where: { accountId: 'u1' },
		});
		assert.deepEqual((await capture('getPlayerByUsername', 'Bob')).args[0], {
			where: { displayName: 'Bob' },
		});
		assert.deepEqual((await capture('getPlayerByEmail', 'b@x.test')).args[0], {
			where: { email: 'b@x.test' },
		});
	});

	test('[Z] updateProfile with no fields sends an empty data object', async () => {
		const { args } = await capture('updateProfile', 'u1', {});
		assert.deepEqual(args[0].where, { accountId: 'u1' });
		assert.deepEqual(args[0].data, {});
	});

	test('[I] username is remapped to displayName; "username" never reaches Prisma', async () => {
		const { args } = await capture('updateProfile', 'u1', { username: 'NewName' });
		assert.deepEqual(args[0].data, { displayName: 'NewName' });
	});

	test('[B] avatarId undefined is excluded from the payload', async () => {
		const { args } = await capture('updateProfile', 'u1', { avatarId: undefined });
		assert.equal('avatarId' in args[0].data, false);
	});

	test('[S] a known avatarId is included', async () => {
		const { args } = await capture('updateProfile', 'u1', { avatarId: 'red_car' });
		assert.deepEqual(args[0].data, { avatarId: 'red_car' });
	});

	for (const bad of [null, '', 'avatars/1.png', 'RED_CAR']) {
		test(`[E] avatarId ${JSON.stringify(bad)} -> INVALID_AVATAR_ID, nothing written`, async () => {
			const { PlayerRepository } = use('playerRepo');
			const prisma = stubClient();
			await withClients({ prisma: prisma.client }, () =>
				assert.rejects(PlayerRepository.updateProfile('u1', { avatarId: bad }), {
					message: 'INVALID_AVATAR_ID',
				}),
			);
			assert.equal(prisma.calls.length, 0);
		});
	}

	test('[M] username and avatarId together', async () => {
		const { args } = await capture('updateProfile', 'u1', {
			username: ' Combo1 ',
			avatarId: 'blue_car',
		});
		assert.deepEqual(args[0].data, { displayName: 'Combo1', avatarId: 'blue_car' });
	});

	test('[I] updateProfile never selects passwordHash', async () => {
		const { args } = await capture('updateProfile', 'u1', {});
		assert.deepEqual(args[0].select, {
			accountId: true,
			displayName: true,
			email: true,
			avatarId: true,
			usernameChangedAt: true,
			createdAt: true,
			updatedAt: true,
		});
	});

	test('[E] updateProfile without a fields object rejects with TypeError', async () => {
		const { PlayerRepository } = use('playerRepo');
		await withClients({ prisma: stubClient().client }, () =>
			assert.rejects(PlayerRepository.updateProfile('u1'), TypeError),
		);
	});

	test('[I] updateEmail sends only the email field', async () => {
		const { args } = await capture('updateEmail', 'u1', 'new@x.test');
		assert.deepEqual(args[0], { where: { accountId: 'u1' }, data: { email: 'new@x.test' } });
	});
});

describe('Layer A - MatchRepository payloads', () => {
	test('[I] saveMatchResult maps only the three match fields', async () => {
		const db = stubClient({ 'matchHistory.create': async (query) => query.data });
		const { MatchRepository } = use('matchRepo');
		const data = await withClients({ prisma: db.client }, () =>
			MatchRepository.saveMatchResult({
				matchId: 'm1',
				winningTeam: 'Blue',
				finalScore: '3/2',
				injected: 'ignored',
			}),
		);
		assert.deepEqual(data, { matchId: 'm1', winningTeam: 'Blue', finalScore: '3/2' });
	});

	test('[Z] saveMatchResult leaves finalScore undefined when omitted', async () => {
		const db = stubClient({ 'matchHistory.create': async (query) => query.data });
		const { MatchRepository } = use('matchRepo');
		const data = await withClients({ prisma: db.client }, () =>
			MatchRepository.saveMatchResult({ matchId: 'm1', winningTeam: 'Red' }),
		);
		assert.equal(data.finalScore, undefined);
	});

	test('[E] saveMatchResult without an argument rejects with TypeError', async () => {
		const { MatchRepository } = use('matchRepo');
		await withClients({ prisma: stubClient().client }, () =>
			assert.rejects(MatchRepository.saveMatchResult(), TypeError),
		);
	});

	test('[I] getMatchById queries by matchId', async () => {
		const db = stubClient({ 'matchHistory.findUnique': async (query) => query });
		const { MatchRepository } = use('matchRepo');
		const query = await withClients({ prisma: db.client }, () =>
			MatchRepository.getMatchById('m9'),
		);
		assert.deepEqual(query, { where: { matchId: 'm9' } });
	});
});

describe('Layer A - SessionRepository payloads', () => {
	test('[I] findByAccountId uses the default client, or the db passed in', async () => {
		const { SessionRepository } = use('sessionRepo');
		const db = stubClient({ 'session.findUnique': async (query) => ({ via: 'default', query }) });
		const tx = stubClient({ 'session.findUnique': async (query) => ({ via: 'tx', query }) });

		await withClients({ prisma: db.client }, async () => {
			assert.deepEqual(await SessionRepository.findByAccountId('a1'), {
				via: 'default',
				query: { where: { playerAccountId: 'a1' } },
			});
			assert.equal((await SessionRepository.findByAccountId('a1', tx.client)).via, 'tx');
		});
	});

	test('[I] createOrReplace upserts and clears revokedAt only on replace', async () => {
		const { SessionRepository } = use('sessionRepo');
		const tx = stubClient({ 'session.upsert': async (query) => query });
		const expiresAt = new Date('2030-01-01T00:00:00Z');

		const query = await SessionRepository.createOrReplace(
			{ playerAccountId: 'a1', tokenHash: 'h1', expiresAt },
			tx.client,
		);
		assert.deepEqual(query, {
			where: { playerAccountId: 'a1' },
			create: { playerAccountId: 'a1', tokenHash: 'h1', expiresAt },
			update: { tokenHash: 'h1', expiresAt, revokedAt: null },
		});
	});

	test('[I] findActiveByTokenHash filters revoked and expired sessions', async () => {
		const { SessionRepository } = use('sessionRepo');
		const db = stubClient({ 'session.findFirst': async (query) => query });
		const before = Date.now();
		const query = await withClients({ prisma: db.client }, () =>
			SessionRepository.findActiveByTokenHash('h1'),
		);
		assert.equal(query.where.tokenHash, 'h1');
		assert.equal(query.where.revokedAt, null);
		assert.ok(query.where.expiresAt.gt instanceof Date);
		assert.ok(query.where.expiresAt.gt.getTime() >= before);
		assert.ok(query.where.expiresAt.gt.getTime() <= Date.now());
	});

	test('[I] revokeByTokenHash only touches the unrevoked row for that hash', async () => {
		const { SessionRepository } = use('sessionRepo');
		const db = stubClient({ 'session.updateMany': async (query) => query });
		const query = await withClients({ prisma: db.client }, () =>
			SessionRepository.revokeByTokenHash('h1'),
		);
		assert.deepEqual(query.where, { tokenHash: 'h1', revokedAt: null });
		assert.ok(query.data.revokedAt instanceof Date);
	});
});

describe('Layer A - Login throttle (services/login-throttle.js)', () => {
	test('[S] key is a namespaced SHA-256 of the normalised email', () => {
		const { loginAttemptKey } = use('throttle');
		assert.equal(loginAttemptKey('a@b.cd'), `auth:login-attempts:${sha256('a@b.cd')}`);
	});

	test('[B] trimming and case do not change the key', () => {
		const { loginAttemptKey } = use('throttle');
		assert.equal(loginAttemptKey('  A@B.CD \n'), loginAttemptKey('a@b.cd'));
	});

	test('[I] key never contains the readable email', () => {
		const key = use('throttle').loginAttemptKey('secret.person@example.test');
		assert.equal(key.includes('secret'), false);
	});

	test('[M] different emails produce different keys', () => {
		const { loginAttemptKey } = use('throttle');
		assert.notEqual(loginAttemptKey('a@b.cd'), loginAttemptKey('b@b.cd'));
	});

	test('[Z] empty email hashes the empty string', () => {
		assert.equal(use('throttle').loginAttemptKey(''), `auth:login-attempts:${sha256('')}`);
	});

	test('[E] non-string email throws TypeError', () => {
		assert.throws(() => use('throttle').loginAttemptKey(undefined), TypeError);
	});

	test('[I] countLoginAttempt Lua: INCR, and EXPIRE only on the first attempt', () => {
		use('throttle');
		const script = luaScripts.get('countLoginAttempt');
		assert.ok(script, 'countLoginAttempt was not registered with defineCommand');
		assert.equal(script.numberOfKeys, 1);
		assert.match(script.lua, /redis\.call\('INCR', KEYS\[1\]\)/);
		assert.match(script.lua, /if count == 1 then\s+redis\.call\('EXPIRE', KEYS\[1\], ARGV\[1\]\)/);
	});

	for (const count of [1, 5]) {
		test(`[B] attempt ${count} of 5 is allowed`, async () => {
			const { checkLoginAttempt, loginAttemptKey } = use('throttle');
			const redis = stubClient({ countLoginAttempt: async () => count });
			await withClients({ redis: redis.client }, () => checkLoginAttempt('a@b.cd'));
			assert.deepEqual(redis.callsTo('countLoginAttempt')[0].args, [
				loginAttemptKey('a@b.cd'),
				60,
			]);
		});
	}

	for (const count of [6, 100]) {
		test(`[B] attempt ${count} is rejected with LOGIN_RATE_LIMITED`, async () => {
			const { checkLoginAttempt } = use('throttle');
			const redis = stubClient({ countLoginAttempt: async () => count });
			await withClients({ redis: redis.client }, () =>
				assert.rejects(checkLoginAttempt('a@b.cd'), { message: 'LOGIN_RATE_LIMITED' }),
			);
		});
	}

	test('[E] Redis failure propagates', async () => {
		const { checkLoginAttempt } = use('throttle');
		const redis = stubClient({
			countLoginAttempt: async () => {
				throw new Error('REDIS_DOWN');
			},
		});
		await withClients({ redis: redis.client }, () =>
			assert.rejects(checkLoginAttempt('a@b.cd'), { message: 'REDIS_DOWN' }),
		);
	});
});

describe('Layer A - AuthService input guards (no I/O)', () => {
	// Any database call means a guard let invalid input through.
	const noIo = () => ({ prisma: stubClient().client, redis: stubClient().client });

	for (const [label, input] of INVALID_USERNAMES) {
		test(`register ${label}: rejects with INVALID_USERNAME`, async () => {
			const { AuthService } = use('auth');
			await withClients(noIo(), () =>
				assert.rejects(
					AuthService.register({ username: input, email: 'a@b.cd', password: VALID_PASSWORD }),
					{ message: 'INVALID_USERNAME' },
				),
			);
		});
	}

	const invalidEmails = [
		['[Z] empty', ''],
		['[E] no @', 'plain'],
		['[E] no dot in domain', 'a@b'],
		['[E] empty local part', '@b.cd'],
		['[E] domain starts with dot', 'a@.cd'],
		['[E] ends with dot', 'a@b.'],
		['[E] inner space', 'a b@c.de'],
		['[E] two @', 'a@b@c.de'],
		['[E] number', 42],
		['[E] null', null],
		['[E] missing', undefined],
	];

	for (const [label, email] of invalidEmails) {
		test(`register ${label} email: rejects with INVALID_EMAIL`, async () => {
			const { AuthService } = use('auth');
			await withClients(noIo(), () =>
				assert.rejects(
					AuthService.register({ username: 'ValidName', email, password: VALID_PASSWORD }),
					{ message: 'INVALID_EMAIL' },
				),
			);
		});

		test(`login ${label} email: rejects with INVALID_EMAIL`, async () => {
			const { AuthService } = use('auth');
			await withClients(noIo(), () =>
				assert.rejects(AuthService.login({ email, password: VALID_PASSWORD }), {
					message: 'INVALID_EMAIL',
				}),
			);
		});
	}

	const invalidPasswords = [
		['[B] 11 chars', 'x'.repeat(11)],
		['[B] 129 chars', 'x'.repeat(129)],
		['[Z] empty', ''],
		['[E] number', 123456789012],
		['[E] missing', undefined],
	];

	for (const [label, password] of invalidPasswords) {
		test(`register ${label} password: rejects with INVALID_PASSWORD`, async () => {
			const { AuthService } = use('auth');
			await withClients(noIo(), () =>
				assert.rejects(
					AuthService.register({ username: 'ValidName', email: 'a@b.cd', password }),
					{ message: 'INVALID_PASSWORD' },
				),
			);
		});
	}

	test('[I] validation order: username, then email, then password', async () => {
		const { AuthService } = use('auth');
		await withClients(noIo(), async () => {
			await assert.rejects(AuthService.register({ username: '', email: '', password: '' }), {
				message: 'INVALID_USERNAME',
			});
			await assert.rejects(AuthService.register({ username: 'abc', email: '', password: '' }), {
				message: 'INVALID_EMAIL',
			});
		});
	});

	test('[I] register and updateProfile accept exactly the same usernames', async () => {
		const { AuthService } = use('auth');
		const { PlayerRepository } = use('playerRepo');
		const candidates = [...VALID_USERNAMES, ...INVALID_USERNAMES].map(([, input]) => input);
		const mismatches = [];

		for (const input of candidates) {
			const db = stubClient({ 'playerAccount.update': async () => ({}) });
			const registerAccepts = await withClients(noIo(), () =>
				AuthService.register({ username: input, email: '', password: '' }).catch(
					(error) => error.message !== 'INVALID_USERNAME',
				),
			);
			const profileAccepts = await withClients({ prisma: db.client }, () =>
				PlayerRepository.updateProfile('u1', { username: input }).then(
					() => true,
					() => false,
				),
			);
			if (registerAccepts !== profileAccepts) mismatches.push(input);
		}

		assert.deepEqual(mismatches, []);
	});

	for (const length of [12, 128]) {
		test(`[B] ${length}-char password passes validation and is stored hashed with normalised fields`, async () => {
			const { AuthService } = use('auth');
			const db = stubClient({
				'playerAccount.create': async () => {
					throw new Error('STOP_AFTER_VALIDATION');
				},
			});
			const password = 'p'.repeat(length);

			await withClients({ prisma: db.client }, () =>
				assert.rejects(
					AuthService.register({
						username: '  Trimmed1  ',
						email: '  User@Example.TEST ',
						password,
					}),
					{ message: 'STOP_AFTER_VALIDATION' },
				),
			);

			const { data } = db.callsTo('playerAccount.create')[0].args[0];
			assert.match(data.accountId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
			assert.equal(data.displayName, 'Trimmed1');
			assert.equal(data.email, 'user@example.test');
			assert.match(data.passwordHash, /^\$argon2id\$/);
			assert.equal(await use('password').verifyPassword(data.passwordHash, password), true);
		});
	}

	test('[E] login with a non-string password fails before the throttle is touched', async () => {
		const { AuthService } = use('auth');
		const redis = stubClient();
		await withClients({ prisma: stubClient().client, redis: redis.client }, () =>
			assert.rejects(AuthService.login({ email: 'a@b.cd', password: 42 }), {
				message: 'INVALID_CREDENTIALS',
			}),
		);
		assert.equal(redis.calls.length, 0);
	});

	const malformedTokens = [
		['[Z] undefined', undefined],
		['[Z] empty', ''],
		['[B] 42 chars', 'a'.repeat(42)],
		['[B] 44 chars', 'a'.repeat(44)],
		['[E] base64 "+" character', `${'a'.repeat(42)}+`],
		['[E] padding "="', `${'a'.repeat(42)}=`],
		['[E] number', 12345],
	];

	for (const [label, token] of malformedTokens) {
		test(`getAuthenticatedAccount ${label} token: null without a DB lookup`, async () => {
			const { AuthService } = use('auth');
			await withClients(noIo(), async () => {
				assert.equal(await AuthService.getAuthenticatedAccount(token), null);
			});
		});

		test(`logout ${label} token: no-op without a DB write`, async () => {
			const { AuthService } = use('auth');
			await withClients(noIo(), async () => {
				assert.equal(await AuthService.logout(token), undefined);
			});
		});
	}
});

describe('Layer A - AuthService branches (stubbed clients)', () => {
	const player = (overrides = {}) => ({
		accountId: 'acc-1',
		displayName: 'Tester',
		email: 'tester@example.test',
		avatarId: 'default',
		usernameChangedAt: null,
		passwordHash: 'stored-hash',
		createdAt: new Date(),
		updatedAt: new Date(),
		...overrides,
	});

	test('[E] login: sixth attempt is throttled before any account lookup', async () => {
		const { AuthService } = use('auth');
		const db = stubClient();
		const redis = stubClient({ countLoginAttempt: async () => 6 });
		await withClients({ prisma: db.client, redis: redis.client }, () =>
			assert.rejects(AuthService.login({ email: 'a@b.cd', password: 'x' }), {
				message: 'LOGIN_RATE_LIMITED',
			}),
		);
		assert.equal(db.calls.length, 0);
	});

	test('[I] login: throttle key uses the normalised email', async () => {
		const { AuthService } = use('auth');
		const { loginAttemptKey } = use('throttle');
		const redis = stubClient({ countLoginAttempt: async () => 1 });
		const db = stubClient({ 'playerAccount.findUnique': async () => null });
		await withClients({ prisma: db.client, redis: redis.client }, () =>
			assert.rejects(AuthService.login({ email: '  A@B.CD ', password: 'x' })),
		);
		assert.equal(redis.callsTo('countLoginAttempt')[0].args[0], loginAttemptKey('a@b.cd'));
		assert.deepEqual(db.callsTo('playerAccount.findUnique')[0].args[0], {
			where: { email: 'a@b.cd' },
		});
	});

	test('[E] login: unknown email -> INVALID_CREDENTIALS', async () => {
		const { AuthService } = use('auth');
		await withClients(
			{
				prisma: stubClient({ 'playerAccount.findUnique': async () => null }).client,
				redis: stubClient({ countLoginAttempt: async () => 1 }).client,
			},
			() =>
				assert.rejects(AuthService.login({ email: 'a@b.cd', password: 'x' }), {
					message: 'INVALID_CREDENTIALS',
				}),
		);
	});

	test('[E] login: wrong password -> same INVALID_CREDENTIALS as unknown email', async () => {
		const { AuthService } = use('auth');
		const passwordHash = await use('password').hashPassword(VALID_PASSWORD);
		await withClients(
			{
				prisma: stubClient({
					'playerAccount.findUnique': async () => player({ passwordHash }),
				}).client,
				redis: stubClient({ countLoginAttempt: async () => 1 }).client,
			},
			() =>
				assert.rejects(AuthService.login({ email: 'a@b.cd', password: 'wrong-password-123' }), {
					message: 'INVALID_CREDENTIALS',
				}),
		);
	});

	// A Prisma stub whose transaction client answers the FOR UPDATE lock
	// and the single-session lookup (`existing` is the account's current session row).
	function sessionDb(lockedRows, stored, existing = null) {
		const tx = stubClient({
			$queryRaw: async () => lockedRows,
			'session.findUnique': async () => existing,
			'session.upsert': async (query) => query,
		});
		const db = stubClient({
			'playerAccount.findUnique': async () => stored,
			$transaction: async (fn) => fn(tx.client),
		});
		return { db, tx };
	}

	test('[S] login: correct password starts a session and returns only public fields', async () => {
		const { AuthService } = use('auth');
		const { hashSessionToken, SESSION_TTL_SECONDS } = use('sessionToken');
		const passwordHash = await use('password').hashPassword(VALID_PASSWORD);
		const { db, tx } = sessionDb([{ accountId: 'acc-1' }], player({ passwordHash }));

		const before = Date.now();
		const result = await withClients(
			{ prisma: db.client, redis: stubClient({ countLoginAttempt: async () => 1 }).client },
			() => AuthService.login({ email: 'tester@example.test', password: VALID_PASSWORD }),
		);

		assert.deepEqual(result.account, {
			accountId: 'acc-1',
			username: 'Tester',
			email: 'tester@example.test',
			avatarId: 'default',
			usernameChangedAt: null,
		});
		assert.match(result.rawToken, RAW_TOKEN_PATTERN);

		const [lock] = tx.callsTo('$queryRaw');
		assert.match(lock.args[0].join('?'), /FOR UPDATE/);
		assert.equal(lock.args[1], 'acc-1');

		const upsert = tx.callsTo('session.upsert')[0].args[0];
		assert.equal(upsert.create.tokenHash, hashSessionToken(result.rawToken));
		assert.equal(upsert.create.playerAccountId, 'acc-1');
		assert.ok(upsert.create.expiresAt.getTime() >= before + SESSION_TTL_SECONDS * 1000);
	});

	test('[E] login: an active session -> ACCOUNT_ALREADY_LOGGED_IN, no session written', async () => {
		const { AuthService } = use('auth');
		const passwordHash = await use('password').hashPassword(VALID_PASSWORD);
		const active = { playerAccountId: 'acc-1', revokedAt: null, expiresAt: new Date(Date.now() + 60_000) };
		const { db, tx } = sessionDb([{ accountId: 'acc-1' }], player({ passwordHash }), active);

		await withClients(
			{ prisma: db.client, redis: stubClient({ countLoginAttempt: async () => 1 }).client },
			() =>
				assert.rejects(AuthService.login({ email: 'tester@example.test', password: VALID_PASSWORD }), {
					message: 'ACCOUNT_ALREADY_LOGGED_IN',
				}),
		);
		assert.equal(tx.callsTo('session.upsert').length, 0);
	});

	for (const [label, stale] of [
		['revoked', { revokedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) }],
		['expired', { revokedAt: null, expiresAt: new Date(Date.now() - 1000) }],
	]) {
		test(`[B] login: a ${label} previous session is replaced`, async () => {
			const { AuthService } = use('auth');
			const passwordHash = await use('password').hashPassword(VALID_PASSWORD);
			const { db, tx } = sessionDb([{ accountId: 'acc-1' }], player({ passwordHash }), {
				playerAccountId: 'acc-1',
				...stale,
			});
			await withClients(
				{ prisma: db.client, redis: stubClient({ countLoginAttempt: async () => 1 }).client },
				() => AuthService.login({ email: 'tester@example.test', password: VALID_PASSWORD }),
			);
			assert.equal(tx.callsTo('session.upsert').length, 1);
		});
	}

	test('[E] login: account deleted between lookup and lock -> ACCOUNT_NOT_FOUND, no session written', async () => {
		const { AuthService } = use('auth');
		const passwordHash = await use('password').hashPassword(VALID_PASSWORD);
		const { db, tx } = sessionDb([], player({ passwordHash }));

		await withClients(
			{ prisma: db.client, redis: stubClient({ countLoginAttempt: async () => 1 }).client },
			() =>
				assert.rejects(AuthService.login({ email: 'tester@example.test', password: VALID_PASSWORD }), {
					message: 'ACCOUNT_NOT_FOUND',
				}),
		);
		assert.equal(tx.callsTo('session.upsert').length, 0);
	});

	test('[E] getAuthenticatedAccount: no active session -> null', async () => {
		const { AuthService } = use('auth');
		const { createRawSessionToken, hashSessionToken } = use('sessionToken');
		const raw = createRawSessionToken();
		const db = stubClient({ 'session.findFirst': async () => null });

		await withClients({ prisma: db.client }, async () => {
			assert.equal(await AuthService.getAuthenticatedAccount(raw), null);
		});
		assert.equal(db.callsTo('session.findFirst')[0].args[0].where.tokenHash, hashSessionToken(raw));
	});

	test('[E] getAuthenticatedAccount: session whose player is gone -> null', async () => {
		const { AuthService } = use('auth');
		const db = stubClient({
			'session.findFirst': async () => ({ playerAccountId: 'acc-1' }),
			'playerAccount.findUnique': async () => null,
		});
		await withClients({ prisma: db.client }, async () => {
			assert.equal(
				await AuthService.getAuthenticatedAccount(use('sessionToken').createRawSessionToken()),
				null,
			);
		});
	});

	test('[I] getAuthenticatedAccount: returns public fields only', async () => {
		const { AuthService } = use('auth');
		const db = stubClient({
			'session.findFirst': async () => ({ playerAccountId: 'acc-1' }),
			'playerAccount.findUnique': async () =>
				player({ avatarId: 'red_car', usernameChangedAt: new Date('2026-01-02T03:04:05.000Z') }),
		});
		const account = await withClients({ prisma: db.client }, () =>
			AuthService.getAuthenticatedAccount(use('sessionToken').createRawSessionToken()),
		);
		assert.deepEqual(account, {
			accountId: 'acc-1',
			username: 'Tester',
			email: 'tester@example.test',
			avatarId: 'red_car',
			usernameChangedAt: '2026-01-02T03:04:05.000Z',
		});
	});

	test('[S] logout revokes exactly the presented token hash', async () => {
		const { AuthService } = use('auth');
		const { createRawSessionToken, hashSessionToken } = use('sessionToken');
		const raw = createRawSessionToken();
		const db = stubClient({ 'session.updateMany': async () => ({ count: 1 }) });
		await withClients({ prisma: db.client }, () => AuthService.logout(raw));
		assert.equal(db.callsTo('session.updateMany')[0].args[0].where.tokenHash, hashSessionToken(raw));
	});

	test('[E] logout surfaces database failures instead of swallowing them', async () => {
		const { AuthService } = use('auth');
		const db = stubClient({
			'session.updateMany': async () => {
				throw new Error('DB_DOWN');
			},
		});
		await withClients({ prisma: db.client }, () =>
			assert.rejects(AuthService.logout(use('sessionToken').createRawSessionToken()), {
				message: 'DB_DOWN',
			}),
		);
	});
});

describe('Layer A - CacheRepository branches (stubbed Redis)', () => {
	test('[S] createRoom queues room hash, sets, status and four expiries in one pipeline', async () => {
		const { CacheRepository } = use('cacheRepo');
		const pipe = pipelineStub();
		const redis = stubClient({ pipeline: () => pipe.pipeline });
		const before = Date.now();

		const result = await withClients({ redis: redis.client }, () =>
			CacheRepository.createRoom('m1', { hostId: 'host', serverAddress: '10.0.0.1:4000' }),
		);

		assert.deepEqual(result, {
			matchId: 'm1',
			maxCapacity: 6,
			isPasswordProtected: false,
			duration: 7200,
		});
		assert.equal(pipe.execCount(), 1);

		const [hset, ...rest] = pipe.ops;
		assert.equal(hset[0], 'hset');
		assert.equal(hset[1], wire.room('m1'));
		const { startedAt, ...fields } = hset[2];
		assert.deepEqual(fields, {
			matchId: 'm1',
			name: 'm1',
			hostId: 'host',
			serverAddress: '10.0.0.1:4000',
			playerCount: 1,
			maxCapacity: 6,
			passwordHash: '',
		});
		assert.ok(startedAt >= before && startedAt <= Date.now());

		assert.deepEqual(rest, [
			['sadd', wire.active, 'm1'],
			['sadd', wire.players('m1'), 'host'],
			['set', wire.status('host'), 'm1', 'EX', 7200],
			['expire', wire.room('m1'), 7200],
			['expire', wire.players('m1'), 7200],
			['expire', wire.spectators('m1'), 7200],
			['expire', wire.slots('m1'), 7200],
		]);
	});

	test('[B] createRoom honours custom maxCapacity and duration', async () => {
		const { CacheRepository } = use('cacheRepo');
		const pipe = pipelineStub();
		const result = await withClients({ redis: stubClient({ pipeline: () => pipe.pipeline }).client }, () =>
			CacheRepository.createRoom('m1', { hostId: 'h', serverAddress: 'x', maxCapacity: 2, duration: 1 }),
		);
		assert.equal(result.maxCapacity, 2);
		assert.equal(result.duration, 1);
		assert.equal(pipe.ops[0][2].maxCapacity, 2);
		assert.deepEqual(
			pipe.ops.filter(([op]) => op === 'expire').map(([, , ttl]) => ttl),
			[1, 1, 1, 1],
		);
	});

	test('[I] createRoom stores an argon2 hash, never the plaintext password', async () => {
		const { CacheRepository } = use('cacheRepo');
		const { default: argon2 } = await import('argon2');
		const pipe = pipelineStub();
		const result = await withClients({ redis: stubClient({ pipeline: () => pipe.pipeline }).client }, () =>
			CacheRepository.createRoom('m1', { hostId: 'h', serverAddress: 'x', password: 'room-secret' }),
		);
		const stored = pipe.ops[0][2].passwordHash;
		assert.equal(result.isPasswordProtected, true);
		assert.match(stored, /^\$argon2id\$/);
		assert.equal(await argon2.verify(stored, 'room-secret'), true);
	});

	test('[B] createRoom with an empty-string password creates an open room', async () => {
		const { CacheRepository } = use('cacheRepo');
		const pipe = pipelineStub();
		const result = await withClients({ redis: stubClient({ pipeline: () => pipe.pipeline }).client }, () =>
			CacheRepository.createRoom('m1', { hostId: 'h', serverAddress: 'x', password: '' }),
		);
		assert.equal(result.isPasswordProtected, false);
		assert.equal(pipe.ops[0][2].passwordHash, '');
	});

	test('[E] createRoom without an options object rejects with TypeError', async () => {
		const { CacheRepository } = use('cacheRepo');
		await withClients({ redis: stubClient().client }, () =>
			assert.rejects(CacheRepository.createRoom('m1'), TypeError),
		);
	});

	test('[I] createEmptyRoom stores matchId so join methods can find the room', async () => {
		// joinPlayerToRoom and joinPlayerToRoomPassword both treat a room
		// hash without matchId as missing, and createEmptyRoom's own comment
		// says to "use joinPlayerToRoom to add a player".
		const { CacheRepository } = use('cacheRepo');
		const pipe = pipelineStub();
		const result = await withClients({ redis: stubClient({ pipeline: () => pipe.pipeline }).client }, () =>
			CacheRepository.createEmptyRoom('m1', { serverAddress: 'x' }),
		);
		assert.deepEqual(result, { matchId: 'm1', serverAddress: 'x' });
		const [, key, fields] = pipe.ops[0];
		assert.equal(key, wire.room('m1'));
		assert.equal(fields.playerCount, 0);
		assert.equal(fields.maxCapacity, 6);
		assert.equal(pipe.ops.length, 2, 'an empty room has no name, so it is not listed in rooms:active');
		assert.equal(fields.matchId, 'm1');
		assert.deepEqual(pipe.ops[1], ['expire', wire.room('m1'), 7200]);
	});

	test('[Z] getRoom returns null for an empty hash', async () => {
		const { CacheRepository } = use('cacheRepo');
		const redis = stubClient({ hgetall: async () => ({}) });
		await withClients({ redis: redis.client }, async () => {
			assert.equal(await CacheRepository.getRoom('m1'), null);
		});
		assert.deepEqual(redis.calls[0].args, [wire.room('m1')]);
	});

	test('[O] getRoom / getRoomPlayers / getPlayerStatus / getLiveDrivers read the right keys', async () => {
		const { CacheRepository } = use('cacheRepo');
		const redis = stubClient({
			hgetall: async (key) => ({ key }),
			smembers: async (key) => [key],
			get: async (key) => key,
		});
		await withClients({ redis: redis.client }, async () => {
			assert.deepEqual(await CacheRepository.getRoom('m1'), { key: wire.room('m1') });
			assert.deepEqual(await CacheRepository.getRoomPlayers('m1'), [wire.players('m1')]);
			assert.equal(await CacheRepository.getPlayerStatus('a1'), wire.status('a1'));
			assert.deepEqual(await CacheRepository.getLiveDrivers('m1'), { key: wire.slots('m1') });
		});
	});

	for (const roomData of [{}, { serverAddress: 'x', playerCount: '0' }]) {
		test(`[E] joinPlayerToRoom: ${JSON.stringify(roomData)} -> ROOM_NOT_FOUND result, Lua not run`, async () => {
			const { CacheRepository } = use('cacheRepo');
			const redis = stubClient({ hgetall: async () => roomData });
			const result = await withClients({ redis: redis.client }, () =>
				CacheRepository.joinPlayerToRoom('m1', 'a1'),
			);
			assert.deepEqual(result, { success: false, status: 'ROOM_NOT_FOUND' });
			assert.equal(redis.callsTo('joinPlayerAtomic').length, 0);
		});
	}

	test('[I] joinPlayerToRoom passes keys and ids (no capacity) to the Lua command', async () => {
		const { CacheRepository } = use('cacheRepo');
		const redis = stubClient({
			hgetall: async () => ({ matchId: 'm1', maxCapacity: '4' }),
			joinPlayerAtomic: async () => [1, 'SUCCESS'],
		});
		const status = await withClients({ redis: redis.client }, () =>
			CacheRepository.joinPlayerToRoom('m1', 'a1'),
		);
		assert.equal(status, 'SUCCESS');
		assert.deepEqual(redis.callsTo('joinPlayerAtomic')[0].args, [
			wire.room('m1'),
			wire.players('m1'),
			wire.status('a1'),
			'm1',
			'a1',
		]);
	});

	test('[E] joinPlayerToRoom: Lua ALREADY_IN_ROOM -> throws "Failed to join room: ALREADY_IN_ROOM"', async () => {
		const { CacheRepository } = use('cacheRepo');
		const redis = stubClient({
			hgetall: async () => ({ matchId: 'm1', maxCapacity: '2' }),
			joinPlayerAtomic: async () => [0, 'ALREADY_IN_ROOM'],
		});
		await withClients({ redis: redis.client }, () =>
			assert.rejects(CacheRepository.joinPlayerToRoom('m1', 'a1'), {
				message: 'Failed to join room: ALREADY_IN_ROOM',
			}),
		);
	});

	test('[E] joinPlayerToRoom: room expired before the Lua ran -> ROOM_NOT_FOUND result, no throw', async () => {
		const { CacheRepository } = use('cacheRepo');
		const redis = stubClient({
			hgetall: async () => ({ matchId: 'm1' }),
			joinPlayerAtomic: async () => [0, 'ROOM_NOT_FOUND'],
		});
		const result = await withClients({ redis: redis.client }, () =>
			CacheRepository.joinPlayerToRoom('m1', 'a1'),
		);
		assert.deepEqual(result, { success: false, status: 'ROOM_NOT_FOUND' });
	});

	describe('joinPlayerToRoomPassword', () => {
		let protectedHash;
		const hashRoomSecret = async () =>
			(await import('argon2')).default.hash('room-secret', {
				memoryCost: 19456,
				timeCost: 1,
				parallelism: 1,
			});

		const room = (passwordHash) => ({ matchId: 'm1', maxCapacity: '6', passwordHash });

		async function attempt(roomData, password, lua = [1, 'SUCCESS']) {
			const { CacheRepository } = use('cacheRepo');
			const redis = stubClient({
				hgetall: async () => roomData,
				joinPlayerAtomic: async () => lua,
			});
			const result = await withClients({ redis: redis.client }, () =>
				CacheRepository.joinPlayerToRoomPassword({ matchId: 'm1', accountId: 'a1', password }),
			);
			return { result, joined: redis.callsTo('joinPlayerAtomic').length === 1 };
		}

		test('[E] missing room -> ROOM_NOT_FOUND', async () => {
			const { result, joined } = await attempt({}, 'x');
			assert.deepEqual(result, { success: false, status: 'ROOM_NOT_FOUND' });
			assert.equal(joined, false);
		});

		for (const password of [undefined, '']) {
			test(`[Z] protected room, password ${JSON.stringify(password)} -> PASSWORD_REQUIRED`, async () => {
				protectedHash ??= await hashRoomSecret();
				const { result, joined } = await attempt(room(protectedHash), password);
				assert.deepEqual(result, { success: false, status: 'PASSWORD_REQUIRED' });
				assert.equal(joined, false);
			});
		}

		test('[E] protected room, wrong password -> INVALID_PASSWORD', async () => {
			protectedHash ??= await hashRoomSecret();
			const { result, joined } = await attempt(room(protectedHash), 'room-secreT');
			assert.deepEqual(result, { success: false, status: 'INVALID_PASSWORD' });
			assert.equal(joined, false);
		});

		test('[S] protected room, correct password -> SUCCESS', async () => {
			protectedHash ??= await hashRoomSecret();
			const { result, joined } = await attempt(room(protectedHash), 'room-secret');
			assert.equal(result, 'SUCCESS');
			assert.equal(joined, true);
		});

		for (const password of [undefined, 'anything']) {
			test(`[O] open room ignores password ${JSON.stringify(password)}`, async () => {
				const { result } = await attempt(room(''), password);
				assert.equal(result, 'SUCCESS');
			});
		}

		test('[E] room expired before the Lua ran -> ROOM_NOT_FOUND result', async () => {
			const { result } = await attempt(room(''), undefined, [0, 'ROOM_NOT_FOUND']);
			assert.deepEqual(result, { success: false, status: 'ROOM_NOT_FOUND' });
		});

		test('[I] the Lua command gets keys and ids only (no capacity argument)', async () => {
			const { CacheRepository } = use('cacheRepo');
			const redis = stubClient({
				hgetall: async () => room(''),
				joinPlayerAtomic: async () => [1, 'SUCCESS'],
			});
			await withClients({ redis: redis.client }, () =>
				CacheRepository.joinPlayerToRoomPassword({ matchId: 'm1', accountId: 'a1' }),
			);
			assert.deepEqual(redis.callsTo('joinPlayerAtomic')[0].args, [
				wire.room('m1'), wire.players('m1'), wire.status('a1'), 'm1', 'a1',
			]);
		});
	});

	test('[E] leavePlayerFromRoom: Lua reports non-member -> false', async () => {
		const { CacheRepository } = use('cacheRepo');
		const redis = stubClient({ leavePlayerAtomic: async () => 0 });
		await withClients({ redis: redis.client }, async () => {
			assert.equal(await CacheRepository.leavePlayerFromRoom('m1', 'a1'), false);
		});
	});

	test('[S] leavePlayerFromRoom passes keys and the stringified id to the Lua command', async () => {
		const { CacheRepository } = use('cacheRepo');
		const redis = stubClient({ leavePlayerAtomic: async () => 1 });
		await withClients({ redis: redis.client }, async () => {
			assert.equal(await CacheRepository.leavePlayerFromRoom('m1', 42), true);
		});
		assert.deepEqual(redis.callsTo('leavePlayerAtomic')[0].args, [
			wire.room('m1'), wire.players('m1'), wire.status(42), '42',
		]);
	});

	test('[E] refreshRoom: missing room -> throws ROOM_NOT_FOUND', async () => {
		const { CacheRepository } = use('cacheRepo');
		const redis = stubClient({ exists: async () => 0 });
		await withClients({ redis: redis.client }, () =>
			assert.rejects(CacheRepository.refreshRoom('m1', 60), { message: 'ROOM_NOT_FOUND' }),
		);
	});

	test('[S] refreshRoom extends all four room keys and the members\' status keys', async () => {
		const { CacheRepository } = use('cacheRepo');
		const pipe = pipelineStub();
		const redis = stubClient({
			exists: async () => 1,
			smembers: async () => ['host', 'guest'],
			pipeline: () => pipe.pipeline,
		});
		const result = await withClients({ redis: redis.client }, () =>
			CacheRepository.refreshRoom('m1', 900),
		);
		assert.deepEqual(result, { matchId: 'm1', refreshed: true, duration: 900 });
		assert.deepEqual(pipe.ops, [
			['expire', wire.room('m1'), 900],
			['expire', wire.players('m1'), 900],
			['expire', wire.spectators('m1'), 900],
			['expire', wire.slots('m1'), 900],
			['expire', wire.status('host'), 900],
			['expire', wire.status('guest'), 900],
		]);
	});

	const badTtls = [0, -1, 1.5, '60', NaN, Infinity, undefined, null];
	for (const ttl of badTtls) {
		test(`[B] saveAuthSession rejects TTL ${String(ttl)} with INVALID_SESSION_TTL`, async () => {
			const { CacheRepository } = use('cacheRepo');
			const redis = stubClient();
			await withClients({ redis: redis.client }, () =>
				assert.rejects(CacheRepository.saveAuthSession('h', 'a1', ttl), {
					message: 'INVALID_SESSION_TTL',
				}),
			);
			assert.equal(redis.calls.length, 0);
		});
	}

	test('[I] saveAuthSession / getAuthSessionAccountId / deleteAuthSession use session:<hash>', async () => {
		const { CacheRepository } = use('cacheRepo');
		const redis = stubClient({ set: async () => 'OK', get: async () => 'a1', del: async () => 1 });
		await withClients({ redis: redis.client }, async () => {
			assert.equal(await CacheRepository.saveAuthSession('h', 'a1', 1), 'OK');
			assert.equal(await CacheRepository.getAuthSessionAccountId('h'), 'a1');
			assert.equal(await CacheRepository.deleteAuthSession('h'), 1);
		});
		assert.deepEqual(redis.callsTo('set')[0].args, [wire.session('h'), 'a1', 'EX', 1]);
		assert.deepEqual(redis.callsTo('get')[0].args, [wire.session('h')]);
		assert.deepEqual(redis.callsTo('del')[0].args, [wire.session('h')]);
	});
});

describe('Layer A - DatabaseLifecycle branches (stubbed clients)', () => {
	const signals = ['SIGINT', 'SIGTERM'];

	// Silence lifecycle logging, stop process.exit, and remove any signal
	// listeners the test adds.
	function sandbox(t) {
		t.mock.method(console, 'log', () => {});
		t.mock.method(console, 'error', () => {});
		const exit = t.mock.method(process, 'exit', () => {});
		const before = Object.fromEntries(signals.map((s) => [s, process.rawListeners(s)]));
		const added = (signal) =>
			process.rawListeners(signal).filter((listener) => !before[signal].includes(listener));
		t.after(() => {
			for (const signal of signals) {
				for (const listener of added(signal)) process.removeListener(signal, listener);
			}
		});
		return { exit, added };
	}

	const healthyClients = (overrides = {}) => ({
		prisma: stubClient({
			$connect: async () => {},
			$queryRaw: async () => [{ '?column?': 1 }],
			$disconnect: async () => {},
			...overrides.prisma,
		}),
		redis: stubClient({
			ping: async () => 'PONG',
			quit: async () => 'OK',
			...overrides.redis,
		}),
	});

	test('[S] init connects Postgres, runs SELECT 1, pings Redis, and registers no signal hooks (server.js owns them)', async (t) => {
		const { DatabaseLifecycle } = use('lifecycle');
		const { added } = sandbox(t);
		const { prisma, redis } = healthyClients();

		await withClients({ prisma: prisma.client, redis: redis.client }, () => DatabaseLifecycle.init());

		assert.deepEqual(prisma.calls.map((c) => c.path), ['$connect', '$queryRaw']);
		assert.match(prisma.callsTo('$queryRaw')[0].args[0].join(''), /SELECT\s+1/);
		assert.equal(redis.callsTo('ping').length, 1);
		for (const signal of signals) {
			assert.equal(added(signal).length, 0, `${signal} hook count`);
		}
	});

	test('[E] init: Redis PING answering anything but PONG throws, no hooks registered', async (t) => {
		const { DatabaseLifecycle } = use('lifecycle');
		const { added } = sandbox(t);
		const { prisma, redis } = healthyClients({ redis: { ping: async () => 'LOADING' } });

		await withClients({ prisma: prisma.client, redis: redis.client }, () =>
			assert.rejects(DatabaseLifecycle.init(), { message: 'Redis ping failed' }),
		);
		assert.equal(added('SIGINT').length + added('SIGTERM').length, 0);
	});

	test('[E] init: Postgres connect failure propagates before Redis is touched', async (t) => {
		const { DatabaseLifecycle } = use('lifecycle');
		sandbox(t);
		const { prisma, redis } = healthyClients({
			prisma: {
				$connect: async () => {
					throw new Error('PG_REFUSED');
				},
			},
		});

		await withClients({ prisma: prisma.client, redis: redis.client }, () =>
			assert.rejects(DatabaseLifecycle.init(), { message: 'PG_REFUSED' }),
		);
		assert.equal(redis.calls.length, 0);
	});

	test('[E] init: SELECT 1 failure propagates', async (t) => {
		const { DatabaseLifecycle } = use('lifecycle');
		sandbox(t);
		const { prisma, redis } = healthyClients({
			prisma: {
				$queryRaw: async () => {
					throw new Error('PG_QUERY_FAILED');
				},
			},
		});
		await withClients({ prisma: prisma.client, redis: redis.client }, () =>
			assert.rejects(DatabaseLifecycle.init(), { message: 'PG_QUERY_FAILED' }),
		);
	});

	test('[I] checkHealth: both up -> exactly { postgres: UP, redis: UP }', async () => {
		const { DatabaseLifecycle } = use('lifecycle');
		const { prisma, redis } = healthyClients();
		const health = await withClients({ prisma: prisma.client, redis: redis.client }, () =>
			DatabaseLifecycle.checkHealth(),
		);
		assert.deepEqual(health, { postgres: 'UP', redis: 'UP' });
	});

	test('[B] checkHealth: Redis PING not PONG -> redis DOWN', async () => {
		const { DatabaseLifecycle } = use('lifecycle');
		const { prisma, redis } = healthyClients({ redis: { ping: async () => 'LOADING' } });
		const health = await withClients({ prisma: prisma.client, redis: redis.client }, () =>
			DatabaseLifecycle.checkHealth(),
		);
		assert.deepEqual(health, { postgres: 'UP', redis: 'DOWN' });
	});

	test('[E] checkHealth: Postgres failure -> DOWN/UNKNOWN with the error, never throws', async () => {
		const { DatabaseLifecycle } = use('lifecycle');
		const { prisma, redis } = healthyClients({
			prisma: {
				$queryRaw: async () => {
					throw new Error('PG_GONE');
				},
			},
		});
		const health = await withClients({ prisma: prisma.client, redis: redis.client }, () =>
			DatabaseLifecycle.checkHealth(),
		);
		assert.deepEqual(health, { postgres: 'DOWN', redis: 'UNKNOWN', error: 'PG_GONE' });
		assert.equal(redis.calls.length, 0);
	});

	test('[E] checkHealth: a Redis failure is not reported as a PostgreSQL outage', async () => {
		const { DatabaseLifecycle } = use('lifecycle');
		const { prisma, redis } = healthyClients({
			redis: {
				ping: async () => {
					throw new Error('REDIS_GONE');
				},
			},
		});
		const health = await withClients({ prisma: prisma.client, redis: redis.client }, () =>
			DatabaseLifecycle.checkHealth(),
		);
		assert.equal(health.postgres, 'UP', `Postgres answered SELECT 1 but health was ${JSON.stringify(health)}`);
		assert.equal(health.redis, 'DOWN');
	});

	test('[S] shutdown disconnects both clients without exiting', async (t) => {
		const { DatabaseLifecycle } = use('lifecycle');
		const { exit } = sandbox(t);
		const { prisma, redis } = healthyClients();
		await withClients({ prisma: prisma.client, redis: redis.client }, () =>
			DatabaseLifecycle.shutdown('TEST'),
		);
		assert.equal(prisma.callsTo('$disconnect').length, 1);
		assert.equal(redis.callsTo('quit').length, 1);
		assert.equal(exit.mock.callCount(), 0);
	});

	test('[E] shutdown: a failing Redis quit rejects, Postgres is still disconnected, no exit', async (t) => {
		const { DatabaseLifecycle } = use('lifecycle');
		const { exit } = sandbox(t);
		const { prisma, redis } = healthyClients({
			redis: {
				quit: async () => {
					throw new Error('QUIT_FAILED');
				},
			},
		});
		await withClients({ prisma: prisma.client, redis: redis.client }, () =>
			assert.rejects(DatabaseLifecycle.shutdown('TEST'), { message: 'QUIT_FAILED' }),
		);
		assert.equal(prisma.callsTo('$disconnect').length, 1);
		assert.equal(exit.mock.callCount(), 0);
	});

	test('[E] shutdown: a failing Postgres disconnect still quits Redis', async (t) => {
		const { DatabaseLifecycle } = use('lifecycle');
		sandbox(t);
		const { prisma, redis } = healthyClients({
			prisma: {
				$disconnect: async () => {
					throw new Error('PG_DISCONNECT_FAILED');
				},
			},
		});
		await withClients({ prisma: prisma.client, redis: redis.client }, () =>
			assert.rejects(DatabaseLifecycle.shutdown('TEST'), { message: 'PG_DISCONNECT_FAILED' }),
		);
		assert.equal(redis.callsTo('quit').length, 1);
	});

	test('[I] the old self-exiting registerShutdownHooks is gone', () => {
		assert.equal(use('lifecycle').DatabaseLifecycle.registerShutdownHooks, undefined);
	});
});

// ===========================================================================
// Layer A/C - Fastify routes via inject() (fake AuthService, no network)
// ===========================================================================

const AUTH_HEADERS = { 'x-auth-request': '1' };

function fakeAuthService(overrides = {}) {
	const calls = [];
	const account = {
		accountId: 'acc-1',
		username: 'Tester',
		email: 'tester@example.test',
		avatarId: 'default',
		usernameChangedAt: null,
	};
	const recorded = (name, fallback) => async (...args) => {
		calls.push({ name, args });
		return (overrides[name] ?? fallback)(...args);
	};

	return {
		account,
		calls,
		callsTo: (name) => calls.filter((call) => call.name === name),
		service: {
			register: recorded('register', async () => ({ account, rawToken: 'raw-register-token' })),
			login: recorded('login', async () => ({ account, rawToken: 'raw-login-token' })),
			getAuthenticatedAccount: recorded('getAuthenticatedAccount', async (token) =>
				token === 'valid-token' ? account : null,
			),
			logout: recorded('logout', async () => {}),
		},
	};
}

async function withApp(authService, fn) {
	const { buildApp } = use('app');
	const app = buildApp(authService ? { authService } : undefined);
	try {
		await app.ready();
		return await fn(app);
	} finally {
		await app.close();
	}
}

const setCookies = (response) => [].concat(response.headers['set-cookie'] ?? []);

function assertSessionCookie(response, token) {
	const cookies = setCookies(response);
	assert.equal(cookies.length, 1);
	const [cookie] = cookies;
	assert.ok(cookie.startsWith(`session=${token};`), cookie);
	assert.match(cookie, /; Path=\//);
	assert.match(cookie, /; HttpOnly/);
	assert.match(cookie, /; Secure/);
	assert.match(cookie, /; SameSite=Strict/);
}

function assertClearedCookie(response) {
	const cookies = setCookies(response);
	assert.equal(cookies.length, 1);
	assert.match(cookies[0], /^session=;/);
	assert.match(cookies[0], /Path=\//);
	assert.match(cookies[0], /Max-Age=0|Expires=Thu, 01 Jan 1970/);
}

const REGISTER_BODY = { username: 'Tester', email: 'tester@example.test', password: VALID_PASSWORD };
const LOGIN_BODY = { email: 'tester@example.test', password: VALID_PASSWORD };

describe('Layer C - Fastify routes (app.js, routes/auth.routes.js)', () => {
	describe('GET /api/health/ready', () => {
		async function ready(health) {
			const { buildApp } = use('app');
			const app = buildApp({
				authService: fakeAuthService().service,
				lifecycle: { checkHealth: async () => health },
			});
			try {
				return await app.inject({ method: 'GET', url: '/api/health/ready' });
			} finally {
				await app.close();
			}
		}

		test('[S] both databases UP -> 200 ready', async () => {
			const response = await ready({ postgres: 'UP', redis: 'UP' });
			assert.equal(response.statusCode, 200);
			assert.deepEqual(response.json(), { status: 'ready', postgres: 'UP', redis: 'UP' });
		});

		test('[E] Redis DOWN -> 503 and the error text is not exposed', async () => {
			const response = await ready({ postgres: 'UP', redis: 'DOWN', error: 'secret internal detail' });
			assert.equal(response.statusCode, 503);
			assert.deepEqual(response.json(), { status: 'unavailable', postgres: 'UP', redis: 'DOWN' });
		});

		test('[E] Postgres DOWN -> 503', async () => {
			const response = await ready({ postgres: 'DOWN', redis: 'UNKNOWN', error: 'PG_GONE' });
			assert.equal(response.statusCode, 503);
			assert.equal(response.json().postgres, 'DOWN');
		});
	});

	test('[S] GET /api/health -> 200 { status: ok }', async () => {
		await withApp(fakeAuthService().service, async (app) => {
			const response = await app.inject({ method: 'GET', url: '/api/health' });
			assert.equal(response.statusCode, 200);
			assert.match(response.headers['content-type'], /application\/json/);
			assert.deepEqual(response.json(), { status: 'ok' });
		});
	});

	test('[Z] unknown route -> 404', async () => {
		await withApp(fakeAuthService().service, async (app) => {
			const response = await app.inject({ method: 'GET', url: '/api/nope' });
			assert.equal(response.statusCode, 404);
		});
	});

	describe('CSRF header hook', () => {
		const posts = ['/api/auth/register', '/api/auth/login', '/api/auth/logout'];

		for (const url of posts) {
			test(`[E] POST ${url} without x-auth-request -> 403, service not called`, async () => {
				const fake = fakeAuthService();
				await withApp(fake.service, async (app) => {
					const response = await app.inject({ method: 'POST', url, payload: REGISTER_BODY });
					assert.equal(response.statusCode, 403);
					assert.deepEqual(response.json(), { error: 'Forbidden request' });
				});
				assert.equal(fake.calls.length, 0);
			});
		}

		for (const value of ['0', 'true', '2']) {
			test(`[B] x-auth-request: ${value} -> 403 (only "1" is accepted)`, async () => {
				await withApp(fakeAuthService().service, async (app) => {
					const response = await app.inject({
						method: 'POST',
						url: '/api/auth/login',
						headers: { 'x-auth-request': value },
						payload: LOGIN_BODY,
					});
					assert.equal(response.statusCode, 403);
				});
			});
		}

		test('[I] header check runs before body validation', async () => {
			await withApp(fakeAuthService().service, async (app) => {
				const response = await app.inject({ method: 'POST', url: '/api/auth/register', payload: {} });
				assert.equal(response.statusCode, 403);
			});
		});

		test('[I] GET /api/auth/me is not subject to the header check', async () => {
			await withApp(fakeAuthService().service, async (app) => {
				const response = await app.inject({ method: 'GET', url: '/api/auth/me' });
				assert.equal(response.statusCode, 401);
			});
		});

		test('[I] the hook is scoped to the auth plugin', async () => {
			await withApp(fakeAuthService().service, async (app) => {
				const response = await app.inject({ method: 'POST', url: '/api/health' });
				assert.equal(response.statusCode, 404);
			});
		});
	});

	describe('POST /api/auth/register', () => {
		test('[S] 201, public account in body, raw token only in a hardened cookie', async () => {
			const fake = fakeAuthService();
			await withApp(fake.service, async (app) => {
				const response = await app.inject({
					method: 'POST',
					url: '/api/auth/register',
					headers: AUTH_HEADERS,
					payload: REGISTER_BODY,
				});
				assert.equal(response.statusCode, 201);
				assert.deepEqual(response.json(), { account: fake.account });
				assert.equal(response.body.includes('raw-register-token'), false);
				assertSessionCookie(response, 'raw-register-token');
			});
			assert.deepEqual(fake.callsTo('register')[0].args, [REGISTER_BODY]);
		});

		for (const field of Object.keys(REGISTER_BODY)) {
			test(`[E] missing ${field} -> 400, service not called`, async () => {
				const fake = fakeAuthService();
				const { [field]: _omitted, ...payload } = REGISTER_BODY;
				await withApp(fake.service, async (app) => {
					const response = await app.inject({
						method: 'POST',
						url: '/api/auth/register',
						headers: AUTH_HEADERS,
						payload,
					});
					assert.equal(response.statusCode, 400);
				});
				assert.equal(fake.calls.length, 0);
			});
		}

		test('[E] non-string field -> 400', async () => {
			const fake = fakeAuthService();
			await withApp(fake.service, async (app) => {
				const response = await app.inject({
					method: 'POST',
					url: '/api/auth/register',
					headers: AUTH_HEADERS,
					payload: { ...REGISTER_BODY, username: { nested: true } },
				});
				assert.equal(response.statusCode, 400);
			});
			assert.equal(fake.calls.length, 0);
		});

		test('[I] undeclared body properties never reach the service', async () => {
			const fake = fakeAuthService();
			await withApp(fake.service, async (app) => {
				const response = await app.inject({
					method: 'POST',
					url: '/api/auth/register',
					headers: AUTH_HEADERS,
					payload: { ...REGISTER_BODY, isAdmin: true },
				});
				// Fastify's default Ajv options strip properties the schema forbids.
				assert.equal(response.statusCode, 201);
				assert.deepEqual(fake.callsTo('register')[0].args[0], REGISTER_BODY);
			});
		});

		test('[Z] no body -> 400', async () => {
			await withApp(fakeAuthService().service, async (app) => {
				const response = await app.inject({
					method: 'POST',
					url: '/api/auth/register',
					headers: AUTH_HEADERS,
				});
				assert.equal(response.statusCode, 400);
			});
		});

		test('[E] malformed JSON -> 400', async () => {
			await withApp(fakeAuthService().service, async (app) => {
				const response = await app.inject({
					method: 'POST',
					url: '/api/auth/register',
					headers: { ...AUTH_HEADERS, 'content-type': 'application/json' },
					payload: '{"username":',
				});
				assert.equal(response.statusCode, 400);
			});
		});
	});

	describe('service error -> HTTP mapping', () => {
		const prismaUnique = () => Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
		const cases = [
			['INVALID_EMAIL', () => new Error('INVALID_EMAIL'), 400, { error: 'Invalid input' }],
			['INVALID_USERNAME', () => new Error('INVALID_USERNAME'), 400, { error: 'Invalid input' }],
			['INVALID_PASSWORD', () => new Error('INVALID_PASSWORD'), 400, { error: 'Invalid input' }],
			['INVALID_CREDENTIALS', () => new Error('INVALID_CREDENTIALS'), 401, { error: 'Invalid credentials' }],
			['Prisma P2002', prismaUnique, 409, { error: 'Account already exists' }],
			[
				'LOGIN_RATE_LIMITED',
				() => new Error('LOGIN_RATE_LIMITED'),
				429,
				{ error: 'Too many login attempts. Try again later.' },
			],
		];

		for (const [route, method, body] of [
			['/api/auth/register', 'register', REGISTER_BODY],
			['/api/auth/login', 'login', LOGIN_BODY],
		]) {
			for (const [name, makeError, status, payload] of cases) {
				test(`[E] ${route}: ${name} -> ${status}, no cookie`, async () => {
					const fake = fakeAuthService({
						[method]: async () => {
							throw makeError();
						},
					});
					await withApp(fake.service, async (app) => {
						const response = await app.inject({ method: 'POST', url: route, headers: AUTH_HEADERS, payload: body });
						assert.equal(response.statusCode, status);
						assert.deepEqual(response.json(), payload);
						assert.equal(setCookies(response).length, 0);
					});
				});
			}

			test(`[E] ${route}: unexpected error -> 500, internals not mapped to a 4xx`, async () => {
				const fake = fakeAuthService({
					[method]: async () => {
						throw new Error('DB_CONNECTION_LOST');
					},
				});
				await withApp(fake.service, async (app) => {
					const response = await app.inject({ method: 'POST', url: route, headers: AUTH_HEADERS, payload: body });
					assert.equal(response.statusCode, 500);
					assert.equal(setCookies(response).length, 0);
				});
			});
		}
	});

	describe('POST /api/auth/login', () => {
		test('[S] 200, account in body, cookie carries the new token', async () => {
			const fake = fakeAuthService();
			await withApp(fake.service, async (app) => {
				const response = await app.inject({
					method: 'POST',
					url: '/api/auth/login',
					headers: AUTH_HEADERS,
					payload: LOGIN_BODY,
				});
				assert.equal(response.statusCode, 200);
				assert.deepEqual(response.json(), { account: fake.account });
				assertSessionCookie(response, 'raw-login-token');
			});
			assert.deepEqual(fake.callsTo('login')[0].args, [LOGIN_BODY]);
		});

		for (const field of Object.keys(LOGIN_BODY)) {
			test(`[E] missing ${field} -> 400`, async () => {
				const fake = fakeAuthService();
				const { [field]: _omitted, ...payload } = LOGIN_BODY;
				await withApp(fake.service, async (app) => {
					const response = await app.inject({
						method: 'POST',
						url: '/api/auth/login',
						headers: AUTH_HEADERS,
						payload,
					});
					assert.equal(response.statusCode, 400);
				});
				assert.equal(fake.calls.length, 0);
			});
		}
	});

	describe('GET /api/auth/me', () => {
		test('[Z] no cookie -> 401 without calling the service', async () => {
			const fake = fakeAuthService();
			await withApp(fake.service, async (app) => {
				const response = await app.inject({ method: 'GET', url: '/api/auth/me' });
				assert.equal(response.statusCode, 401);
				assert.deepEqual(response.json(), { error: 'Not authenticated' });
			});
			assert.equal(fake.calls.length, 0);
		});

		test('[E] unknown token -> 401', async () => {
			const fake = fakeAuthService();
			await withApp(fake.service, async (app) => {
				const response = await app.inject({
					method: 'GET',
					url: '/api/auth/me',
					headers: { cookie: 'session=stale-token' },
				});
				assert.equal(response.statusCode, 401);
			});
			assert.deepEqual(fake.callsTo('getAuthenticatedAccount')[0].args, ['stale-token']);
		});

		test('[I] only the "session" cookie is read', async () => {
			const fake = fakeAuthService();
			await withApp(fake.service, async (app) => {
				const response = await app.inject({
					method: 'GET',
					url: '/api/auth/me',
					headers: { cookie: 'sid=valid-token' },
				});
				assert.equal(response.statusCode, 401);
			});
			assert.equal(fake.calls.length, 0);
		});

		test('[S] valid token -> 200 { account }', async () => {
			const fake = fakeAuthService();
			await withApp(fake.service, async (app) => {
				const response = await app.inject({
					method: 'GET',
					url: '/api/auth/me',
					headers: { cookie: 'theme=dark; session=valid-token' },
				});
				assert.equal(response.statusCode, 200);
				assert.deepEqual(response.json(), { account: fake.account });
			});
		});

		test('[E] service failure -> 500', async () => {
			const fake = fakeAuthService({
				getAuthenticatedAccount: async () => {
					throw new Error('DB_DOWN');
				},
			});
			await withApp(fake.service, async (app) => {
				const response = await app.inject({
					method: 'GET',
					url: '/api/auth/me',
					headers: { cookie: 'session=valid-token' },
				});
				assert.equal(response.statusCode, 500);
			});
		});
	});

	describe('POST /api/auth/logout', () => {
		test('[Z] no cookie -> 204, service not called, cookie cleared', async () => {
			const fake = fakeAuthService();
			await withApp(fake.service, async (app) => {
				const response = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: AUTH_HEADERS });
				assert.equal(response.statusCode, 204);
				assert.equal(response.body, '');
				assertClearedCookie(response);
			});
			assert.equal(fake.calls.length, 0);
		});

		test('[S] cookie -> service revokes that exact token, 204, cookie cleared', async () => {
			const fake = fakeAuthService();
			await withApp(fake.service, async (app) => {
				const response = await app.inject({
					method: 'POST',
					url: '/api/auth/logout',
					headers: { ...AUTH_HEADERS, cookie: 'session=tok-123' },
				});
				assert.equal(response.statusCode, 204);
				assertClearedCookie(response);
			});
			assert.deepEqual(fake.callsTo('logout')[0].args, ['tok-123']);
		});

		test('[E] revocation failure -> 500 and the cookie is NOT cleared', async () => {
			const fake = fakeAuthService({
				logout: async () => {
					throw new Error('SIMULATED_REVOCATION_FAILURE');
				},
			});
			await withApp(fake.service, async (app) => {
				const response = await app.inject({
					method: 'POST',
					url: '/api/auth/logout',
					headers: { ...AUTH_HEADERS, cookie: 'session=tok-123' },
				});
				assert.equal(response.statusCode, 500);
				assert.equal(setCookies(response).length, 0);
			});
		});
	});

	test('[M] stateful flow: register -> me -> login rotates -> old cookie rejected -> logout', async () => {
		let active = null;
		const fake = fakeAuthService({
			register: async () => ({ account: fake.account, rawToken: (active = 'token-one') }),
			login: async () => ({ account: fake.account, rawToken: (active = 'token-two') }),
			getAuthenticatedAccount: async (token) => (token === active ? fake.account : null),
			logout: async (token) => {
				if (token === active) active = null;
			},
		});

		await withApp(fake.service, async (app) => {
			const me = (token) =>
				app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: `session=${token}` } });

			await app.inject({ method: 'POST', url: '/api/auth/register', headers: AUTH_HEADERS, payload: REGISTER_BODY });
			assert.equal((await me('token-one')).statusCode, 200);

			await app.inject({ method: 'POST', url: '/api/auth/login', headers: AUTH_HEADERS, payload: LOGIN_BODY });
			assert.equal((await me('token-one')).statusCode, 401);
			assert.equal((await me('token-two')).statusCode, 200);

			await app.inject({
				method: 'POST',
				url: '/api/auth/logout',
				headers: { ...AUTH_HEADERS, cookie: 'session=token-two' },
			});
			assert.equal((await me('token-two')).statusCode, 401);
		});
	});

	test('[I] buildApp() without a service lazily loads the real AuthService', async () => {
		// Malformed tokens are rejected by the real service before any I/O.
		await withApp(undefined, async (app) => {
			const me = await app.inject({
				method: 'GET',
				url: '/api/auth/me',
				headers: { cookie: 'session=not-a-real-token' },
			});
			assert.equal(me.statusCode, 401);

			const logout = await app.inject({
				method: 'POST',
				url: '/api/auth/logout',
				headers: { ...AUTH_HEADERS, cookie: 'session=not-a-real-token' },
			});
			assert.equal(logout.statusCode, 204);
		});
	});
});

// ===========================================================================
// Layer B - Regression tests
// ===========================================================================

describe('Layer B - joinPlayerAtomic Lua (database/redis-commands.js)', () => {
	const joinLua = () => {
		use('redisCommands');
		const registered = luaScripts.get('joinPlayerAtomic');
		assert.ok(registered, 'joinPlayerAtomic was not registered with defineCommand');
		return registered.lua;
	};

	test('[I] joinPlayerAtomic takes 3 keys (room, players, status)', () => {
		use('redisCommands');
		assert.equal(luaScripts.get('joinPlayerAtomic')?.numberOfKeys, 3);
	});

	test('[I] rooms have no player cap: no SCARD comparison and no capacity argument', () => {
		const lua = joinLua();
		assert.doesNotMatch(lua, /SCARD/);
		assert.doesNotMatch(lua, /ARGV\[3\]/);
		assert.doesNotMatch(lua, /ROOM_FULL/);
	});

	test('[B] the script checks the room exists before writing anything', () => {
		const lua = joinLua();
		const exists = lua.search(/redis\.call\('EXISTS',\s*roomKey\)/);
		assert.ok(exists >= 0, 'missing EXISTS roomKey guard');
		assert.ok(exists < lua.search(/SADD/), 'EXISTS must run before SADD');
	});

	describe('live Lua execution', needsRedis, () => {
		const keys = [];
		after(async () => {
			if (keys.length) await live.redis.del(...keys);
		});
		const join = (id, who) =>
			live.redis.joinPlayerAtomic(wire.room(id), wire.players(id), wire.status(who), id, who);

		test('[M] 12 players join one room; a repeat join is ALREADY_IN_ROOM', async () => {
			const id = `lua_${uniq()}`;
			const players = Array.from({ length: 12 }, (_, i) => `${id}-p${i}`);
			keys.push(wire.room(id), wire.players(id), ...players.map(wire.status));
			await live.redis.hset(wire.room(id), { matchId: id, playerCount: 0, maxCapacity: 6 });
			await live.redis.expire(wire.room(id), 300);

			for (const who of players) assert.deepEqual(await join(id, who), [1, 'SUCCESS']);
			assert.deepEqual(await join(id, players[0]), [0, 'ALREADY_IN_ROOM']);
			assert.equal(await live.redis.hget(wire.room(id), 'playerCount'), '12');
			assert.equal(await live.redis.scard(wire.players(id)), 12);
		});

		test('[B] a missing (expired) room -> ROOM_NOT_FOUND and no keys are created', async () => {
			const id = `lua_${uniq()}`;
			const who = `${id}-late`;
			keys.push(wire.room(id), wire.players(id), wire.status(who));

			assert.deepEqual(await join(id, who), [0, 'ROOM_NOT_FOUND']);
			assert.equal(await live.redis.exists(wire.room(id), wire.players(id), wire.status(who)), 0);
		});

		test('[B] a room without a TTL -> ROOM_HAS_NO_EXPIRY and no status is written', async () => {
			const id = `lua_${uniq()}`;
			const who = `${id}-a`;
			keys.push(wire.room(id), wire.players(id), wire.status(who));
			await live.redis.hset(wire.room(id), { matchId: id, playerCount: 0 });

			assert.deepEqual(await join(id, who), [0, 'ROOM_HAS_NO_EXPIRY']);
			assert.equal(await live.redis.exists(wire.players(id), wire.status(who)), 0);
			assert.equal(await live.redis.hget(wire.room(id), 'playerCount'), '0');
		});

		test('[B] near-expiry room (TTL rounds to 0): player:status still gets a TTL', async () => {
			const id = `lua_${uniq()}`;
			const who = `${id}-a`;
			keys.push(wire.room(id), wire.players(id), wire.status(who));
			await live.redis.hset(wire.room(id), { matchId: id, playerCount: 0 });
			await live.redis.pexpire(wire.room(id), 400);
			assert.equal(await live.redis.ttl(wire.room(id)), 0, 'precondition: TTL reports 0');

			assert.deepEqual(await join(id, who), [1, 'SUCCESS']);
			const pttl = await live.redis.pttl(wire.status(who));
			assert.ok(pttl > 0 && pttl <= 400, `status pttl ${pttl}`);
		});

		test('[B] player:status inherits the room TTL', async () => {
			const id = `lua_${uniq()}`;
			const who = `${id}-a`;
			keys.push(wire.room(id), wire.players(id), wire.status(who));
			await live.redis.hset(wire.room(id), { matchId: id, playerCount: 0 });
			await live.redis.expire(wire.room(id), 300);

			assert.deepEqual(await join(id, who), [1, 'SUCCESS']);
			const ttl = await live.redis.ttl(wire.status(who));
			assert.ok(ttl > 290 && ttl <= 300, `status ttl ${ttl}`);
		});
	});
});

describe('Layer B - Prisma schema FK types (prisma/schema.prisma)', () => {
	const schema = readFileSync(new URL('prisma/schema.prisma', BACKEND_URL), 'utf8');

	function model(name) {
		const block = schema.match(new RegExp(`model\\s+${name}\\s*\\{([\\s\\S]*?)\\n\\}`));
		assert.ok(block, `model ${name} not found`);
		const fields = {};
		for (const line of block[1].split('\n')) {
			const match = line.trim().match(/^(\w+)\s+(\w+)(\??)(?:\s+(.*))?$/);
			if (match) fields[match[1]] = { type: match[2], optional: match[3] === '?', attrs: match[4] ?? '' };
		}
		return fields;
	}

	test('[I] Session.playerAccountId has the same scalar type as PlayerAccount.accountId', () => {
		const session = model('Session');
		const account = model('PlayerAccount');
		assert.equal(session.playerAccountId.type, account.accountId.type);
		assert.equal(session.playerAccountId.optional, false);
		assert.equal(account.accountId.optional, false);
	});

	test('[I] Session.playerAccount relation maps playerAccountId -> accountId with cascade delete', () => {
		const { attrs } = model('Session').playerAccount;
		assert.match(attrs, /fields:\s*\[playerAccountId\]/);
		assert.match(attrs, /references:\s*\[accountId\]/);
		assert.match(attrs, /onDelete:\s*Cascade/);
	});

	test('[B] at most one session per account; token hashes are unique', () => {
		const session = model('Session');
		assert.match(session.playerAccountId.attrs, /@unique/);
		assert.match(session.tokenHash.attrs, /@unique/);
		assert.deepEqual(
			{ type: model('PlayerAccount').session.type, optional: model('PlayerAccount').session.optional },
			{ type: 'Session', optional: true },
		);
	});

	test('[I] displayName and email are unique; avatarId defaults to "default"', () => {
		const account = model('PlayerAccount');
		assert.match(account.displayName.attrs, /@unique/);
		assert.match(account.email.attrs, /@unique/);
		assert.equal(account.avatarId.optional, false);
		assert.match(account.avatarId.attrs, /@default\("default"\)/);
	});

	test('[B] MatchHistory.finalScore is an optional VarChar(7)', () => {
		const { finalScore } = model('MatchHistory');
		assert.equal(finalScore.optional, true);
		assert.match(finalScore.attrs, /@db\.VarChar\(7\)/);
	});

	test('[I] updateProfile selects only fields that exist on PlayerAccount', async () => {
		const db = stubClient({ 'playerAccount.update': async (query) => query });
		const { PlayerRepository } = use('playerRepo');
		const query = await withClients({ prisma: db.client }, () => PlayerRepository.updateProfile('u1', {}));
		const fields = Object.keys(model('PlayerAccount'));
		for (const key of Object.keys(query.select)) assert.ok(fields.includes(key), key);
	});
});

// ===========================================================================
// Layer B/C - Live PostgreSQL repositories
// ===========================================================================

describe('Layer C - PlayerRepository (live PostgreSQL)', needsPostgres, () => {
	const accountIds = [];
	after(async () => {
		await live.prisma.playerAccount.deleteMany({ where: { accountId: { in: accountIds } } });
	});

	async function newPlayer(overrides = {}) {
		const { PlayerRepository } = use('playerRepo');
		const u = uniq();
		const id = randomUUID();
		accountIds.push(id);
		return PlayerRepository.createPlayer(
			id,
			overrides.username ?? `P${u}`,
			overrides.email ?? `p-${u}@example.test`,
			'test-hash',
		);
	}

	test('[S] createPlayer persists and returns the row', async () => {
		const player = await newPlayer();
		assert.match(player.displayName, /^P[0-9a-f]{12}$/);
		assert.equal(player.passwordHash, 'test-hash');
		assert.equal(player.avatarId, 'default');
		assert.equal(player.usernameChangedAt, null);
		assert.ok(player.createdAt instanceof Date);
		assert.ok(player.updatedAt instanceof Date);
	});

	test('[E] duplicate displayName -> P2002', async () => {
		const player = await newPlayer();
		await assert.rejects(newPlayer({ username: player.displayName }), { code: 'P2002' });
	});

	test('[E] duplicate email -> P2002', async () => {
		const player = await newPlayer();
		await assert.rejects(newPlayer({ email: player.email }), { code: 'P2002' });
	});

	test('[O] lookups by id, username and email return the same row; unknown -> null', async () => {
		const { PlayerRepository } = use('playerRepo');
		const player = await newPlayer();
		assert.equal((await PlayerRepository.getPlayerById(player.accountId)).email, player.email);
		assert.equal((await PlayerRepository.getPlayerByUsername(player.displayName)).accountId, player.accountId);
		assert.equal((await PlayerRepository.getPlayerByEmail(player.email)).accountId, player.accountId);
		assert.equal(await PlayerRepository.getPlayerById(randomUUID()), null);
		assert.equal(await PlayerRepository.getPlayerByUsername(`Missing${uniq()}`), null);
		assert.equal(await PlayerRepository.getPlayerByEmail(`missing-${uniq()}@example.test`), null);
	});

	test('[I] updateProfile returns the selected public shape', async () => {
		const { PlayerRepository } = use('playerRepo');
		const player = await newPlayer();
		const updated = await PlayerRepository.updateProfile(player.accountId, { username: `  N${uniq()} ` });
		assert.deepEqual(Object.keys(updated).sort(), [
			'accountId',
			'avatarId',
			'createdAt',
			'displayName',
			'email',
			'updatedAt',
			'usernameChangedAt',
		]);
		assert.match(updated.displayName, /^N[0-9a-f]{12}$/);
	});

	test('[B] partial update: undefined avatarId leaves the stored avatar untouched', async () => {
		const { PlayerRepository } = use('playerRepo');
		const player = await newPlayer();
		await PlayerRepository.updateProfile(player.accountId, { avatarId: 'red_car' });

		const newName = `K${uniq()}`;
		await PlayerRepository.updateProfile(player.accountId, { username: newName });
		const row = await PlayerRepository.getPlayerById(player.accountId);
		assert.equal(row.avatarId, 'red_car');
		assert.equal(row.displayName, newName);
		assert.equal(row.email, player.email);
		assert.equal(row.passwordHash, player.passwordHash);
	});

	test('[B] avatarId can be changed back to "default"', async () => {
		const { PlayerRepository } = use('playerRepo');
		const player = await newPlayer();
		await PlayerRepository.updateProfile(player.accountId, { avatarId: 'blue_car' });
		await PlayerRepository.updateProfile(player.accountId, { avatarId: 'default' });
		const row = await PlayerRepository.getPlayerById(player.accountId);
		assert.equal(row.avatarId, 'default');
		assert.equal(row.displayName, player.displayName);
	});

	test('[Z] empty update changes no stored field', async () => {
		const { PlayerRepository } = use('playerRepo');
		const player = await newPlayer();
		await PlayerRepository.updateProfile(player.accountId, { avatarId: 'red_car' });
		const before = await PlayerRepository.getPlayerById(player.accountId);
		await PlayerRepository.updateProfile(player.accountId, {});
		const afterUpdate = await PlayerRepository.getPlayerById(player.accountId);
		const { updatedAt: _a, ...beforeFields } = before;
		const { updatedAt: _b, ...afterFields } = afterUpdate;
		assert.deepEqual(afterFields, beforeFields);
	});

	test('[E] updateProfile to a taken displayName -> P2002', async () => {
		const { PlayerRepository } = use('playerRepo');
		const first = await newPlayer();
		const second = await newPlayer();
		await assert.rejects(
			PlayerRepository.updateProfile(second.accountId, { username: first.displayName }),
			{ code: 'P2002' },
		);
	});

	test('[E] updateProfile on a missing account -> P2025', async () => {
		const { PlayerRepository } = use('playerRepo');
		await assert.rejects(PlayerRepository.updateProfile(randomUUID(), { avatarId: 'default' }), {
			code: 'P2025',
		});
	});

	test('[S] updateEmail changes only the email', async () => {
		const { PlayerRepository } = use('playerRepo');
		const player = await newPlayer();
		const email = `new-${uniq()}@example.test`;
		const updated = await PlayerRepository.updateEmail(player.accountId, email);
		assert.equal(updated.email, email);
		assert.equal(updated.displayName, player.displayName);
	});
});

describe('Layer C - MatchRepository (live PostgreSQL)', needsPostgres, () => {
	const matchIds = [];
	after(async () => {
		await live.prisma.matchHistory.deleteMany({ where: { matchId: { in: matchIds } } });
	});

	const newId = () => {
		const id = `match_${randomUUID()}`;
		matchIds.push(id);
		return id;
	};

	test('[S] saveMatchResult persists; getMatchById reads it back', async () => {
		const { MatchRepository } = use('matchRepo');
		const matchId = newId();
		const saved = await MatchRepository.saveMatchResult({ matchId, winningTeam: 'Blue', finalScore: '3/2' });
		assert.ok(saved.timestamp instanceof Date);
		assert.deepEqual(await MatchRepository.getMatchById(matchId), saved);
	});

	test('[Z] unknown match -> null', async () => {
		assert.equal(await use('matchRepo').MatchRepository.getMatchById(`match_${randomUUID()}`), null);
	});

	test('[Z] omitted finalScore is stored as null', async () => {
		const saved = await use('matchRepo').MatchRepository.saveMatchResult({ matchId: newId(), winningTeam: 'Red' });
		assert.equal(saved.finalScore, null);
	});

	test('[B] finalScore of exactly 7 chars fits; 8 chars is rejected', async () => {
		const { MatchRepository } = use('matchRepo');
		const ok = await MatchRepository.saveMatchResult({ matchId: newId(), winningTeam: 'Red', finalScore: '100/100' });
		assert.equal(ok.finalScore, '100/100');
		await assert.rejects(
			MatchRepository.saveMatchResult({ matchId: newId(), winningTeam: 'Red', finalScore: '1000/100' }),
		);
	});

	test('[E] duplicate matchId -> P2002', async () => {
		const { MatchRepository } = use('matchRepo');
		const matchId = newId();
		await MatchRepository.saveMatchResult({ matchId, winningTeam: 'Blue' });
		await assert.rejects(MatchRepository.saveMatchResult({ matchId, winningTeam: 'Red' }), { code: 'P2002' });
	});
});

describe('Layer C - SessionRepository (live PostgreSQL)', needsPostgres, () => {
	const accountIds = [];
	after(async () => {
		await live.prisma.playerAccount.deleteMany({ where: { accountId: { in: accountIds } } });
	});

	async function newAccount() {
		const id = randomUUID();
		accountIds.push(id);
		const u = uniq();
		await use('playerRepo').PlayerRepository.createPlayer(id, `S${u}`, `s-${u}@example.test`, 'hash');
		return id;
	}

	const inOneHour = () => new Date(Date.now() + 3600_000);

	test('[S] createOrReplace creates the first session', async () => {
		const { SessionRepository } = use('sessionRepo');
		const playerAccountId = await newAccount();
		const tokenHash = sha256(uniq());
		const session = await SessionRepository.createOrReplace({ playerAccountId, tokenHash, expiresAt: inOneHour() });
		assert.equal(session.tokenHash, tokenHash);
		assert.equal(session.revokedAt, null);
		assert.deepEqual(await SessionRepository.findByAccountId(playerAccountId), session);
	});

	test('[M] createOrReplace keeps one row per account, rotates the hash, clears revokedAt', async () => {
		const { SessionRepository } = use('sessionRepo');
		const playerAccountId = await newAccount();
		const first = sha256(uniq());
		const second = sha256(uniq());

		await SessionRepository.createOrReplace({ playerAccountId, tokenHash: first, expiresAt: inOneHour() });
		await SessionRepository.revokeByTokenHash(first);
		await SessionRepository.createOrReplace({ playerAccountId, tokenHash: second, expiresAt: inOneHour() });

		const rows = await live.prisma.session.findMany({ where: { playerAccountId } });
		assert.equal(rows.length, 1);
		assert.equal(rows[0].tokenHash, second);
		assert.equal(rows[0].revokedAt, null);
		assert.equal(await SessionRepository.findActiveByTokenHash(first), null);
	});

	test('[I] createOrReplace honours a transaction client', async () => {
		const { SessionRepository } = use('sessionRepo');
		const playerAccountId = await newAccount();
		const tokenHash = sha256(uniq());
		await live.prisma.$transaction((tx) =>
			SessionRepository.createOrReplace({ playerAccountId, tokenHash, expiresAt: inOneHour() }, tx),
		);
		assert.equal((await SessionRepository.findByAccountId(playerAccountId)).tokenHash, tokenHash);
	});

	test('[B] findActiveByTokenHash ignores an expired session', async () => {
		const { SessionRepository } = use('sessionRepo');
		const playerAccountId = await newAccount();
		const tokenHash = sha256(uniq());
		await SessionRepository.createOrReplace({ playerAccountId, tokenHash, expiresAt: new Date(Date.now() - 1000) });
		assert.equal(await SessionRepository.findActiveByTokenHash(tokenHash), null);
		assert.ok(await SessionRepository.findByAccountId(playerAccountId));
	});

	test('[E] revokeByTokenHash revokes once; repeats and unknown hashes touch nothing', async () => {
		const { SessionRepository } = use('sessionRepo');
		const playerAccountId = await newAccount();
		const tokenHash = sha256(uniq());
		await SessionRepository.createOrReplace({ playerAccountId, tokenHash, expiresAt: inOneHour() });

		assert.ok(await SessionRepository.findActiveByTokenHash(tokenHash));
		assert.equal((await SessionRepository.revokeByTokenHash(tokenHash)).count, 1);
		assert.equal((await SessionRepository.revokeByTokenHash(tokenHash)).count, 0);
		assert.equal((await SessionRepository.revokeByTokenHash(sha256(uniq()))).count, 0);
		assert.equal(await SessionRepository.findActiveByTokenHash(tokenHash), null);
	});

	test('[E] a session for a non-existent account violates the FK', async () => {
		const { SessionRepository } = use('sessionRepo');
		await assert.rejects(
			SessionRepository.createOrReplace({
				playerAccountId: randomUUID(),
				tokenHash: sha256(uniq()),
				expiresAt: inOneHour(),
			}),
		);
	});

	test('[I] deleting the account cascades to its session', async () => {
		const { SessionRepository } = use('sessionRepo');
		const playerAccountId = await newAccount();
		await SessionRepository.createOrReplace({ playerAccountId, tokenHash: sha256(uniq()), expiresAt: inOneHour() });
		await live.prisma.playerAccount.delete({ where: { accountId: playerAccountId } });
		assert.equal(await SessionRepository.findByAccountId(playerAccountId), null);
	});
});

// ===========================================================================
// Layer C - Live Redis: lobby and atomic room state
// ===========================================================================

describe('Layer C - Lobby and atomic room state (live Redis)', needsRedis, () => {
	const matchIds = new Set();
	const accountIds = new Set();

	after(async () => {
		for (const id of matchIds) {
			await live.redis.del(wire.room(id), wire.players(id), wire.spectators(id), wire.slots(id));
			await live.redis.srem(wire.active, id);
		}
		if (accountIds.size) await live.redis.del(...[...accountIds].map(wire.status));
	});

	const newMatch = () => {
		const id = `test_${randomUUID()}`;
		matchIds.add(id);
		return id;
	};
	const newAccount = () => {
		const id = randomUUID();
		accountIds.add(id);
		return id;
	};

	async function room(maxCapacity, extra = {}) {
		const matchId = newMatch();
		const hostId = newAccount();
		await use('cacheRepo').CacheRepository.createRoom(matchId, {
			hostId,
			serverAddress: '127.0.0.1:9000',
			maxCapacity,
			...extra,
		});
		return { matchId, hostId };
	}

	test('[S] createRoom writes room hash, host membership, status, room listing and TTLs', async () => {
		const { CacheRepository } = use('cacheRepo');
		const { matchId, hostId } = await room(undefined);

		const data = await CacheRepository.getRoom(matchId);
		assert.equal(data.matchId, matchId);
		assert.equal(data.hostId, hostId);
		assert.equal(data.serverAddress, '127.0.0.1:9000');
		assert.equal(data.playerCount, '1');
		assert.equal(data.maxCapacity, '6');
		assert.equal(data.passwordHash, '');
		assert.ok(Math.abs(Number(data.startedAt) - Date.now()) < 60_000);

		assert.deepEqual(await CacheRepository.getRoomPlayers(matchId), [hostId]);
		assert.equal(await CacheRepository.getPlayerStatus(hostId), matchId);
		assert.equal(await live.redis.sismember(wire.active, matchId), 1);
		assert.equal(await live.redis.exists('rooms:available'), 0, 'rooms:available is no longer written');

		for (const key of [wire.room(matchId), wire.players(matchId), wire.status(hostId)]) {
			const ttl = await live.redis.ttl(key);
			assert.ok(ttl > 7100 && ttl <= 7200, `${key} ttl ${ttl}`);
		}
	});

	test('[Z] unknown room/player reads return null / [] / null / {}', async () => {
		const { CacheRepository } = use('cacheRepo');
		const id = `absent_${randomUUID()}`;
		assert.equal(await CacheRepository.getRoom(id), null);
		assert.deepEqual(await CacheRepository.getRoomPlayers(id), []);
		assert.equal(await CacheRepository.getPlayerStatus(randomUUID()), null);
		assert.deepEqual(await CacheRepository.getLiveDrivers(id), {});
	});

	test('[E] joinPlayerToRoom: unknown room -> ROOM_NOT_FOUND result', async () => {
		const result = await use('cacheRepo').CacheRepository.joinPlayerToRoom(`absent_${randomUUID()}`, newAccount());
		assert.deepEqual(result, { success: false, status: 'ROOM_NOT_FOUND' });
	});

	test('[B] maxCapacity is not enforced: 3 more players join a room created with maxCapacity 3', async () => {
		const { CacheRepository } = use('cacheRepo');
		const { matchId, hostId } = await room(3);
		const guests = [newAccount(), newAccount(), newAccount()];
		for (const guest of guests) {
			assert.equal(await CacheRepository.joinPlayerToRoom(matchId, guest), 'SUCCESS');
		}
		assert.equal((await CacheRepository.getRoom(matchId)).playerCount, '4');
		assert.deepEqual((await CacheRepository.getRoomPlayers(matchId)).sort(), [hostId, ...guests].sort());
		assert.equal(await CacheRepository.getPlayerStatus(guests[2]), matchId);
	});

	test('[I] leaving to 0 players and rejoining keeps playerCount in step with the players set', async () => {
		const { CacheRepository } = use('cacheRepo');
		const { matchId, hostId } = await room(6);
		assert.equal(await CacheRepository.leavePlayerFromRoom(matchId, hostId), true);
		assert.equal((await CacheRepository.getRoom(matchId)).playerCount, '0');
		assert.equal(await CacheRepository.joinPlayerToRoom(matchId, newAccount()), 'SUCCESS');
		assert.equal((await CacheRepository.getRoom(matchId)).playerCount, '1');
	});

	test('[E] joining twice -> ALREADY_IN_ROOM, count unchanged', async () => {
		const { CacheRepository } = use('cacheRepo');
		const { matchId, hostId } = await room(6);
		await assert.rejects(CacheRepository.joinPlayerToRoom(matchId, hostId), {
			message: 'Failed to join room: ALREADY_IN_ROOM',
		});
		assert.equal((await CacheRepository.getRoom(matchId)).playerCount, '1');
	});

	test('[M] 10 concurrent joins all succeed and playerCount matches the players set', async () => {
		const { CacheRepository } = use('cacheRepo');
		const { matchId } = await room(4);
		const players = Array.from({ length: 10 }, newAccount);

		const outcomes = await Promise.allSettled(
			players.map((id) => CacheRepository.joinPlayerToRoom(matchId, id)),
		);
		assert.ok(outcomes.every((o) => o.status === 'fulfilled' && o.value === 'SUCCESS'));
		assert.equal((await CacheRepository.getRoomPlayers(matchId)).length, 11);
		assert.equal((await CacheRepository.getRoom(matchId)).playerCount, '11');
	});

	test('[S] password room: wrong password leaves state unchanged, correct one joins', async () => {
		const { CacheRepository } = use('cacheRepo');
		const { matchId } = await room(6, { password: 'room-secret' });
		const guest = newAccount();

		const data = await CacheRepository.getRoom(matchId);
		assert.match(data.passwordHash, /^\$argon2id\$/);

		assert.deepEqual(
			await CacheRepository.joinPlayerToRoomPassword({ matchId, accountId: guest }),
			{ success: false, status: 'PASSWORD_REQUIRED' },
		);
		assert.deepEqual(
			await CacheRepository.joinPlayerToRoomPassword({ matchId, accountId: guest, password: 'nope' }),
			{ success: false, status: 'INVALID_PASSWORD' },
		);
		assert.equal((await CacheRepository.getRoomPlayers(matchId)).length, 1);

		assert.equal(
			await CacheRepository.joinPlayerToRoomPassword({ matchId, accountId: guest, password: 'room-secret' }),
			'SUCCESS',
		);
		assert.ok((await CacheRepository.getRoomPlayers(matchId)).includes(guest));
	});

	test('[I] leavePlayerFromRoom: member leaves (status -> online); second leave -> false', async () => {
		const { CacheRepository } = use('cacheRepo');
		const { matchId } = await room(6);
		const guest = newAccount();
		await CacheRepository.joinPlayerToRoom(matchId, guest);

		assert.equal(await CacheRepository.leavePlayerFromRoom(matchId, guest), true);
		assert.equal(await CacheRepository.getPlayerStatus(guest), 'online');
		assert.equal((await CacheRepository.getRoom(matchId)).playerCount, '1');
		assert.equal(await CacheRepository.leavePlayerFromRoom(matchId, guest), false);
		assert.equal((await CacheRepository.getRoom(matchId)).playerCount, '1');
	});

	test('[M] concurrent duplicate leaves: exactly one succeeds, playerCount never goes negative', async () => {
		const { CacheRepository } = use('cacheRepo');
		const { matchId, hostId } = await room(6);

		const outcomes = await Promise.all(
			Array.from({ length: 5 }, () => CacheRepository.leavePlayerFromRoom(matchId, hostId)),
		);
		assert.equal(outcomes.filter(Boolean).length, 1);
		assert.equal((await CacheRepository.getRoomPlayers(matchId)).length, 0);
		assert.equal((await CacheRepository.getRoom(matchId)).playerCount, '0');
	});

	test('[B] leaving an expired room does not recreate the room hash', async () => {
		const { CacheRepository } = use('cacheRepo');
		const { matchId, hostId } = await room(6);
		await live.redis.del(wire.room(matchId));

		assert.equal(await CacheRepository.leavePlayerFromRoom(matchId, hostId), true);
		assert.equal(await live.redis.exists(wire.room(matchId)), 0);
	});

	test('[I] getLiveDrivers returns the slots hash written by the game server', async () => {
		const { CacheRepository } = use('cacheRepo');
		const { matchId } = await room(6);
		await live.redis.hset(wire.slots(matchId), { 0: 'driver-a', 1: 'driver-b' });
		assert.deepEqual(await CacheRepository.getLiveDrivers(matchId), { 0: 'driver-a', 1: 'driver-b' });
	});

	test('[E] refreshRoom on a missing room -> ROOM_NOT_FOUND', async () => {
		await assert.rejects(use('cacheRepo').CacheRepository.refreshRoom(`absent_${randomUUID()}`, 60), {
			message: 'ROOM_NOT_FOUND',
		});
	});

	test('[B] refreshRoom resets the TTL of room, players and existing slots keys', async () => {
		const { CacheRepository } = use('cacheRepo');
		const { matchId } = await room(6, { duration: 30 });
		await live.redis.hset(wire.slots(matchId), { 0: 'driver-a' });

		const result = await CacheRepository.refreshRoom(matchId, 600);
		assert.deepEqual(result, { matchId, refreshed: true, duration: 600 });
		for (const key of [wire.room(matchId), wire.players(matchId), wire.slots(matchId)]) {
			const ttl = await live.redis.ttl(key);
			assert.ok(ttl > 30 && ttl <= 600, `${key} ttl ${ttl}`);
		}
	});

	test('[B] room hash and player set expire after the room duration', async () => {
		const { CacheRepository } = use('cacheRepo');
		const { matchId } = await room(6, { duration: 1 });
		await new Promise((resolve) => setTimeout(resolve, 1500));
		assert.equal(await CacheRepository.getRoom(matchId), null);
		assert.deepEqual(await CacheRepository.getRoomPlayers(matchId), []);
	});

	test('[B] room expiry removes the room, players set and every member status; listing prunes rooms:active', async () => {
		const { CacheRepository } = use('cacheRepo');
		const { matchId, hostId } = await room(6, { duration: 1 });
		const guest = newAccount();
		await CacheRepository.joinPlayerToRoomPassword({ matchId, accountId: guest });
		await new Promise((resolve) => setTimeout(resolve, 1500));

		assert.equal(await live.redis.exists(wire.room(matchId), wire.players(matchId)), 0);
		assert.equal(await live.redis.exists(wire.status(hostId), wire.status(guest)), 0);
		assert.equal((await CacheRepository.listActiveRooms()).some((r) => r.id === matchId), false);
		assert.equal(await live.redis.sismember(wire.active, matchId), 0);
	});

	test('[E] joining an expired room -> ROOM_NOT_FOUND and nothing is recreated', async () => {
		const { CacheRepository } = use('cacheRepo');
		const { matchId } = await room(6, { duration: 1 });
		await new Promise((resolve) => setTimeout(resolve, 1500));
		const late = newAccount();

		assert.deepEqual(
			await CacheRepository.joinPlayerToRoomPassword({ matchId, accountId: late }),
			{ success: false, status: 'ROOM_NOT_FOUND' },
		);
		assert.equal(await live.redis.exists(wire.room(matchId), wire.players(matchId), wire.status(late)), 0);
	});

	test('[B] an expired room does not leave its host\'s status pointing at it', async () => {
		const { CacheRepository } = use('cacheRepo');
		const { matchId, hostId } = await room(6, { duration: 1 });
		await new Promise((resolve) => setTimeout(resolve, 1500));
		assert.notEqual(
			await CacheRepository.getPlayerStatus(hostId),
			matchId,
			'player:status:<host> still references the expired room (no TTL is set on it)',
		);
	});

	test('[S] auth session: save, read, TTL, delete', async () => {
		const { CacheRepository } = use('cacheRepo');
		const tokenHash = sha256(uniq());
		const accountId = randomUUID();
		try {
			assert.equal(await CacheRepository.saveAuthSession(tokenHash, accountId, 5), 'OK');
			assert.equal(await CacheRepository.getAuthSessionAccountId(tokenHash), accountId);
			const ttl = await live.redis.ttl(wire.session(tokenHash));
			assert.ok(ttl > 0 && ttl <= 5);
			assert.equal(await CacheRepository.deleteAuthSession(tokenHash), 1);
			assert.equal(await CacheRepository.deleteAuthSession(tokenHash), 0);
			assert.equal(await CacheRepository.getAuthSessionAccountId(tokenHash), null);
		} finally {
			await live.redis.del(wire.session(tokenHash));
		}
	});
});

describe('Layer C - Login throttle (live Redis)', needsRedis, () => {
	test('[B] five attempts pass, the sixth is blocked, counter expires within 60 s', async () => {
		const { checkLoginAttempt, loginAttemptKey } = use('throttle');
		const email = `limit-${randomUUID()}@example.test`;
		const other = `limit-${randomUUID()}@example.test`;
		try {
			for (let attempt = 0; attempt < 5; attempt += 1) await checkLoginAttempt(email);
			await assert.rejects(checkLoginAttempt(email), { message: 'LOGIN_RATE_LIMITED' });
			const ttl = await live.redis.ttl(loginAttemptKey(email));
			assert.ok(ttl > 0 && ttl <= 60, `ttl ${ttl}`);
			await checkLoginAttempt(other);
		} finally {
			await live.redis.del(loginAttemptKey(email), loginAttemptKey(other));
		}
	});
});

// ===========================================================================
// Layer C - Authentication and session lifecycle (live PostgreSQL + Redis)
// ===========================================================================

describe('Layer C - Authentication lifecycle (live)', needsBoth, () => {
	const emails = [];
	after(async () => {
		await live.prisma.playerAccount.deleteMany({ where: { email: { in: emails } } });
		const { loginAttemptKey } = use('throttle');
		if (emails.length) await live.redis.del(...emails.map(loginAttemptKey));
	});

	const identity = () => {
		const u = uniq();
		const email = `auth-${u}@example.test`;
		emails.push(email);
		return { username: `Auth${u}`, email };
	};

	test('[S] register -> me -> second login refused -> logout -> login rotation -> logout', async () => {
		const { AuthService } = use('auth');
		const { hashSessionToken } = use('sessionToken');
		const { username, email } = identity();

		const registered = await AuthService.register({
			username: `  ${username} `,
			email: `  ${email.toUpperCase()} `,
			password: VALID_PASSWORD,
		});
		assert.deepEqual(registered.account, {
			accountId: registered.account.accountId,
			username,
			email,
			avatarId: 'default',
			usernameChangedAt: null,
		});
		assert.match(registered.rawToken, RAW_TOKEN_PATTERN);

		const row = await live.prisma.playerAccount.findUnique({ where: { email } });
		assert.match(row.passwordHash, /^\$argon2id\$/);
		const session = await live.prisma.session.findUnique({
			where: { playerAccountId: registered.account.accountId },
		});
		assert.equal(session.tokenHash, hashSessionToken(registered.rawToken));
		assert.equal(session.revokedAt, null);
		assert.ok(session.expiresAt.getTime() > Date.now() + 23 * 3600_000);

		assert.deepEqual(await AuthService.getAuthenticatedAccount(registered.rawToken), registered.account);

		// Single session: a login while the registration session is active is refused.
		await assert.rejects(AuthService.login({ email, password: VALID_PASSWORD }), {
			message: 'ACCOUNT_ALREADY_LOGGED_IN',
		});
		assert.deepEqual(await AuthService.getAuthenticatedAccount(registered.rawToken), registered.account);
		await AuthService.logout(registered.rawToken);

		const loggedIn = await AuthService.login({ email: email.toUpperCase(), password: VALID_PASSWORD });
		assert.notEqual(loggedIn.rawToken, registered.rawToken);
		assert.equal(await AuthService.getAuthenticatedAccount(registered.rawToken), null);
		assert.deepEqual(await AuthService.getAuthenticatedAccount(loggedIn.rawToken), registered.account);

		// An old browser's token must not revoke the newer login.
		await AuthService.logout(registered.rawToken);
		assert.ok(await AuthService.getAuthenticatedAccount(loggedIn.rawToken));

		await AuthService.logout(loggedIn.rawToken);
		assert.equal(await AuthService.getAuthenticatedAccount(loggedIn.rawToken), null);
		await AuthService.logout(loggedIn.rawToken);
	});

	test('[E] duplicate email (any case) or username -> P2002', async () => {
		const { AuthService } = use('auth');
		const { username, email } = identity();
		await AuthService.register({ username, email, password: VALID_PASSWORD });

		const other = identity();
		await assert.rejects(
			AuthService.register({ username: other.username, email: email.toUpperCase(), password: VALID_PASSWORD }),
			{ code: 'P2002' },
		);
		await assert.rejects(
			AuthService.register({ username, email: other.email, password: VALID_PASSWORD }),
			{ code: 'P2002' },
		);
	});

	test('[E] wrong password and unknown email both -> INVALID_CREDENTIALS', async () => {
		const { AuthService } = use('auth');
		const { username, email } = identity();
		await AuthService.register({ username, email, password: VALID_PASSWORD });

		await assert.rejects(AuthService.login({ email, password: 'wrong-password-123' }), {
			message: 'INVALID_CREDENTIALS',
		});
		const unknown = identity();
		await assert.rejects(AuthService.login({ email: unknown.email, password: VALID_PASSWORD }), {
			message: 'INVALID_CREDENTIALS',
		});
	});

	test('[B] after five failures even the correct password is throttled', async () => {
		const { AuthService } = use('auth');
		const { username, email } = identity();
		await AuthService.register({ username, email, password: VALID_PASSWORD });

		for (let attempt = 0; attempt < 5; attempt += 1) {
			await assert.rejects(AuthService.login({ email, password: 'wrong-password-123' }), {
				message: 'INVALID_CREDENTIALS',
			});
		}
		await assert.rejects(AuthService.login({ email, password: VALID_PASSWORD }), {
			message: 'LOGIN_RATE_LIMITED',
		});
	});

	test('[I] HTTP: register 201 -> /me 200 -> duplicate 409 -> logout 204 -> /me 401', async () => {
		const { username, email } = identity();
		await withApp(undefined, async (app) => {
			const registered = await app.inject({
				method: 'POST',
				url: '/api/auth/register',
				headers: AUTH_HEADERS,
				payload: { username, email, password: VALID_PASSWORD },
			});
			assert.equal(registered.statusCode, 201);
			const cookie = setCookies(registered)[0].split(';')[0];

			const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
			assert.equal(me.statusCode, 200);
			assert.equal(me.json().account.email, email);

			const duplicate = await app.inject({
				method: 'POST',
				url: '/api/auth/register',
				headers: AUTH_HEADERS,
				payload: { username, email, password: VALID_PASSWORD },
			});
			assert.equal(duplicate.statusCode, 409);

			const invalid = await app.inject({
				method: 'POST',
				url: '/api/auth/register',
				headers: AUTH_HEADERS,
				payload: { username: 'x', email, password: VALID_PASSWORD },
			});
			assert.equal(invalid.statusCode, 400);

			const logout = await app.inject({
				method: 'POST',
				url: '/api/auth/logout',
				headers: { ...AUTH_HEADERS, cookie },
			});
			assert.equal(logout.statusCode, 204);

			const afterLogout = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
			assert.equal(afterLogout.statusCode, 401);
		});
	});

	test('[B] HTTP: five wrong logins -> 401, sixth -> 429', async () => {
		const { email } = identity();
		await withApp(undefined, async (app) => {
			const attempt = () =>
				app.inject({
					method: 'POST',
					url: '/api/auth/login',
					headers: AUTH_HEADERS,
					payload: { email, password: 'wrong-password-123' },
				});
			for (let i = 0; i < 5; i += 1) assert.equal((await attempt()).statusCode, 401);
			assert.equal((await attempt()).statusCode, 429);
		});
	});
});

// ===========================================================================
// Layer C - Database lifecycle (live). Teardown runs last.
// ===========================================================================

// The suite shims config/prisma.js, so these import the real module through an
// absolute URL (the loader hook only redirects relative imports).
describe('Layer B - Real Prisma client (config/prisma.js, not shimmed)', () => {
	const realPrisma = () => import(`${new URL('config/prisma.js', SRC_URL).href}?real`);

	test('[I] constructing the app\'s PrismaClient does not throw (Prisma 7 needs a driver adapter)', async () => {
		const { prisma } = await realPrisma();
		assert.equal(typeof prisma.$queryRaw, 'function');
	});

	test('[S] the app\'s PrismaClient answers SELECT 1', needsPostgres, async () => {
		const { prisma } = await realPrisma();
		try {
			const rows = await prisma.$queryRaw`SELECT 1 AS connected`;
			assert.equal(Number(rows[0].connected), 1);
		} finally {
			await prisma.$disconnect();
		}
	});
});

describe('Layer C - Database lifecycle (live)', () => {
	test('[S] every configured service is reachable', { skip: !process.env.DATABASE_URL && !redisSettings() && 'no DATABASE_URL or Redis settings' }, () => {
		if (process.env.DATABASE_URL) assert.ok(live.prisma, offlineReason.postgres);
		if (redisSettings()) assert.ok(live.redis, offlineReason.redis);
	});

	test('[S] Redis PING -> PONG', needsRedis, async () => {
		assert.equal(await live.redis.ping(), 'PONG');
	});

	test('[S] Postgres SELECT 1 returns one row', needsPostgres, async () => {
		const rows = await live.prisma.$queryRaw`SELECT 1 AS connected`;
		assert.equal(rows.length, 1);
		assert.equal(Number(rows[0].connected), 1);
	});

	test('[S] DatabaseLifecycle.init succeeds against live services', needsBoth, async (t) => {
		const { DatabaseLifecycle } = use('lifecycle');
		t.mock.method(console, 'log', () => {});
		const before = ['SIGINT', 'SIGTERM'].map((s) => process.rawListeners(s));
		t.after(() => {
			['SIGINT', 'SIGTERM'].forEach((signal, i) => {
				for (const listener of process.rawListeners(signal)) {
					if (!before[i].includes(listener)) process.removeListener(signal, listener);
				}
			});
		});
		await DatabaseLifecycle.init();
	});

	test('[I] checkHealth JSON contract against live services', needsBoth, async () => {
		assert.deepEqual(await use('lifecycle').DatabaseLifecycle.checkHealth(), {
			postgres: 'UP',
			redis: 'UP',
		});
	});

	test('[S] shutdown closes the live connections without exiting (teardown)', needsBoth, async (t) => {
		const { DatabaseLifecycle } = use('lifecycle');
		t.mock.method(console, 'log', () => {});
		const exit = t.mock.method(process, 'exit', () => {});
		const closed = live.redis.status === 'end' ? null : once(live.redis, 'end');
		await DatabaseLifecycle.shutdown('TEST_TEARDOWN');
		assert.equal(exit.mock.callCount(), 0);
		await withTimeout(closed, 5000, 'Redis close');
		assert.equal(live.redis.status, 'end');
	});
});
