export default {
  name: 'voiceStateUpdate',
  once: false,
  execute(state, client) {
    if (state.guild_id && state.user_id === client.user?.id && state.channel_id === null) {
      client.app.voiceChannels.reconnect(client, state.guild_id);
    }
  },
};
