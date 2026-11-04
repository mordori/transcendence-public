import { redis } from '../config/redis.js';
import { RedisKeys } from '../database/keys.js';
import argon2 from 'argon2';

// Minimum Argon2id cost: 19 MiB memory (KiB units), 1 pass, 1 lane.
const ROOM_PASSWORD_HASH_OPTIONS = {
	type: argon2.argon2id,
	memoryCost: 19456,
	timeCost: 1,
	parallelism: 1,
};

/*
// TO REFACTOR FOR TYPESCRIPT LATER:
interface createRoomOptions {
	serverAddress: string;
	maxCapacity?: number;
}
*/

//TODO in testing: check room expiration effect on all the concerned data:
//player status, room data, player/room set, slotsKey, spectatorsKey

// joinPlayerAtomic and leavePlayerAtomic (custom Lua commands) are defined in database/redis-commands.js

export const CacheRepository = {

/**
   * Creates a new game room in Redis.
   * @param {string} matchId - UUID of the game room
   * @param {Object} options
   * @param {string} options.hostId - Player ID of the room creator
   * @param {string} options.serverAddress - ip:port of the game server room
   * @param {number} options.maxCapacity - Stored for display only; joins are not capped (spectator limit undecided). Default is 6
   * @param {string} options.password - optional password. If not passed, there is no password (open publically)
   * @param {number} options.duration - Seconds. Duration of match. Game room expires after the set duration.
   * - matchId is the unique identifier for the match
   * - serverAddress is the address of the server hosting the match ('ip:port')
   * - playerCount is initialised to 1 because the host who creates a room immediately joins
   * - maxCapacity defaults to 6, unless an argument is passed.
   * - password is optional
   * - duration defaults to 3600 (1 hour) unless an argument is passed.
   */
	async createRoom(matchId, { hostId, serverAddress, name = matchId, maxCapacity = 6, password, duration = 7200 }) {
		const roomHashKey = RedisKeys.roomKey(matchId);
		const roomPlayerSetKey = RedisKeys.roomPlayersKey(matchId);
		const playerStatusHashKey = RedisKeys.playerStatusKey(hostId);

		let passwordHash = '';
		if (password) {
			passwordHash = await argon2.hash(password, ROOM_PASSWORD_HASH_OPTIONS);
		}

		const pipeline = redis.pipeline();

		pipeline.hset(roomHashKey, {
			matchId,
			name,
			hostId,
			serverAddress,
			playerCount: 1,
			maxCapacity: maxCapacity,
			passwordHash: passwordHash,
			startedAt: Date.now(),
		});

		pipeline.sadd(RedisKeys.allRoomsKey(), matchId);
		pipeline.sadd(roomPlayerSetKey, hostId);
		pipeline.set(playerStatusHashKey, matchId, 'EX', duration);

		//epiration out of cache in <duration> time, unless game room is refreshed.
		// slots/spectators don't exist yet, so these two EXPIREs are no-ops: whoever creates
		// those keys later (the game server's syncRedis) must copy the room's remaining TTL onto them.
		pipeline.expire(roomHashKey, duration);
		pipeline.expire(roomPlayerSetKey, duration);
		pipeline.expire(RedisKeys.roomSpectatorsKey(matchId), duration);
		pipeline.expire(RedisKeys.roomSlotsKey(matchId), duration);

		await pipeline.exec();

		return {
			matchId,
			maxCapacity,
			isPasswordProtected: !!password,
			duration: duration,
		};
	},

	/// Create an empty room:
	/// - matchId is the unique identifier for the match
	/// - serverAddress is the address of the server hosting the match ('ip:port')
	/// - playerCount is initialised to 0 because player joining is separate
	/// - maxCapacity defaults to 6, unless an argument is passed.
	/// - duration (seconds) defaults to 7200 like createRoom; joins refuse rooms without a TTL
	/// just pass matchId and serverAddress to create a new room, and use joinPlayerToRoom to add a player
	async createEmptyRoom(matchId, {serverAddress, maxCapacity = 6, duration = 7200 }) {
		const roomHashKey = RedisKeys.roomKey(matchId);

		const pipeline = redis.pipeline();

		pipeline.hset(roomHashKey, {
			matchId,
			serverAddress,
			playerCount: 0,
			maxCapacity: maxCapacity,
			startedAt: Date.now()
		});
		pipeline.expire(roomHashKey, duration);

		await pipeline.exec();

		return { matchId, serverAddress };
	},

	/// Get data for a room Room by ID
	/// - returns an object containing serverAddress, playerCount, and maxCapacity (no other data implemented yet)
	/// - returns NULL if room doesn't exit!
	async getRoom(matchId) {
		const roomHashKey = RedisKeys.roomKey(matchId);
		const data = await redis.hgetall(roomHashKey);

		return Object.keys(data).length > 0 ? data : null;
	},

	async listActiveRooms() {
		const activeKey = RedisKeys.allRoomsKey();
		const ids = await redis.smembers(activeKey);
		if (ids.length === 0) return [];

		const pipeline = redis.pipeline();
		for (const id of ids) {
			pipeline.hmget(RedisKeys.roomKey(id), 'name', 'playerCount', 'passwordHash');
		}
		const results = await pipeline.exec();

		const rooms = [];
		const stale = [];
		results.forEach(([err, values], i) => {
			if (err || !values || values[0] === null) { stale.push(ids[i]); return; }
			const [name, playerCount, passwordHash] = values;
			rooms.push({
			id: ids[i],
			name,
			locked: Boolean(passwordHash),
			playerCount: Number(playerCount),
			});
		});
		if (stale.length) await redis.srem(activeKey, ...stale);
		return rooms;
	},

	async getRoomPlayers(matchId) {
		const roomPlayerSetKey = RedisKeys.roomPlayersKey(matchId);
		const data = await redis.smembers(roomPlayerSetKey);

		return data;
	},

	async getPlayerStatus(accountId) {
		const playerStatusHashKey = RedisKeys.playerStatusKey(accountId);
		const data = await redis.get(playerStatusHashKey);

		return data;
	},

	/// Add a player into a Room:
	/// - Uses a custom ioredis command to atomically handle simultaneous requests to join (custom Lua script)
	/// - returns a string for the status of the attempt if SUCCESS
	/// - returns { success: false, status: 'ROOM_NOT_FOUND' } if the room is missing or expired
	/// - OR throws an error if status is ALREADY_IN_ROOM
	async joinPlayerToRoom(matchId, accountId) {
		const roomHashKey = RedisKeys.roomKey(matchId);
		const roomPlayerSetKey = RedisKeys.roomPlayersKey(matchId);
		const playerStatusHashKey = RedisKeys.playerStatusKey(accountId);

		const roomData = await redis.hgetall(roomHashKey);
		if (!roomData || !roomData.matchId) {
			return { success: false, status: 'ROOM_NOT_FOUND' };
		}

		const [code, status] = await redis.joinPlayerAtomic(
			roomHashKey,
			roomPlayerSetKey,
			playerStatusHashKey,
			matchId,
			accountId,
		)
		if (status === 'ROOM_NOT_FOUND') {
			return { success: false, status };
		}
		if (code === 0) {
			throw new Error(`Failed to join room: ${status}`)
		}

		return status;
	},

	async joinPlayerToRoomPassword({ matchId, accountId, password }) {
		const roomHashKey = RedisKeys.roomKey(matchId);
		const roomPlayerSetKey = RedisKeys.roomPlayersKey(matchId);
		const playerStatusHashKey = RedisKeys.playerStatusKey(accountId);

		const roomData = await redis.hgetall(roomHashKey);
		if (!roomData || !roomData.matchId) {
			return { success: false, status: 'ROOM_NOT_FOUND' };
		}

		if (roomData.passwordHash && roomData.passwordHash !== '') {
			if (!password) {
				return { success: false, status: 'PASSWORD_REQUIRED' };
			}

			const isPasswordValid = await argon2.verify(roomData.passwordHash, password);
			if (!isPasswordValid) {
				return { success: false, status: 'INVALID_PASSWORD' };
			}
		}

		const [code, status] = await redis.joinPlayerAtomic(
			roomHashKey,
			roomPlayerSetKey,
			playerStatusHashKey,
			matchId,
			accountId,
		);
		if (status === 'ROOM_NOT_FOUND') {
			return { success: false, status };
		}
		if (code === 0) {
			throw new Error(`Failed to join room: ${status}`)
		}

		return status;
	},

	/**
	 * Removes a player from room and cleans up player status
	 * - atomic (leavePlayerAtomic Lua), so a duplicate concurrent leave returns false
	 */
	async leavePlayerFromRoom(matchId, accountId) {
		const roomHashKey = RedisKeys.roomKey(matchId);
		const roomPlayerSetKey = RedisKeys.roomPlayersKey(matchId);
		const playerStatusHashKey = RedisKeys.playerStatusKey(accountId);

		const removed = await redis.leavePlayerAtomic(
			roomHashKey,
			roomPlayerSetKey,
			playerStatusHashKey,
			accountId.toString(),
		);
		return removed === 1;
	},

	/**
	 * Retrieves active driver slots set by C++ game server
	 */
	async getLiveDrivers(matchId) {
		const roomSlotsHashKey = RedisKeys.roomSlotsKey(matchId);

		return await redis.hgetall(roomSlotsHashKey);
	},

	/**
	 * Deletes a room and all its keys; called when the game server reports room_closed
	 * - a member's player:status is reset to 'online' (as in leavePlayerFromRoom) only if it still points to this room
	 * - idempotent: deleting a missing room is a no-op that returns false
	 */
	async deleteRoom(matchId) {
		const deleteRoomLua = `
			local matchId = ARGV[1]
			local statusPrefix = ARGV[2]

			for _, accountId in ipairs(redis.call('SMEMBERS', KEYS[2])) do
				local statusKey = statusPrefix .. accountId
				if redis.call('GET', statusKey) == matchId then
					redis.call('SET', statusKey, 'online')
				end
			end

			local deleted = redis.call('DEL', KEYS[1], KEYS[2], KEYS[3], KEYS[4], KEYS[5])
			redis.call('SREM', KEYS[6], matchId)
			return deleted
		`;

		const deleted = await redis.eval(
			deleteRoomLua,
			6,
			RedisKeys.roomKey(matchId),
			RedisKeys.roomPlayersKey(matchId),
			RedisKeys.roomSpectatorsKey(matchId),
			RedisKeys.roomSlotsKey(matchId),
			RedisKeys.roomPresenceKey(matchId),
			RedisKeys.allRoomsKey(),
			matchId,
			RedisKeys.playerStatusKey(''),
		);
		return deleted > 0;
	},

	/*
	 Can refresh the room's expiration timer to refresh the room for another match or an in-between lobby for example.
	 @param{string} matchId - game room UUID
	 @param{string} newDuration - new duration
	 */
	async refreshRoom(matchId, newDuration) {
		const roomKey = RedisKeys.roomKey(matchId);
		const roomExists = await redis.exists(roomKey);

		if (!roomExists) {
			throw new Error("ROOM_NOT_FOUND");
		}

		const players = await redis.smembers(RedisKeys.roomPlayersKey(matchId));

		const pipeline = redis.pipeline();
		pipeline.expire(roomKey, newDuration);
		pipeline.expire(RedisKeys.roomPlayersKey(matchId), newDuration);
		pipeline.expire(RedisKeys.roomSpectatorsKey(matchId), newDuration);
		pipeline.expire(RedisKeys.roomSlotsKey(matchId), newDuration);
		// player:status keys expire with the room, so extend them too
		for (const accountId of players) {
			pipeline.expire(RedisKeys.playerStatusKey(accountId), newDuration);
		}

		await pipeline.exec();

		return {
			matchId,
			refreshed: true,
			duration: newDuration,
		};
	},

	// Store a temporary lookup for the game server.
	// Example: session:<tokenHash> -> <playerAccountId>
	async saveAuthSession(tokenHash, playerAccountId, ttlSeconds) {
	  if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
		throw new Error('INVALID_SESSION_TTL');
	  }

	  const key = RedisKeys.sessionKey(tokenHash);
	  return redis.set(key, playerAccountId, 'EX', ttlSeconds);
	},

	async getAuthSessionAccountId(tokenHash) {
	  const key = RedisKeys.sessionKey(tokenHash);
	  return redis.get(key);
	},

	async saveGameTicket(matchId, ticket, playerInfo, ttlMilliseconds) {
	  if (!Number.isInteger(ttlMilliseconds) || ttlMilliseconds <= 0) {
		throw new Error('INVALID_GAME_TICKET_TTL');
	  }

	  const key = RedisKeys.gameTicketKey(matchId, ticket);
	  return redis.set(key, JSON.stringify(playerInfo), 'PX', ttlMilliseconds, 'NX');
	},

	async deleteAuthSession(tokenHash) {
	  const key = RedisKeys.sessionKey(tokenHash);
	  return redis.del(key);
	},


};
