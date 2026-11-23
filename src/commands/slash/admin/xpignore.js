import { Permission, SlashCommand } from 'micup.ts/easy';
import { ignoreChannelView } from '../../../utils/levels/admin.js';

export default {
  guildOnly: true,
  permission: Permission.ManageGuild,

  data: (app) =>
    new SlashCommand('xpignore', app.describe('xpignore.description'))
      .setDefaultMemberPermissions(Permission.ManageGuild)
      .setDMPermission(false)
      .addChannel('channel', app.describe('xpignore.channel.description')),

  async execute(interaction, context) {
    const channelId = interaction.options.getChannel('channel')?.id ?? interaction.channelId;
    const { type, text, options } = ignoreChannelView(context, channelId);
    await context.send(type, text, options);
  },
};
