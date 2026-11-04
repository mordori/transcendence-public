import Redis from 'ioredis';
import { readFileSync } from 'node:fs';
import { registerRedisCommands } from '../database/redis-commands.js';

const getRedisPassword = () => {
	if (process.env.REDIS_PASSWORD_FILE) {
		try {
			return readFileSync(process.env.REDIS_PASSWORD_FILE, 'utf-8').trim();
		} catch {
			console.warn('Couldnt read REDIS_PASSWORD_FILE.')
		}
	}
	return undefined;
};

export const redis = new Redis({
	host: process.env.REDIS_HOST || 'localhost',
	port: Number(process.env.REDIS_PORT) || 6379,
	password: getRedisPassword(),
	maxRetriesPerRequest: 3,
	retryStrategy(times) {
		const delay = Math.min(times * 50, 2000);
		return delay;
	},
});

registerRedisCommands(redis);

redis.on('error', (err) => {
	console.error('Ioredis (backend redis client) error:', err.message);
});