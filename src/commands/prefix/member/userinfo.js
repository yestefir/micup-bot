import { parseUserId } from '../../../utils/args/args.js';
import { userInfoView } from '../../../utils/info/views.js';
import { resolveUser } from '../../../utils/levels/deliver.js';

export default {
  name: 'userinfo',
  guildOnly: true,

  async run(client, message, args, context) {
    const targetId = args[0] ? parseUserId(args[0]) : message.author.id;

    if (!targetId) {
      const usage = `${context.prefix}${context.t('userinfo.name')} [${context.t('userinfo.user.name')}]`;
      await context.warning(context.t('errors.usage', { usage }));
      return;
    }

    const user = targetId === message.author.id ? message.author : await resolveUser(client, message, targetId);
    const { type, text, options } = await userInfoView(context, user);
    await context.send(type, text, options);
  },
};
