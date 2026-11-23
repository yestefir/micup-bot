import { resolve } from 'node:path';
import { loadModules } from '../../../utils/files/walk.js';
import { attachResponder, messageTarget } from '../../../utils/message/response.js';
import { createContext } from './context.js';
import { checkAccess } from './guard.js';

export default class Prefix {
  constructor(client, app) {
    this.client = client;
    this.app = app;
    this.commands = new Map();
    this.index = new Map();
  }

  async initialize() {
    this.commands.clear();
    this.index.clear();
    const directory = resolve(this.app.srcRoot, 'commands/prefix');
    for (const { file, module: command } of await loadModules(directory)) {
      if (!command?.name || typeof command.run !== 'function') {
        this.app.logger.error(`[prefix] invalid command file: ${file}`);
        continue;
      }
      this.commands.set(command.name, command);
      const names = new Set([command.name, ...(command.aliases ?? []), ...this.app.i18n.names(command.name)]);
      for (const name of names) this.index.set(name.toLowerCase(), command);
    }
  }

  async handleMessage(message) {
    if (message.author.bot || message.fromSelf) return;

    const context = createContext(this.app, this.client, { guildId: message.guildId });
    if (!message.content.startsWith(context.prefix)) return;

    const args = message.content.slice(context.prefix.length).trim().split(/\s+/);
    const command = this.index.get((args.shift() ?? '').toLowerCase());
    if (!command) return;

    attachResponder(context, messageTarget(message));

    const denied = checkAccess(command, {
      client: this.client,
      guildId: message.guildId,
      channelId: message.channelId,
      member: message.member,
      context,
    });
    if (denied) {
      await context.error(denied).catch(() => {});
      return;
    }

    try {
      await command.run(this.client, message, args, context);
    } catch (error) {
      this.app.logger.error(`[prefix] ${command.name} failed:`, error);
      await context.error(context.t('errors.generic')).catch(() => {});
    }
  }
}
