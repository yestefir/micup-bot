import { Permission } from 'micup.ts';
import { parseInteger, parseUserId } from '../../../utils/args/args.js';
import { adjustXpView } from '../../../utils/levels/admin.js';

export default {
  name: 'xpadjust',
  guildOnly: true,
  permission: Permission.ManageGuild,

  async run(client, message, args, context) {
    const userId = parseUserId(args[0]);
    const amount = parseInteger(args[1]);

    if (!userId || amount === null) {
      const usage = `${context.prefix}${context.t('xpadjust.name')} <${context.t('xpadjust.user.name')}> <${context.t('xpadjust.amount.name')}>`;
      await context.warning(context.t('errors.usage', { usage }));
      return;
    }

    const { type, text } = adjustXpView(context, userId, amount);
    await context.send(type, text);
  },
};
