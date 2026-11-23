import { SlashCommand } from 'micup.ts/easy';
import { deliverRank } from '../../../utils/levels/deliver.js';

export default {
  guildOnly: true,

  data: (app) =>
    new SlashCommand('rank', app.describe('rank.description'))
      .setDMPermission(false)
      .addUser('user', app.describe('rank.user.description')),

  async execute(interaction, context) {
    await interaction.deferReply({ ephemeral: false });
    const user = interaction.options.getUser('user') ?? interaction.user;
    await deliverRank(context, user);
  },
};
