import { Permission, SlashCommand } from 'micup.ts/easy';
import { startMuteSession } from '../../../utils/moderation/mute-session.js';

export default {
  guildOnly: true,
  permission: Permission.ModerateMembers,
  botPermission: Permission.ModerateMembers,

  data: (app) =>
    new SlashCommand('mute', app.describe('mute.description'))
      .setDefaultMemberPermissions(Permission.ModerateMembers)
      .setDMPermission(false)
      .addUser('user', app.describe('mute.user.description'), { required: true }),

  async execute(interaction, context) {
    await interaction.deferReply({ ephemeral: false });
    const targetId = interaction.options.getUser('user', true).id;
    await startMuteSession(context, { actor: interaction.member, targetId });
  },
};
