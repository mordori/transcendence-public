import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

// Prisma 7 connects through a driver adapter; the URL is built by docker-entrypoint.sh.
export const prisma = new PrismaClient({
	adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
	log: process.env.NODE_ENV === 'development'
		? ['query', 'error', 'warn']
		: ['error'],
});
