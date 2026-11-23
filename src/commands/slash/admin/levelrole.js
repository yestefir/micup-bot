import { Permission, SlashCommand } from 'micup.ts/easy';
import { levelRewardView } from '../../../utils/levels/admin.js';

export default {
  guildOnly: true,
  permission: Permission.ManageGuild,

  data: (app) =>
    new SlashCommand('levelrole', app.describe('levelrole.description'))
      .setDefaultMemberPermissions(Permission.ManageGuild)
      .setDMPermission(false)
      .addInteger('level', app.describe('levelrole.level.description'))
      .addRole('role', app.describe('levelrole.role.description')),

  async execute(interaction, context) {
    const level = interaction.options.getInteger('level');
    const role = interaction.options.getRole('role');
    const { type, text, options } = levelRewardView(context, level, role?.id);
    await context.send(type, text, options);
  },
};
