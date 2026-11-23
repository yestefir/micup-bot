import { Client } from 'micup.ts/easy';
import { createApp } from './app.js';
import { eventcore } from './core/event/eventcore.js';
import { Interactions } from './core/interaction/core.js';

const app = createApp();

if (!app.config.token) {
  app.logger.error('MICUP_BOT_TOKEN is not set. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const client = new Client({
  token: app.config.token,
  catalog: app.i18n.catalog(),
  registerCommands: false,
});

client.app = app;
client.interactions = new Interactions(client, app);

client.on('error', (error) => {
  app.logger.error(error);
});

process.on('unhandledRejection', (error) => {
  app.logger.error('Unhandled rejection:', error);
});

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  await client.destroy();
  app.settings.close();
  app.levels.close();
  app.guildTags.close();
  process.exit(0);
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

await eventcore(client);
await client.interactions.initialize();
await client.login();

try {
  await client.interactions.register();
} catch (error) {
  app.logger.error('[slash] command registration failed:', error);
}
