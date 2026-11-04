import { prisma } from '../config/prisma.js';
import { redis } from '../config/redis.js';

export class DatabaseLifecycle {
	/**
	 * Init connections to postgres and redis.
	 */
	static async init() {
		console.log('Connecting to Postgres and Redis');

		//postgres init
		await prisma.$connect();
		await prisma.$queryRaw`SELECT  1`;
		console.log('Postgres connected succesfully');

		//redis init
		const redisPong = await redis.ping();
		if (redisPong !== 'PONG') {
			throw new Error('Redis ping failed');
		}
		console.log('Redis connected succesfully');
	}

	/**
	 * Health check both DBs.
	 */
	static async checkHealth() {
		try {
			await prisma.$queryRaw`SELECT 1`;
		} catch (error) {
			return {
				postgres: 'DOWN',
				redis: 'UNKNOWN',
				error: error.message,
			};
		}

		try {
			const redisStatus = await redis.ping();
			return {
				postgres: 'UP',
				redis: redisStatus === 'PONG' ? 'UP' : 'DOWN',
			};
		} catch (error) {
			return {
				postgres: 'UP',
				redis: 'DOWN',
				error: error.message,
			};
		}
	}

	/**
	 * Graceful shutdown of both DBs.
	 * Both clients are closed even if one fails; the failure is rethrown so the
	 * caller (server.js) decides the exit code.
	 */
	static async shutdown(signal) {
		console.log(`${signal} received. Closing database connections`);

		const results = await Promise.allSettled([
			prisma.$disconnect(),
			redis.quit(),
		]);
		const failure = results.find((result) => result.status === 'rejected');
		if (failure) {
			console.error('Error during database shutdown:', failure.reason.message);
			throw failure.reason;
		}
		console.log('Databases shut down cleanly');
	}
}
