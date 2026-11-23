import { SlashCommand } from 'micup.ts/easy';
import { deliverLeaderboard } from '../../../utils/levels/deliver.js';

export default {
  guildOnly: true,

  data: (app) =>
    new SlashCommand('leaderboard', app.describe('leaderboard.description'))
      .setDMPermission(false)
      .addInteger('page', app.describe('leaderboard.page.description'), { minValue: 1 }),

  async execute(interaction, context) {
    await interaction.deferReply({ ephemeral: false });
    const page = interaction.options.getInteger('page') ?? 1;
    await deliverLeaderboard(context, page);
  },
};
