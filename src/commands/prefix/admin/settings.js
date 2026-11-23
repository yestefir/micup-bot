import { Permission } from 'micup.ts';
import { openSettingsPanel } from '../../../utils/settings/editor.js';

export default {
  name: 'settings',
  guildOnly: true,
  permission: Permission.ManageGuild,

  async run(client, message, args, context) {
    await openSettingsPanel(context, { actor: message.member });
  },
};
