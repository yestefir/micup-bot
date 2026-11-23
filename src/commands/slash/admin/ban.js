import { Permission, SlashCommand } from 'micup.ts/easy';
import { startBanSession } from '../../../utils/moderation/ban-session.js';

export default {
  guildOnly: true,
  permission: Permission.BanMembers,
  botPermission: Permission.BanMembers,

  data: (app) =>
    new SlashCommand('ban', app.describe('ban.description'))
      .setDefaultMemberPermissions(Permission.BanMembers)
      .setDMPermission(false)
      .addUser('user', app.describe('ban.user.description'), { required: true }),

  async execute(interaction, context) {
    await interaction.deferReply({ ephemeral: false });
    const targetId = interaction.options.getUser('user', true).id;
    await startBanSession(context, { actor: interaction.member, targetId });
  },
};
