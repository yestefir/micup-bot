import { sendWelcome } from '../utils/welcome/service.js';

export default {
  name: 'guildMemberAdd',
  once: false,
  async execute(member, client) {
    await sendWelcome({ app: client.app, client, member });
  },
};
