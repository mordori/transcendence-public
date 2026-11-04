// Custom Lua commands loaded onto an ioredis client with defineCommand().
// Kept apart from config/redis.js (which opens a connection on import) so any
// client, including the DB test suite's, can register the same scripts.

export const redisCommands = {
	// a custom atomic Lua command to prevent the race condition of two players attempting to join simultaneously.
	// Rooms have no player cap (a spectator limit is not decided yet).
	// player:status inherits the room's TTL so it expires together with the room;
	// a room without a TTL is refused, so a status key is never written without one.
	joinPlayerAtomic: {
		numberOfKeys: 3,
		lua: `
			local roomKey = KEYS[1]
			local playersKey = KEYS[2]
			local statusKey = KEYS[3]

			local matchId = ARGV[1]
			local accountId = ARGV[2]

			-- the room may expire after the caller's existence check; never recreate it without a TTL
			if redis.call('EXISTS', roomKey) == 0 then
				return {0, "ROOM_NOT_FOUND"}
			end

			-- PTTL, not TTL: TTL rounds a remainder under 500 ms down to 0, which used to fall
			-- through to a status write with no expiry. A room in its last millisecond is
			-- treated as gone; -1 means the room never expires, which every room should.
			local pttl = redis.call('PTTL', roomKey)
			if pttl == 0 or pttl == -2 then
				return {0, "ROOM_NOT_FOUND"}
			end
			if pttl == -1 then
				return {0, "ROOM_HAS_NO_EXPIRY"}
			end

			local added = redis.call('SADD', playersKey, accountId)
			if added == 0 then
				return {0, "ALREADY_IN_ROOM"}
			end

			redis.call('HINCRBY', roomKey, 'playerCount', 1)

			redis.call('SET', statusKey, matchId, 'PX', pttl)

			return {1, "SUCCESS"}
		`,
	},

	// Atomic leave: the membership check and the decrement happen in one step, so two
	// concurrent leaves for the same player decrement playerCount only once.
	// Returns 1 if the player was removed, 0 if they were not a member.
	leavePlayerAtomic: {
		numberOfKeys: 3,
		lua: `
			local roomKey = KEYS[1]
			local playersKey = KEYS[2]
			local statusKey = KEYS[3]

			local accountId = ARGV[1]

			if redis.call('SREM', playersKey, accountId) == 0 then
				return 0
			end

			-- HINCRBY on an expired room would recreate it as a hash without a TTL
			if redis.call('EXISTS', roomKey) == 1 then
				redis.call('HINCRBY', roomKey, 'playerCount', -1)
			end
			redis.call('SET', statusKey, 'online')

			return 1
		`,
	},
};

export function registerRedisCommands(client) {
	for (const [name, definition] of Object.entries(redisCommands)) {
		client.defineCommand(name, definition);
	}
}
