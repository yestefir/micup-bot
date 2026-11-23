import { imageFile } from '../message/response.js';
import { leaderboardCardData, levelUpCardData, rankCardData } from './cards.js';
import { resolveUsers } from './users.js';
import { leaderboardPage, leaderboardView, rankView } from './views.js';

export async function deliverRank(context, user) {
  const { levels, cards, logger } = context.app;
  const row = levels.get(context.guildId, user.id);

  if (row) {
    try {
      const data = await rankCardData(context, user, row);
      await context.sendImage(await cards.rank(data), { alt: data.alt });
      return;
    } catch (error) {
      logger.warn(`[levels] rank card failed, falling back to an embed: ${error.message}`);
    }
  }

  const { type, text, options } = rankView(context, user.id);
  await context.send(type, text, { ...options, ephemeral: false });
}

export async function deliverLeaderboard(context, page) {
  const { cards, logger } = context.app;
  const state = leaderboardPage(context, page);

  if (state.status === 'ok') {
    try {
      const users = await resolveUsers(context.client, state.rows.map((row) => row.userId));
      const data = await leaderboardCardData(context, state, users);
      await context.sendImage(await cards.leaderboard(data), { alt: data.alt });
      return;
    } catch (error) {
      logger.warn(`[levels] leaderboard card failed, falling back to an embed: ${error.message}`);
    }
  }

  const { type, text, options } = leaderboardView(context, page);
  await context.send(type, text, { ...options, ephemeral: false });
}

async function postToChannel(context, channelId, user, level, card) {
  const { client, guildId } = context;
  const channel = client.channels.get(channelId) ?? (await client.channels.fetch(channelId));
  if (!channel || channel.guildId !== guildId) throw new Error('the level channel does not belong to this server');

  const mention = `<@${user.id}>`;
  const allowed = { allowed_mentions: { users: [user.id] } };

  if (card) {
    await channel.send({ content: mention, files: [imageFile(card.png, { alt: card.alt })], ...allowed });
    return;
  }

  const text = context.t('rank.msg.levelUp', { user: mention, level });
  const embed = context.embed('success', text, { title: `⭐ ${context.t('rank.msg.title')}` });
  await channel.send({ content: mention, embeds: [embed], ...allowed });
}

export async function deliverLevelUp(context, user, from, level) {
  const { cards, logger, settings } = context.app;
  let card = null;

  try {
    const data = await levelUpCardData(context, user, from, level);
    card = { png: await cards.levelUp(data), alt: data.alt };
  } catch (error) {
    logger.warn(`[levels] level up card failed, falling back to an embed: ${error.message}`);
  }

  const channelId = settings.get(context.guildId, 'levels.channel');
  if (channelId) {
    try {
      await postToChannel(context, channelId, user, level, card);
      return;
    } catch (error) {
      logger.warn(`[levels] could not post the level up in channel ${channelId}, replying in place: ${error.message}`);
    }
  }

  if (card) {
    try {
      await context.sendImage(card.png, { alt: card.alt });
      return;
    } catch (error) {
      logger.warn(`[levels] level up card could not be sent, falling back to an embed: ${error.message}`);
    }
  }

  const text = context.t('rank.msg.levelUp', { user: `<@${user.id}>`, level });
  await context.success(text, { title: `⭐ ${context.t('rank.msg.title')}` });
}

export async function resolveUser(client, message, id) {
  const mentioned = message.mentions?.find((user) => user.id === id);
  if (mentioned) return mentioned;
  try {
    return await client.users.fetch(id);
  } catch {
    return { id, displayName: id, avatarURL: () => null };
  }
}
