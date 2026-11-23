import { Permission, SlashCommand } from 'micup.ts/easy';
import { resetXpView } from '../../../utils/levels/admin.js';

export default {
  guildOnly: true,
  permission: Permission.ManageGuild,

  data: (app) =>
    new SlashCommand('xpreset', app.describe('xpreset.description'))
      .setDefaultMemberPermissions(Permission.ManageGuild)
      .setDMPermission(false)
      .addUser('user', app.describe('xpreset.user.description'), { required: true }),

  async execute(interaction, context) {
    const { type, text } = resetXpView(context, interaction.options.getUser('user', true).id);
    await context.send(type, text);
  },
};
