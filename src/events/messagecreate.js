import { handleMessageXp } from '../utils/levels/service.js';
import { moderateMessage } from '../utils/moderation/automod.js';

export default {
  name: 'messageCreate',
  once: false,
  async execute(message, client) {
    if (await moderateMessage(message, client)) return;
    await Promise.all([
      client.interactions.prefix.handleMessage(message),
      handleMessageXp({ app: client.app, client, message }),
    ]);
  },
};
