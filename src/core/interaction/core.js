import Prefix from './src/prefix.js';
import Slash from './src/slash.js';

export class Interactions {
  constructor(client, app) {
    this.client = client;
    this.app = app;
    this.initialized = false;
    this.prefix = new Prefix(client, app);
    this.slash = new Slash(client, app);
  }

  async initialize() {
    if (this.initialized) return;
    await this.slash.initialize();
    await this.prefix.initialize();
    this.initialized = true;
    this.app.logger.info(`[core] slash: ${this.slash.commands.size}, prefix: ${this.prefix.commands.size}`);
  }

  register() {
    return this.slash.register();
  }
}
