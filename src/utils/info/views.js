import { avatarUrl } from '../levels/card/avatar.js';
import { formatNumber } from '../levels/views.js';

const HELP_COMMANDS = [
  'rank', 'leaderboard', 'avatar', 'userinfo', 'serverinfo', 'ping', 'help',
  'settings', 'mute', 'ban', 'purge', 'xpadjust', 'xpreset', 'levelrole', 'xpignore',
];

const stamp = (date) => (date ? `<t:${Math.floor(new Date(date).getTime() / 1000)}:D>` : '—');

export function helpView(context) {
  const lines = HELP_COMMANDS.map(
    (key) => `\`${context.prefix}${context.t(`${key}.name`)}\` — ${context.t(`${key}.description`)}`,
  );
  return { type: 'info', text: lines.join('\n'), options: { title: `📖 ${context.t('help.msg.title')}`, footer: context.t('help.msg.footer') } };
}

export function avatarView(context, user) {
  const url = avatarUrl(user);
  const title = `🖼️ ${context.t('avatar.msg.title', { user: user.displayName ?? user.id })}`;
  if (!url) return { type: 'info', text: context.t('avatar.msg.none'), options: { title } };
  return { type: 'info', text: `[${context.t('avatar.msg.open')}](${url})`, options: { title, image: url } };
}

export async function userInfoView(context, user) {
  const { client, guildId } = context;
  let joined;
  try {
    joined = (await client.rest.guilds.member(guildId, user.id)).joined_at;
  } catch {
    joined = undefined;
  }
  const fields = [
    { name: context.t('userinfo.msg.id'), value: `\`${user.id}\``, inline: true },
    { name: context.t('userinfo.msg.created'), value: stamp(user.createdAt), inline: true },
    { name: context.t('userinfo.msg.joined'), value: stamp(joined), inline: true },
    { name: context.t('userinfo.msg.bot'), value: context.t(user.bot ? 'settings.panel.on' : 'settings.panel.off'), inline: true },
  ];
  const level = context.app.levels.get(guildId, user.id);
  if (level) fields.push({ name: context.t('rank.msg.totalXp'), value: formatNumber(context, level.xp), inline: true });
  return { type: 'info', text: `<@${user.id}>`, options: { title: `👤 ${context.t('userinfo.msg.title')}`, fields } };
}

export function serverInfoView(context) {
  const guild = context.client.guilds.get(context.guildId);
  if (!guild) return { type: 'error', text: context.t('errors.generic'), options: {} };
  const fields = [
    { name: context.t('serverinfo.msg.owner'), value: guild.ownerId ? `<@${guild.ownerId}>` : '—', inline: true },
    { name: context.t('serverinfo.msg.members'), value: guild.memberCount === undefined ? '—' : formatNumber(context, guild.memberCount), inline: true },
    { name: context.t('serverinfo.msg.created'), value: stamp(guild.createdAt), inline: true },
    { name: context.t('serverinfo.msg.id'), value: `\`${guild.id}\``, inline: true },
  ];
  return { type: 'info', text: `**${guild.name}**`, options: { title: `🏠 ${context.t('serverinfo.msg.title')}`, fields } };
}
