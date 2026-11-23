import { SlashCommand } from 'micup.ts/easy';
import { pingView } from '../../../utils/message/ping.js';

export default {
  data: (app) => new SlashCommand('ping', app.describe('ping.description')),

  async execute(interaction, context) {
    const { type, text } = pingView(context, interaction.createdAt);
    await context.send(type, text, { ephemeral: false });
  },
};
