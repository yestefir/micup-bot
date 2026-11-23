import { Permission } from 'micup.ts';
import { parseInteger, parseUserId } from '../../../utils/args/args.js';
import { purgeMessages } from '../../../utils/purge/purge.js';

const NOTICE_TTL_MS = 5000;

export default {
  name: 'purge',
  guildOnly: true,
  permission: Permission.ManageMessages,
  botPermission: Permission.ManageMessages,

  async run(client, message, args, context) {
    const amount = parseInteger(args[0]);
    const userId = args[1] ? parseUserId(args[1]) : undefined;

    if (amount === null || amount < 1 || (args[1] && !userId)) {
      const usage = `${context.prefix}${context.t('purge.name')} <${context.t('purge.amount.name')}> [${context.t('purge.user.name')}]`;
      await context.warning(context.t('errors.usage', { usage }));
      return;
    }

    const max = context.settings.get(message.guildId, 'purge.maxAmount');
    if (amount > max) {
      await context.warning(context.t('purge.msg.tooMany', { max }));
      return;
    }

    await message.delete().catch(() => {});
    const count = await purgeMessages({ channel: message.channel, amount, userId, before: message.id });
    const notice = { reply: false, ttl: NOTICE_TTL_MS };
    if (count === 0) await context.info(context.t('purge.msg.nothing'), notice);
    else await context.success(context.t('purge.msg.done', { count }), notice);
  },
};
