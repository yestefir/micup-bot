import { parseUserId } from '../../../utils/args/args.js';
import { avatarView } from '../../../utils/info/views.js';
import { resolveUser } from '../../../utils/levels/deliver.js';

export default {
  name: 'avatar',

  async run(client, message, args, context) {
    const targetId = args[0] ? parseUserId(args[0]) : message.author.id;

    if (!targetId) {
      const usage = `${context.prefix}${context.t('avatar.name')} [${context.t('avatar.user.name')}]`;
      await context.warning(context.t('errors.usage', { usage }));
      return;
    }

    const user = targetId === message.author.id ? message.author : await resolveUser(client, message, targetId);
    const { type, text, options } = avatarView(context, user);
    await context.send(type, text, options);
  },
};
