import os from 'node:os';
import { redis } from '../config/redis.js';
import { RedisKeys } from '../database/keys.js';
import { CacheRepository } from '../repositories/cache.repository.js';

// Applies the facts the game server reports on the game:events stream
// (game/server/src/server_network.cpp: flushDirtyRooms and notifyRoomClosed).
// Handlers must be idempotent: an entry whose XACK was lost is delivered again.

const GROUP = 'backend';
const CONSUMER = os.hostname();
const BATCH = 50;
const BLOCK_MS = 5000;
const CLAIM_IDLE_MS = 60_000; // entries left unacknowledged this long are retried
const RETRY_DELAY_MS = 1000;

// A malformed event resolves to a no-op so it is acknowledged instead of retried forever.
const handlers = {
	player_left: ({ room, account }) => room && account && CacheRepository.leavePlayerFromRoom(room, account),
	room_closed: ({ room }) => room && CacheRepository.deleteRoom(room),
};

function toEvent(fields) {
	const event = {};
	for (let i = 0; i + 1 < fields.length; i += 2) {
		event[fields[i]] = fields[i + 1];
	}
	return event;
}

/**
 * Starts reading game:events with the consumer group 'backend'.
 * @param {import('fastify').FastifyBaseLogger} log
 * @returns {() => Promise<void>} stops the consumer
 */
export function startGameEventsConsumer(log) {
	const stream = RedisKeys.gameEventsStream();
	// a blocking XREADGROUP would stall every other command on the shared client
	const conn = redis.duplicate();
	let running = true;
	let groupReady = false;
	let lastClaim = 0;

	async function ensureGroup() {
		try {
			await conn.xgroup('CREATE', stream, GROUP, '$', 'MKSTREAM');
		} catch (err) {
			if (!String(err.message).includes('BUSYGROUP')) throw err;
		}
		groupReady = true;
	}

	async function apply(entries) {
		for (const entry of entries) {
			// XAUTOCLAIM on Redis < 7 returns null for entries trimmed by MAXLEN
			if (!entry) continue;
			const [id, fields] = entry;
			const event = toEvent(fields);
			try {
				await handlers[event.type]?.(event);
				await conn.xack(stream, GROUP, id);
			} catch (err) {
				log.error({ err, event }, 'game event failed; it will be retried');
			}
		}
	}

	// Takes over entries that failed here or that a stopped consumer never acknowledged.
	async function reclaim() {
		let cursor = '0-0';
		do {
			const [next, entries] = await conn.xautoclaim(stream, GROUP, CONSUMER, CLAIM_IDLE_MS, cursor, 'COUNT', BATCH);
			await apply(entries);
			cursor = next;
		} while (running && cursor !== '0-0');
	}

	async function run() {
		while (running) {
			try {
				if (!groupReady) await ensureGroup();
				if (Date.now() - lastClaim >= CLAIM_IDLE_MS) {
					lastClaim = Date.now();
					await reclaim();
				}
				const result = await conn.xreadgroup(
					'GROUP', GROUP, CONSUMER, 'COUNT', BATCH, 'BLOCK', BLOCK_MS, 'STREAMS', stream, '>',
				);
				for (const [, entries] of result ?? []) {
					await apply(entries);
				}
			} catch (err) {
				if (!running) break;
				// the stream or group is gone, e.g. Redis lost its data
				if (String(err.message).includes('NOGROUP')) groupReady = false;
				log.error({ err }, 'game events consumer error; retrying');
				await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
			}
		}
	}

	run();

	return async () => {
		running = false;
		// disconnect, not quit: QUIT would wait behind the blocking XREADGROUP
		conn.disconnect();
	};
}
