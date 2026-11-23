import { levelFromXp, progress } from './formula.js';

export const PAGE_SIZE = 10;
const BAR_SIZE = 10;
const MEDALS = ['🥇', '🥈', '🥉'];

export const formatNumber = (context, value) => new Intl.NumberFormat(context.lang).format(value);

function bar(ratio) {
  const filled = Math.min(BAR_SIZE, Math.max(0, Math.round(ratio * BAR_SIZE)));
  return '▰'.repeat(filled) + '▱'.repeat(BAR_SIZE - filled);
}

export function rankView(context, userId) {
  const { levels } = context.app;
  const guildId = context.guildId;
  const mention = `<@${userId}>`;
  const title = `⭐ ${context.t('rank.msg.title')}`;
  const row = levels.get(guildId, userId);

  if (!row) return { type: 'info', text: context.t('rank.msg.noData', { user: mention }), options: { title } };

  const state = progress(row.xp);
  const percent = Math.floor(state.ratio * 100);
  const used = `${formatNumber(context, state.into)} / ${formatNumber(context, state.needed)} XP`;
  const text = [mention, `${bar(state.ratio)} ${percent}%`, used].join('\n');
  const fields = [
    { name: context.t('rank.msg.level'), value: String(state.level), inline: true },
    { name: context.t('rank.msg.rank'), value: `#${levels.rankOf(guildId, userId)} / ${levels.count(guildId)}`, inline: true },
    { name: context.t('rank.msg.totalXp'), value: formatNumber(context, row.xp), inline: true },
  ];
  return { type: 'info', text, options: { title, fields } };
}

export function leaderboardPage(context, page) {
  const { levels } = context.app;
  const guildId = context.guildId;
  const total = levels.count(guildId);

  if (total === 0) return { status: 'empty' };

  const pages = Math.ceil(total / PAGE_SIZE);
  if (!Number.isInteger(page) || page < 1 || page > pages) return { status: 'invalid', pages };

  const offset = (page - 1) * PAGE_SIZE;
  const rows = levels.top(guildId, PAGE_SIZE, offset).map((row, index) => ({
    position: offset + index + 1,
    userId: row.userId,
    xp: row.xp,
    level: levelFromXp(row.xp),
  }));
  return { status: 'ok', page, pages, rows };
}

export function leaderboardView(context, page) {
  const title = `🏆 ${context.t('leaderboard.msg.title')}`;
  const state = leaderboardPage(context, page);

  if (state.status === 'empty') return { type: 'info', text: context.t('leaderboard.msg.empty'), options: { title } };
  if (state.status === 'invalid') {
    return { type: 'warning', text: context.t('leaderboard.msg.invalidPage', { pages: state.pages }), options: { title } };
  }

  const lines = state.rows.map((row) =>
    context.t('leaderboard.msg.entry', {
      position: MEDALS[row.position - 1] ?? `${row.position}.`,
      user: `<@${row.userId}>`,
      level: row.level,
      xp: formatNumber(context, row.xp),
    }),
  );
  return {
    type: 'info',
    text: lines.join('\n'),
    options: { title, footer: context.t('leaderboard.msg.page', { page: state.page, pages: state.pages }) },
  };
}
