//a so called "key factory" for redis
// templates for game state
export const RedisKeys = {
	roomKey: (matchId) => `room:${matchId}`,
	roomPlayersKey: (matchId) => `room:${matchId}:players`,

	roomSpectatorsKey: (matchId) => `room:${matchId}:spectators`,
	roomSlotsKey: (matchId) => `room:${matchId}:slots`,
	roomPresenceKey: (matchId) => `room:${matchId}:presence`, //accountIds with a live game socket; written by the game server
	gameEventsStream: () => `game:events`, //player_left / room_closed facts reported by the game server

	sessionKey: (token) => `session:${token}`,
	gameTicketKey: (matchId, ticket) => `game_ticket:${matchId}:${ticket}`,
	playerStatusKey: (accountId) => `player:status:${accountId}`,

	allRoomsKey: () => `rooms:active`, //set of all matchIds; listActiveRooms prunes expired ones
};