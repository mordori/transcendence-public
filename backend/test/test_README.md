# Authentication tests

These tests cover the first-session-wins login policy, HTTP routes,
PostgreSQL session storage, failure recovery, and login throttling.
Run them against a development database only, never production.

## Session policy

- Registration creates the account and signs it in.
- Each account has at most one session row in PostgreSQL.
- Correct credentials do not replace an unexpired, unrevoked session.
- A duplicate login returns HTTP 409 with this body and no Set-Cookie header:

```json
{
  "code": "ACCOUNT_ALREADY_LOGGED_IN",
  "error": "Account already logged in"
}
```

- The rejected request leaves the original session unchanged and usable.
- Incorrect credentials still return 401, without revealing session status.
- Login is allowed after logout or expiry; the inactive row can be reused.
- Authentication checks the token hash, expiry, and revocation status.
- Logout revokes only the presented token. Old tokens cannot revoke a newer session.
- Without an active session, two concurrent logins produce one success and one rejection.
- With an active session, both concurrent login attempts are rejected.

PostgreSQL is the only authentication-session authority. AuthService does
not read or write Redis session keys. Redis remains required for login
throttling and is used separately for room data.

## Run the focused integration and regression checks

From the repository root, start the dependencies and rebuild the image:

```bash
docker compose up -d postgres redis
docker compose build backend
docker compose ps -a postgres redis
```

Wait until both dependencies are running and healthy. Then run:

```bash
docker compose run --rm --no-deps --entrypoint sh backend -c '
  POSTGRES_PASSWORD="$(cat /run/secrets/postgres_password)"
  export DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}?schema=public&connection_limit=10&pool_timeout=10"

  REDIS_PASSWORD="$(cat /run/secrets/redis_password)"
  export REDIS_URL="redis://:${REDIS_PASSWORD}@${REDIS_HOST}:${REDIS_PORT}"

  for file in \
    test/auth.service.test.js \
    test/auth.routes.integration.test.js \
    test/auth.concurrent.test.js \
    test/auth.postgres-session.test.js \
    test/auth.single-session.test.js \
    test/login-throttle.test.js \
    test/auth.throttle.integration.test.js
  do
    node --test --test-concurrency=1 "$file" || exit 1
  done
'
```

Each file runs in a separate Node.js process. The loop stops at the first
failure. Rebuild the backend image after changing source or tests.
The normal backend container need not be running; these HTTP tests use
Fastify app.inject(), not a listening port. The temporary test container
is removed afterward. --no-deps prevents it from starting the game or bots.

Tests create unique disposable accounts and attempt to clean up their own
sessions, accounts, and throttling counters. Real passwords are read from
Docker secrets; do not paste secret values into this document.

If Redis hostname resolution fails, check that the service is running and
shares the Compose network. The Redis service name is redis.

## Focused coverage

| File | Checks | Expected tests |
| --- | --- | ---: |
| auth.service.test.js | Argon2id storage, public account data, duplicate rejection, unchanged original session, email normalization after logout, malformed tokens, stale-token logout, and revocation. | 1 |
| auth.routes.integration.test.js | Real registration and login routes, protected cookies, 401/409 handling, no cookie on rejection, session preservation, login after logout, and stale-token safety. | 1 |
| auth.concurrent.test.js | One success without an active session; two rejections with an existing active session. | 2 |
| auth.postgres-session.test.js | No Redis session commands, lifecycle and rejection, rollback after a real write, failed revocation without clearing cookies, and concurrent login. | 4 |
| auth.single-session.test.js | End-to-end policy regression, including expiry, concurrent HTTP logins, and one-row session storage. | 1 |
| login-throttle.test.js | Five allowed attempts, sixth blocked, independent email counters, and counter expiry. | 1 |
| auth.throttle.integration.test.js | Five 401 responses followed by a 429 for a nonexistent account. | 1 |

Expected total: 11 tests across seven reports, each with zero failures.
This is an expected count, not a claim that a particular run passed.
The single-session file contains one test with multiple assertions.

The shared auth-test-helpers.js module provides disposable-account cleanup,
connection shutdown, and cookie extraction. It is not a test file.

## Other tests in this directory

Run the health, mocked-route, password, and token-utility tests as well:

```bash
docker compose run --rm --no-deps --entrypoint node backend \
  --test --test-concurrency=1 \
  test/app.test.js \
  test/auth.routes.test.js \
  test/password.test.js \
  test/session-token.test.js
```

The mocked-route test checks header/body validation, cookie protections,
active-session error mapping, and logout. Its fake service does not prove
database locking; the real concurrency tests cover that separately.

cache-auth-session.test.js exercises legacy Redis session helper methods,
not AuthService's session authority. It is not evidence that browser
login should write Redis session keys. Do not remove that file or the
helpers without checking remaining callers; it needs Redis credentials
using the same environment setup as the focused command above.

## Expected logs

Fastify request logs are normal. Duplicate-login tests intentionally return
409, wrong-password and revoked-token checks return 401, and throttling
returns 429. Rejected logins should not become unexpected HTTP 500 errors.

The failed-revocation regression intentionally produces HTTP 500 with
SIMULATED_REVOCATION_FAILURE. It passes only when logout does not clear
the cookie and the original session remains usable.

The rollback regression revokes the initial session before injecting a
failure after createOrReplace performs a real write. It checks that the
write was reached, the previous revoked row is restored, and a later
legitimate login still works. An active-session rejection would not test
that rollback path.

## Limitations

- Closing a browser or losing its cookie does not revoke the server session.
  The account can remain blocked until logout or expiry. Session recovery
  is separate work.
- Multiple tabs can share one valid cookie; this policy rejects new logins,
  not every additional tab or game connection.
- These tests do not verify browser UI behavior, actual browser cookie
  handling, game authentication, or revocation of open WebSockets.
- Game authorization must use the PostgreSQL-backed session authority
  rather than trusting legacy Redis session keys or development identities.
- Infrastructure failure coverage is selected, not exhaustive; process
  crashes and ambiguous transaction-commit failures are not covered.
- Login throttling still depends on Redis and is per normalized email.

Update test descriptions and expected counts when adding or splitting tests.
This document supplements the project-root README.
