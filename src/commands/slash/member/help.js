import { SlashCommand } from 'micup.ts/easy';
import { helpView } from '../../../utils/info/views.js';

export default {
  data: (app) => new SlashCommand('help', app.describe('help.description')),

  async execute(interaction, context) {
    const { type, text, options } = helpView(context);
    await context.send(type, text, { ...options, ephemeral: true });
  },
};
