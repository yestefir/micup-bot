import { createContext } from '../../core/interaction/src/context.js';
import { attachResponder, messageTarget } from '../message/response.js';
import { deliverLevelUp } from './deliver.js';
import { levelFromXp } from './formula.js';
import { giveLevelRewards } from './rewards.js';

export function rollXp(settings, guildId, random = Math.random) {
  const low = settings.get(guildId, 'levels.xpMin');
  const high = Math.max(low, settings.get(guildId, 'levels.xpMax'));
  return low + Math.floor(random() * (high - low + 1));
}

export async function handleMessageXp({ app, client, message, now = Date.now(), random = Math.random }) {
  const guildId = message.guildId;
  if (!guildId || message.author.bot || message.fromSelf) return null;

  const { settings, levels } = app;
  if (!settings.get(guildId, 'levels.enabled')) return null;
  if (message.content.startsWith(settings.get(guildId, 'prefix'))) return null;
  if (message.channelId && levels.isIgnored(guildId, message.channelId)) return null;

  const cooldownMs = settings.get(guildId, 'levels.cooldownSeconds') * 1000;
  const userId = message.author.id;
  const previous = levels.get(guildId, userId);
  if (previous && now - previous.lastGain < cooldownMs) return null;

  const gained = rollXp(settings, guildId, random);
  const before = previous?.xp ?? 0;
  const after = levels.addMessageXp(guildId, userId, gained, now);
  const from = levelFromXp(before);
  const to = levelFromXp(after);

  if (to > from) await giveLevelRewards({ app, client, member: message.member, guildId, from, to });

  if (to > from && settings.get(guildId, 'levels.announce') === 'message') {
    const context = createContext(app, client, { guildId });
    attachResponder(context, messageTarget(message));
    await deliverLevelUp(context, message.author, from, to);
  }

  return { gained, before, after, level: to, leveledUp: to > from };
}
