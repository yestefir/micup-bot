import { Permission } from 'micup.ts';
import { parseChannelId } from '../../../utils/args/args.js';
import { ignoreChannelView } from '../../../utils/levels/admin.js';

export default {
  name: 'xpignore',
  guildOnly: true,
  permission: Permission.ManageGuild,

  async run(client, message, args, context) {
    const channelId = args[0] ? parseChannelId(args[0]) : message.channelId;

    if (!channelId) {
      const usage = `${context.prefix}${context.t('xpignore.name')} [${context.t('xpignore.channel.name')}]`;
      await context.warning(context.t('errors.usage', { usage }));
      return;
    }

    const { type, text, options } = ignoreChannelView(context, channelId);
    await context.send(type, text, options);
  },
};
