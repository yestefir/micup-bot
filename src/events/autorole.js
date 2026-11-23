import { giveAutoRoles } from '../utils/autorole/service.js';

export default {
  name: 'guildMemberAdd',
  once: false,
  async execute(member, client) {
    await giveAutoRoles({ app: client.app, client, member });
  },
};
