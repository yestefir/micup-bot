export default {
  name: 'ready',
  once: true,
  async execute(ready, client) {
    client.app.logger.info(`${client.user.tag} online, servers: ${client.guildCount}`);
    void client.app.voiceChannels.restoreConfigured(client);
  },
};
