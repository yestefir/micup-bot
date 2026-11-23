import { Permission } from 'micup.ts';
import { parseUserId } from '../../../utils/args/args.js';
import { startBanSession } from '../../../utils/moderation/ban-session.js';

export default {
  name: 'ban',
  guildOnly: true,
  permission: Permission.BanMembers,
  botPermission: Permission.BanMembers,

  async run(client, message, args, context) {
    const targetId = parseUserId(args[0]);

    if (!targetId) {
      const usage = `${context.prefix}${context.t('ban.name')} <${context.t('ban.user.name')}>`;
      await context.warning(context.t('errors.usage', { usage }));
      return;
    }

    await startBanSession(context, { actor: message.member, targetId });
  },
};
