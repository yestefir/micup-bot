import { handleTagUpdate } from '../utils/guildtag/service.js';

export default {
  names: ['GUILD_MEMBER_ADD', 'GUILD_MEMBER_UPDATE', 'USER_UPDATE'],
  once: false,
  async execute(data, event, client) {
    if (event?.name === 'USER_UPDATE') {
      await handleTagUpdate({ app: client.app, client, user: data });
      return;
    }
    await handleTagUpdate({ app: client.app, client, user: data.user, eventGuildId: data.guild_id, roles: data.roles });
  },
};
