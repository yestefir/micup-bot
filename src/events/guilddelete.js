export default {
  names: ['GUILD_DELETE'],
  once: false,
  async execute(data, event, client) {
    const guildId = data?.id;
    if (!guildId || data.unavailable) return;
    const { app } = client;
    app.settings.clear(guildId);
    app.levels.deleteGuild(guildId);
    app.guildTags.deleteGuild(guildId);
    app.logger.info(`[cleanup] removed stored data of ${guildId}`);
  },
};
