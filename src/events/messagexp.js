import { handleMessageXp } from '../utils/levels/service.js';

export default {
  name: 'messageCreate',
  once: false,
  async execute(message, client) {
    await handleMessageXp({ app: client.app, client, message });
  },
};
