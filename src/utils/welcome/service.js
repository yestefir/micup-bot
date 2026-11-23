import { createContext } from '../../core/interaction/src/context.js';
import { avatarUrl, fetchAvatar } from '../levels/card/avatar.js';
import { displayNameOf } from '../levels/cards.js';
import { formatNumber } from '../levels/views.js';
import { createEmbed } from '../message/embed.js';
import { imageFile } from '../message/response.js';

const MAX_ALT_LENGTH = 1000;

export function fillTemplate(template, values) {
  return template.replace(/\{(user|server|count)\}/g, (match, name) => values[name]);
}

async function cardFor(context, member, guild, count) {
  const name = member.displayName ?? displayNameOf(member.user);
  const labels = { welcome: context.t('welcome.card.title') };
  const subtitle = context.t('welcome.card.subtitle', { server: guild?.name ?? '', count: formatNumber(context, count) });
  const data = {
    name,
    avatar: await fetchAvatar(avatarUrl(member.user ?? member)),
    lang: context.lang,
    labels,
    subtitle,
    alt: `${labels.welcome} · ${name} · ${subtitle}`.slice(0, MAX_ALT_LENGTH),
  };
  return { png: await context.app.cards.welcome(data), alt: data.alt };
}

export async function sendWelcome({ app, client, member }) {
  const { logger, settings } = app;
  const guildId = member.guildId;
  if (member.bot) return null;

  const channelId = settings.get(guildId, 'welcome.channel');
  if (!channelId) return null;

  const context = createContext(app, client, { guildId });
  const guild = client.guilds.get(guildId);
  const count = guild?.memberCount ?? 0;
  const mention = `<@${member.id}>`;
  const template = settings.get(guildId, 'welcome.message') || context.t('welcome.msg.default');
  const text = fillTemplate(template, { user: mention, server: guild?.name ?? '', count: formatNumber(context, count) });
  const allowed = { allowed_mentions: { users: [member.id] } };

  try {
    const channel = client.channels.get(channelId) ?? (await client.channels.fetch(channelId));
    if (!channel || channel.guildId !== guildId) throw new Error('the welcome channel does not belong to this server');

    let card = null;
    try {
      card = await cardFor(context, member, guild, count);
    } catch (error) {
      logger.warn(`[welcome] card failed, falling back to an embed: ${error.message}`);
    }

    if (card) await channel.send({ content: text, files: [imageFile(card.png, { alt: card.alt })], ...allowed });
    else await channel.send({ content: mention, embeds: [createEmbed({ type: 'success', title: `👋 ${context.t('welcome.card.title')}`, description: text })], ...allowed });
    return { card: card !== null };
  } catch (error) {
    logger.warn(`[welcome] could not welcome ${member.id} in ${guildId}: ${error?.message ?? error}`);
    return null;
  }
}
