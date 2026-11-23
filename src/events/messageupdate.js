import { moderateMessage } from '../utils/moderation/automod.js';

export default {
  name: 'messageUpdate',
  once: false,
  async execute(update, client) {
    if (typeof update.content !== 'string') return;
    if (!update.guildId && !client.channels.get(update.channelId)?.guildId) return;
    const cached = update.message;
    const message = cached?.guildId ? cached : await update.fetch().catch(() => null);
    if (message) await moderateMessage(message, client, { edited: true });
  },
};
