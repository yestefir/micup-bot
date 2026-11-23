export default {
  name: 'messageCreate',
  once: false,
  async execute(message, client) {
    await client.interactions.prefix.handleMessage(message);
  },
};
