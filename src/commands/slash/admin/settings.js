import { Permission, SlashCommand } from 'micup.ts/easy';
import { openSettingsPanel } from '../../../utils/settings/editor.js';

export default {
  guildOnly: true,
  permission: Permission.ManageGuild,

  data: (app) =>
    new SlashCommand('settings', app.describe('settings.description'))
      .setDefaultMemberPermissions(Permission.ManageGuild)
      .setDMPermission(false),

  async execute(interaction, context) {
    await openSettingsPanel(context, { actor: interaction.member });
  },
};
