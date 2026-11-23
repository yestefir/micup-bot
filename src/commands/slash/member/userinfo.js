import { SlashCommand } from 'micup.ts/easy';
import { userInfoView } from '../../../utils/info/views.js';

export default {
  guildOnly: true,

  data: (app) =>
    new SlashCommand('userinfo', app.describe('userinfo.description'))
      .setDMPermission(false)
      .addUser('user', app.describe('userinfo.user.description')),

  async execute(interaction, context) {
    await interaction.deferReply({ ephemeral: false });
    const user = interaction.options.getUser('user') ?? interaction.user;
    const { type, text, options } = await userInfoView(context, user);
    await context.send(type, text, { ...options, ephemeral: false });
  },
};
