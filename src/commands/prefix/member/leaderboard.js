import { parseInteger } from '../../../utils/args/args.js';
import { deliverLeaderboard } from '../../../utils/levels/deliver.js';

async function showTyping(channel) {
  try {
    await channel.sendTyping();
  } catch {
    return;
  }
}

export default {
  name: 'leaderboard',
  guildOnly: true,

  async run(client, message, args, context) {
    const page = args[0] === undefined ? 1 : parseInteger(args[0]);

    if (page === null) {
      const usage = `${context.prefix}${context.t('leaderboard.name')} [${context.t('leaderboard.page.name')}]`;
      await context.warning(context.t('errors.usage', { usage }));
      return;
    }

    await showTyping(message.channel);
    await deliverLeaderboard(context, page);
  },
};
