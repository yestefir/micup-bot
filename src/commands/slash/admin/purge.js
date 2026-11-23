import { Permission, SlashCommand } from 'micup.ts/easy';
import { purgeMessages } from '../../../utils/purge/purge.js';

export default {
  guildOnly: true,
  permission: Permission.ManageMessages,
  botPermission: Permission.ManageMessages,

  data: (app) =>
    new SlashCommand('purge', app.describe('purge.description'))
      .setDefaultMemberPermissions(Permission.ManageMessages)
      .setDMPermission(false)
      .addInteger('amount', app.describe('purge.amount.description'), { required: true, minValue: 1 })
      .addUser('user', app.describe('purge.user.description')),

  async execute(interaction, context) {
    const amount = interaction.options.getInteger('amount', true);
    const userId = interaction.options.getUser('user')?.id;

    const max = context.settings.get(interaction.guildId, 'purge.maxAmount');
    if (amount > max) {
      await context.warning(context.t('purge.msg.tooMany', { max }));
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    const channel = interaction.channel ?? (await context.client.channels.fetch(interaction.channelId));
    const count = await purgeMessages({ channel, amount, userId });
    if (count === 0) await context.info(context.t('purge.msg.nothing'));
    else await context.success(context.t('purge.msg.done', { count }));
  },
};
