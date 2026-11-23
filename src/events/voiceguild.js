export default {
  names: ['guildCreate', 'shardReady', 'shardResume'],
  once: false,
  async execute(source, client) {
    if (!client.ready) return;
    if (typeof source === 'number') {
      await client.app.voiceChannels.restoreConfigured(client);
    } else if (!source.raw?.unavailable) {
      await client.app.voiceChannels.restore(client, source.id);
    }
  },
};
