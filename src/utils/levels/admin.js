import { levelFromXp } from './formula.js';
import { formatNumber } from './views.js';

export const MAX_REWARD_LEVEL = 1000;

export function adjustXpView(context, userId, delta) {
  const xp = context.app.levels.adjustXp(context.guildId, userId, delta);
  const text = context.t('xpadjust.msg.done', {
    user: `<@${userId}>`,
    xp: formatNumber(context, xp),
    level: levelFromXp(xp),
  });
  return { type: 'success', text };
}

export function resetXpView(context, userId) {
  const reset = context.app.levels.resetXp(context.guildId, userId);
  const key = reset ? 'xpreset.msg.done' : 'xpreset.msg.nothing';
  return { type: reset ? 'success' : 'info', text: context.t(key, { user: `<@${userId}>` }) };
}

export function levelRewardView(context, level, roleId) {
  const { levels } = context.app;
  const { guildId } = context;

  if (level === null || level === undefined) {
    const rewards = levels.rewards(guildId);
    if (rewards.length === 0) return { type: 'info', text: context.t('levelrole.msg.empty') };
    const lines = rewards.map((reward) => context.t('levelrole.msg.entry', { level: reward.level, role: `<@&${reward.roleId}>` }));
    return { type: 'info', text: lines.join('\n'), options: { title: `🎖️ ${context.t('levelrole.msg.title')}` } };
  }

  if (!Number.isInteger(level) || level < 1 || level > MAX_REWARD_LEVEL) {
    return { type: 'warning', text: context.t('levelrole.msg.invalidLevel', { max: MAX_REWARD_LEVEL }) };
  }

  if (!roleId) {
    const removed = levels.removeReward(guildId, level);
    return removed
      ? { type: 'success', text: context.t('levelrole.msg.removed', { level }) }
      : { type: 'info', text: context.t('levelrole.msg.missing', { level }) };
  }

  levels.setReward(guildId, level, roleId);
  return { type: 'success', text: context.t('levelrole.msg.set', { level, role: `<@&${roleId}>` }) };
}

export function ignoreChannelView(context, channelId) {
  const { levels } = context.app;
  const added = levels.toggleIgnored(context.guildId, channelId);
  const text = context.t(added ? 'xpignore.msg.added' : 'xpignore.msg.removed', { channel: `<#${channelId}>` });
  const all = levels.ignored(context.guildId);
  const options = all.length > 0 ? { fields: [{ name: context.t('xpignore.msg.list'), value: all.map((id) => `<#${id}>`).join(' ') }] } : {};
  return { type: 'success', text, options };
}
