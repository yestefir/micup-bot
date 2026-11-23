import { Permission, SlashCommand } from 'micup.ts/easy';
import { adjustXpView } from '../../../utils/levels/admin.js';

export default {
  guildOnly: true,
  permission: Permission.ManageGuild,

  data: (app) =>
    new SlashCommand('xpadjust', app.describe('xpadjust.description'))
      .setDefaultMemberPermissions(Permission.ManageGuild)
      .setDMPermission(false)
      .addUser('user', app.describe('xpadjust.user.description'), { required: true })
      .addInteger('amount', app.describe('xpadjust.amount.description'), { required: true }),

  async execute(interaction, context) {
    const userId = interaction.options.getUser('user', true).id;
    const { type, text } = adjustXpView(context, userId, interaction.options.getInteger('amount', true));
    await context.send(type, text);
  },
};
