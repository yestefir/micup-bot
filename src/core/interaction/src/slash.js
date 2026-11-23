import { resolve } from 'node:path';
import { loadModules } from '../../../utils/files/walk.js';
import { attachResponder, interactionTarget } from '../../../utils/message/response.js';
import { createContext } from './context.js';
import { checkAccess } from './guard.js';
import { describeErrors, isFormError, registerOneByOne } from './register.js';

const list = (items) => (items.length > 0 ? items.join(', ') : '-');

export default class Slash {
  constructor(client, app) {
    this.client = client;
    this.app = app;
    this.commands = new Map();
    this.definitions = new Map();
  }

  async initialize() {
    this.commands.clear();
    this.definitions.clear();
    const directory = resolve(this.app.srcRoot, 'commands/slash');
    for (const { file, module: command } of await loadModules(directory)) {
      if (typeof command?.data !== 'function' || typeof command.execute !== 'function') {
        this.app.logger.error(`[slash] invalid command file: ${file}`);
        continue;
      }
      const builder = command.data(this.app);
      const definition = builder.toJSON();
      this.commands.set(definition.name, command);
      this.definitions.set(definition.name, definition);
      this.client.command(builder, (interaction) => this.handleInteraction(command, interaction));
    }

    if (!this.watching) {
      this.watching = true;
      this.client.on('interactionCreate', (interaction) => this.reportUnrouted(interaction));
    }
  }

  async reportUnrouted(interaction) {
    if (!interaction.isCommand?.() || this.commands.has(interaction.commandName)) return;

    this.app.logger.warn(
      `[slash] no handler for "${interaction.commandName}", known commands: ${list([...this.commands.keys()])}`,
    );
    const context = createContext(this.app, this.client, {
      guildId: interaction.guildId,
      locale: interaction.locale,
    });
    attachResponder(context, interactionTarget(interaction));
    await context.error(context.t('errors.unknownCommand')).catch(() => {});
  }

  async register() {
    const { guildId } = this.app.config;
    const scope = guildId ? `guild ${guildId}` : 'global';

    try {
      const result = await this.client.registerCommands({ guildId, prune: true });
      const summary = ['created', 'updated', 'deleted']
        .map((kind) => `${kind}: ${list(result[kind])}`)
        .join(' | ');
      this.app.logger.info(`[slash] ${scope} | ${summary} | unchanged: ${result.unchanged.length}`);
      return result;
    } catch (error) {
      if (!isFormError(error)) throw error;
      this.app.logger.warn(`[slash] bulk registration rejected (${describeErrors(error)}), registering one by one`);
    }

    const summary = await registerOneByOne({
      client: this.client,
      app: this.app,
      definitions: [...this.definitions.values()],
      guildId,
    });
    const partial = Object.entries(summary.partial).map(([name, locales]) => `${name} (without ${locales.join(', ')})`);
    this.app.logger.info(
      `[slash] ${scope} | one by one | registered: ${list(summary.registered)} | partial: ${list(partial)} | failed: ${list(summary.failed)} | deleted: ${list(summary.deleted)}`,
    );
    return summary;
  }

  async handleInteraction(command, interaction) {
    const context = createContext(this.app, this.client, {
      guildId: interaction.guildId,
      locale: interaction.locale,
    });
    attachResponder(context, interactionTarget(interaction));

    const denied = checkAccess(command, {
      client: this.client,
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      member: interaction.member,
      context,
    });
    if (denied) {
      await context.error(denied);
      return;
    }

    try {
      await command.execute(interaction, context);
    } catch (error) {
      this.app.logger.error(`[slash] ${interaction.commandName} failed:`, error);
      await context.error(context.t('errors.generic')).catch(() => {});
    }
  }
}
