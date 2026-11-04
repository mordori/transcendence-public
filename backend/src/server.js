// backend/src/server.js
import { startGameEventsConsumer } from './services/game-events.consumer.js';
import { buildApp } from './app.js';
import { DatabaseLifecycle } from './database/lifecycle.js';

const app = buildApp();

// Applies the game server's player_left / room_closed reports. Started here, not in
// buildApp(), so tests using app.inject() don't open a blocking Redis reader.
let stopGameEventsConsumer;
app.addHook('onReady', async () => {
  stopGameEventsConsumer = startGameEventsConsumer(app.log);
});
app.addHook('onClose', async () => {
  await stopGameEventsConsumer?.();
});

const port = Number(process.env.PORT || 3000);

// app.close() stops accepting connections and waits for in-flight requests;
// the databases are closed only after that.
app.addHook('onClose', async () => {
  await DatabaseLifecycle.shutdown('HTTP server closed');
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info(`${signal} received. Shutting down`);
  try {
    await app.close();
    process.exit(0);
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => shutdown(signal));
}

try {
  // Fail fast: refuse to serve requests if PostgreSQL or Redis is unreachable.
  await DatabaseLifecycle.init();
  // Listen on all container interfaces so the proxy can reach the API.
  await app.listen({ port, host: '0.0.0.0' });
} catch (error) {
  // Nothing is serving yet, so exit without draining; quit() could wait on a dead Redis.
  app.log.error(error);
  process.exit(1);
}
