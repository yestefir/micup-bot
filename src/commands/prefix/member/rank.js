import { parseUserId } from '../../../utils/args/args.js';
import { deliverRank, resolveUser } from '../../../utils/levels/deliver.js';

export default {
  name: 'rank',
  guildOnly: true,

  async run(client, message, args, context) {
    const targetId = args[0] ? parseUserId(args[0]) : message.author.id;

    if (!targetId) {
      const usage = `${context.prefix}${context.t('rank.name')} [${context.t('rank.user.name')}]`;
      await context.warning(context.t('errors.usage', { usage }));
      return;
    }

    const user = targetId === message.author.id ? message.author : await resolveUser(client, message, targetId);
    await deliverRank(context, user);
  },
};
