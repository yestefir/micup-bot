import { SlashCommand } from 'micup.ts/easy';
import { serverInfoView } from '../../../utils/info/views.js';

export default {
  guildOnly: true,

  data: (app) => new SlashCommand('serverinfo', app.describe('serverinfo.description')).setDMPermission(false),

  async execute(interaction, context) {
    const { type, text, options } = serverInfoView(context);
    await context.send(type, text, { ...options, ephemeral: false });
  },
};
