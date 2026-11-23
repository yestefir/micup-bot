import { SlashCommand } from 'micup.ts/easy';
import { avatarView } from '../../../utils/info/views.js';

export default {
  data: (app) => new SlashCommand('avatar', app.describe('avatar.description')).addUser('user', app.describe('avatar.user.description')),

  async execute(interaction, context) {
    await interaction.deferReply({ ephemeral: false });
    const user = interaction.options.getUser('user') ?? interaction.user;
    const { type, text, options } = avatarView(context, user);
    await context.send(type, text, { ...options, ephemeral: false });
  },
};
