import { resolve } from 'node:path';
import { loadModules } from '../../utils/files/walk.js';

export async function eventcore(client) {
  const { app } = client;
  const directory = resolve(app.srcRoot, 'events');
  for (const { file, module: event } of await loadModules(directory)) {
    const names = event?.names ?? (event?.name ? [event.name] : []);
    if (names.length === 0 || typeof event.execute !== 'function') {
      app.logger.error(`[event] invalid event file: ${file}`);
      continue;
    }
    const listener = (...args) => event.execute(...args, client);
    for (const name of names) {
      if (event.once) client.once(name, listener);
      else client.on(name, listener);
      app.logger.info(`[event] loaded: ${name}`);
    }
  }
}
