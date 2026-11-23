import { Permission } from 'micup.ts';
import { parseUserId } from '../../../utils/args/args.js';
import { startMuteSession } from '../../../utils/moderation/mute-session.js';

export default {
  name: 'mute',
  guildOnly: true,
  permission: Permission.ModerateMembers,
  botPermission: Permission.ModerateMembers,

  async run(client, message, args, context) {
    const targetId = parseUserId(args[0]);

    if (!targetId) {
      const usage = `${context.prefix}${context.t('mute.name')} <${context.t('mute.user.name')}>`;
      await context.warning(context.t('errors.usage', { usage }));
      return;
    }

    await startMuteSession(context, { actor: message.member, targetId });
  },
};
