import { createContext } from '../../core/interaction/src/context.js';
import { createEmbed } from '../message/embed.js';

export async function postModLog(context, { kind, actor, targetId, channelId, fields = [] }) {
  const { app, client, guildId } = context;
  const logChannel = app.settings.get(guildId, 'moderation.logChannel');
  if (!logChannel) return;

  const logContext = createContext(app, client, { guildId });
  const subject = targetId ? `<@${targetId}>` : `<#${channelId}>`;
  const embed = createEmbed({
    type: 'info',
    title: `🛡️ ${logContext.t(`modlog.${kind}`)}`,
    description: logContext.t('modlog.line', { moderator: `<@${actor.id}>`, target: subject }),
    fields,
    timestamp: new Date().toISOString(),
  });

  try {
    const channel = client.channels.get(logChannel) ?? (await client.channels.fetch(logChannel));
    if (!channel || channel.guildId !== guildId) throw new Error('the log channel does not belong to this server');
    await channel.send({ embeds: [embed], allowed_mentions: { parse: [] } });
  } catch (error) {
    app.logger.warn(`[modlog] could not post in channel ${logChannel}: ${error?.message ?? error}`);
  }
}
