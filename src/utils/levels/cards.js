import { avatarUrl, fetchAvatar } from './card/avatar.js';
import { progress } from './formula.js';
import { formatNumber, nextReward } from './views.js';

const MAX_ALT_LENGTH = 1000;

export const displayNameOf = (user) => user?.displayName ?? user?.username ?? user?.id ?? '?';

function labelsFor(context) {
  return {
    level: context.t('rank.msg.level'),
    rank: context.t('rank.msg.rank'),
    totalXp: context.t('rank.msg.totalXp'),
    levelUp: context.t('rank.card.levelUp'),
    nextReward: context.t('rank.msg.nextReward'),
  };
}

async function roleName(context, roleId) {
  try {
    const roles = await context.client.rest.guilds.roles(context.guildId);
    return roles.find((role) => role.id === roleId)?.name ?? null;
  } catch {
    return null;
  }
}

async function rewardLine(context, level, labels) {
  const reward = nextReward(context, level);
  if (!reward) return null;
  const name = await roleName(context, reward.roleId);
  const text = [`${labels.level} ${reward.level}`, name].filter(Boolean).join(' · ');
  return { label: labels.nextReward, text };
}

export async function rankCardData(context, user, row) {
  const { levels } = context.app;
  const state = progress(row.xp);
  const labels = labelsFor(context);
  const name = displayNameOf(user);
  const rank = `#${levels.rankOf(context.guildId, user.id)}`;
  const totalXp = formatNumber(context, row.xp);
  const reward = await rewardLine(context, state.level, labels);

  return {
    name,
    avatar: await fetchAvatar(avatarUrl(user)),
    lang: context.lang,
    labels,
    level: state.level,
    rank,
    ratio: state.ratio,
    xpInto: formatNumber(context, state.into),
    xpNeeded: formatNumber(context, state.needed),
    totalXp,
    reward,
    alt: [`${name} · ${labels.level} ${state.level} · ${labels.rank} ${rank} · ${totalXp} XP`, reward && `${reward.label}: ${reward.text}`].filter(Boolean).join(' · '),
  };
}

export async function levelUpCardData(context, user, from, level) {
  const labels = labelsFor(context);
  const name = displayNameOf(user);

  return {
    name,
    avatar: await fetchAvatar(avatarUrl(user)),
    lang: context.lang,
    labels,
    from,
    level,
    alt: `${name} · ${labels.levelUp} · ${labels.level} ${from} → ${level}`,
  };
}

export async function leaderboardCardData(context, state, users) {
  const levelLabel = context.t('rank.msg.level');
  const title = context.t('leaderboard.msg.title');
  const pageLabel = context.t('leaderboard.msg.page', { page: state.page, pages: state.pages });

  const rows = await Promise.all(
    state.rows.map(async (row) => {
      const user = users.get(row.userId);
      return {
        position: row.position,
        name: displayNameOf(user),
        avatar: await fetchAvatar(avatarUrl(user)),
        level: row.level,
        xp: formatNumber(context, row.xp),
      };
    }),
  );

  const lines = rows.map((row) => `${row.position}. ${row.name} · ${levelLabel} ${row.level} · ${row.xp} XP`);
  const alt = [`${title} · ${pageLabel}`, ...lines].join('\n').slice(0, MAX_ALT_LENGTH);

  return { lang: context.lang, title, pageLabel, levelLabel, rows, alt };
}
