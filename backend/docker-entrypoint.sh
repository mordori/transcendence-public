#!/bin/sh
set -e

# construct database_url for prisma->postgres connection
if [ -f /run/secrets/postgres_password ]; then
	POSTGRES_PASSWORD=$(cat /run/secrets/postgres_password)
	export DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}?schema=public&connection_limit=10&pool_timeout=10"
fi

# construct redis_url for ioredis->redis connection
if [ -f /run/secrets/redis_password ]; then
	REDIS_PASSWORD=$(cat /run/secrets/redis_password)
	export REDIS_URL="redis://:${REDIS_PASSWORD}@${REDIS_HOST}:${REDIS_PORT}"
fi

# regenerate js client to register new schema models
npx prisma generate

# sync schema-based database tables into pg
npx prisma db push --accept-data-loss

# run the DB tests and write the report to the 'logs' volume (mounted);
TEST_REPORT_DIR=/app/logs node src/utils/DB-test-reporter.js || true

# PID 1 to Node.js for graceful shutdowns
exec "$@"