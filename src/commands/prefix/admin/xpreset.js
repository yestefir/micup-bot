import { Permission } from 'micup.ts';
import { parseUserId } from '../../../utils/args/args.js';
import { resetXpView } from '../../../utils/levels/admin.js';

export default {
  name: 'xpreset',
  guildOnly: true,
  permission: Permission.ManageGuild,

  async run(client, message, args, context) {
    const userId = parseUserId(args[0]);

    if (!userId) {
      const usage = `${context.prefix}${context.t('xpreset.name')} <${context.t('xpreset.user.name')}>`;
      await context.warning(context.t('errors.usage', { usage }));
      return;
    }

    const { type, text } = resetXpView(context, userId);
    await context.send(type, text);
  },
};
