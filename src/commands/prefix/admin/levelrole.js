import { Permission } from 'micup.ts';
import { parseInteger, parseRoleId } from '../../../utils/args/args.js';
import { levelRewardView } from '../../../utils/levels/admin.js';

export default {
  name: 'levelrole',
  guildOnly: true,
  permission: Permission.ManageGuild,

  async run(client, message, args, context) {
    const level = args[0] === undefined ? null : parseInteger(args[0]);
    const roleId = args[1] === undefined ? undefined : parseRoleId(args[1]);

    if ((args[0] !== undefined && level === null) || (args[1] !== undefined && !roleId)) {
      const usage = `${context.prefix}${context.t('levelrole.name')} [${context.t('levelrole.level.name')}] [${context.t('levelrole.role.name')}]`;
      await context.warning(context.t('errors.usage', { usage }));
      return;
    }

    const { type, text, options } = levelRewardView(context, level, roleId);
    await context.send(type, text, options);
  },
};
