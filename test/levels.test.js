import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LevelStore } from '../src/core/levels/store.js';
import { levelFromXp, progress, totalXpForLevel, xpToNext } from '../src/utils/levels/formula.js';
import { handleMessageXp, rollXp } from '../src/utils/levels/service.js';
import { clearUserCache, resolveUsers } from '../src/utils/levels/users.js';
import { GUILD, body, colorOf, createMessage, createWorld, run } from './support/fakes.js';

const fixedRandom = (value) => () => value;

function chatMessage(world, content, authorId = 'T', extra = {}) {
  const replies = [];
  return {
    content,
    replies,
    guildId: GUILD,
    author: { id: authorId, bot: false, displayName: authorId, avatarURL: () => null },
    fromSelf: false,
    reply: async (payload) => (replies.push(payload), { delete: async () => {} }),
    channel: { send: async (payload) => (replies.push(payload), { delete: async () => {} }) },
    ...extra,
  };
}

function stubCards(world) {
  const calls = { rank: [], levelUp: [], leaderboard: [] };
  world.app.cards = {
    rank: async (data) => (calls.rank.push(data), Buffer.from('rank-png')),
    levelUp: async (data) => (calls.levelUp.push(data), Buffer.from('levelup-png')),
    leaderboard: async (data) => (calls.leaderboard.push(data), Buffer.from('leaderboard-png')),
  };
  return calls;
}

function failingCards(world) {
  const broken = async () => {
    throw new Error('canvas unavailable');
  };
  world.app.cards = { rank: broken, levelUp: broken, leaderboard: broken };
}

function knownUsers(world) {
  world.client.users = {
    fetch: async (id) => ({ id, displayName: `User ${id}`, avatarURL: () => null }),
  };
}

beforeEach(() => clearUserCache());

const textOf = (file) => file.data.text();

test('level thresholds follow the 5n² + 50n + 100 curve', () => {
  assert.equal(xpToNext(0), 100);
  assert.equal(xpToNext(1), 155);
  assert.equal(xpToNext(2), 220);
  assert.equal(totalXpForLevel(0), 0);
  assert.equal(totalXpForLevel(1), 100);
  assert.equal(totalXpForLevel(2), 255);
  assert.equal(totalXpForLevel(3), 475);
});

test('levelFromXp changes exactly at the thresholds', () => {
  assert.equal(levelFromXp(0), 0);
  assert.equal(levelFromXp(99), 0);
  assert.equal(levelFromXp(100), 1);
  assert.equal(levelFromXp(254), 1);
  assert.equal(levelFromXp(255), 2);
  assert.equal(levelFromXp(475), 3);
  for (let level = 0; level < 60; level += 1) {
    assert.equal(levelFromXp(totalXpForLevel(level)), level);
    assert.equal(levelFromXp(totalXpForLevel(level + 1) - 1), level);
  }
});

test('progress reports the position inside the current level', () => {
  assert.deepEqual(progress(300), { level: 2, into: 45, needed: 220, ratio: 45 / 220 });
  assert.deepEqual(progress(0), { level: 0, into: 0, needed: 100, ratio: 0 });
});

test('store accumulates xp and counts messages', () => {
  const store = new LevelStore(':memory:');
  assert.equal(store.get('g', 'u'), null);
  assert.equal(store.addMessageXp('g', 'u', 20, 1000), 20);
  assert.equal(store.addMessageXp('g', 'u', 5, 2000), 25);
  assert.deepEqual(store.get('g', 'u'), { xp: 25, messages: 2, lastGain: 2000 });
  assert.equal(store.get('other', 'u'), null);
});

test('store ranks by xp with a stable tie-break and paginates', () => {
  const store = new LevelStore(':memory:');
  store.addMessageXp('g', 'c', 50, 1);
  store.addMessageXp('g', 'a', 90, 1);
  store.addMessageXp('g', 'b', 90, 1);
  store.addMessageXp('g', 'd', 10, 1);
  store.addMessageXp('x', 'z', 999, 1);

  assert.equal(store.count('g'), 4);
  assert.deepEqual(store.top('g', 10).map((row) => row.userId), ['a', 'b', 'c', 'd']);
  assert.deepEqual(store.top('g', 2, 2).map((row) => row.userId), ['c', 'd']);
  assert.deepEqual(['a', 'b', 'c', 'd'].map((id) => store.rankOf('g', id)), [1, 2, 3, 4]);
  assert.equal(store.rankOf('g', 'nobody'), null);
});

test('store persists across instances', () => {
  const directory = mkdtempSync(join(tmpdir(), 'micup-levels-'));
  const file = join(directory, 'levels.db');
  try {
    const first = new LevelStore(file);
    first.addMessageXp('g', 'u', 42, 1);
    first.close();
    const second = new LevelStore(file);
    assert.equal(second.get('g', 'u').xp, 42);
    second.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('rollXp stays inside the configured range', async () => {
  const world = await createWorld();
  world.app.settings.set(GUILD, 'levels.xpMin', 10);
  world.app.settings.set(GUILD, 'levels.xpMax', 12);
  assert.equal(rollXp(world.app.settings, GUILD, fixedRandom(0)), 10);
  assert.equal(rollXp(world.app.settings, GUILD, fixedRandom(0.999)), 12);
  world.app.settings.set(GUILD, 'levels.xpMax', 1);
  assert.equal(rollXp(world.app.settings, GUILD, fixedRandom(0.5)), 10);
});

test('a message grants xp and the cooldown blocks quick repeats', async () => {
  const world = await createWorld();
  const { app, client } = world;
  const grant = (now) => handleMessageXp({ app, client, message: chatMessage(world, 'hello'), now, random: fixedRandom(0) });

  assert.equal((await grant(1_000_000)).gained, 15);
  assert.equal(await grant(1_030_000), null);
  assert.equal(app.levels.get(GUILD, 'T').xp, 15);
  assert.equal((await grant(1_060_000)).after, 30);
  assert.equal(app.levels.get(GUILD, 'T').messages, 2);
});

test('the cooldown setting is respected, including zero', async () => {
  const world = await createWorld();
  const { app, client } = world;
  app.settings.set(GUILD, 'levels.cooldownSeconds', 0);
  const grant = (now) => handleMessageXp({ app, client, message: chatMessage(world, 'hi'), now, random: fixedRandom(0) });
  await grant(1000);
  assert.ok(await grant(1000));
  app.settings.set(GUILD, 'levels.cooldownSeconds', 120);
  assert.equal(await grant(1000 + 119_000), null);
  assert.ok(await grant(1000 + 121_000));
});

test('bots, direct messages, commands and disabled servers earn nothing', async () => {
  const world = await createWorld();
  const { app, client } = world;
  const grant = (message) => handleMessageXp({ app, client, message, now: 1, random: fixedRandom(0) });

  const bot = chatMessage(world, 'hi');
  bot.author.bot = true;
  assert.equal(await grant(bot), null);
  assert.equal(await grant(chatMessage(world, 'hi', 'T', { guildId: undefined })), null);
  assert.equal(await grant(chatMessage(world, 'hi', 'T', { fromSelf: true })), null);
  assert.equal(await grant(chatMessage(world, '!rank')), null);

  app.settings.set(GUILD, 'levels.enabled', false);
  assert.equal(await grant(chatMessage(world, 'hi')), null);
  assert.equal(app.levels.count(GUILD), 0);
});

async function levelUpWorld() {
  const world = await createWorld();
  world.app.settings.set(GUILD, 'levels.xpMin', 10);
  world.app.settings.set(GUILD, 'levels.xpMax', 10);
  world.app.levels.addMessageXp(GUILD, 'T', 95, 0);
  return world;
}

const levelUp = (world, message) =>
  handleMessageXp({ app: world.app, client: world.client, message, now: 10_000_000, random: fixedRandom(0) });

test('a level up is announced with a card as a reply', async () => {
  const world = await levelUpWorld();
  const cards = stubCards(world);
  const message = chatMessage(world, 'hello', 'T', { author: { id: 'T', bot: false, displayName: 'Taylor', avatarURL: () => null } });

  const outcome = await levelUp(world, message);

  assert.equal(outcome.level, 1);
  assert.equal(outcome.leveledUp, true);
  assert.equal(message.replies.length, 1);
  const [reply] = message.replies;
  assert.equal(reply.embeds, undefined);
  assert.equal(reply.files[0].name, 'card.png');
  assert.equal(reply.files[0].data.type, 'image/png');
  assert.equal(await textOf(reply.files[0]), 'levelup-png');
  assert.equal(reply.files[0].description, 'Taylor · Seviye atladı · Seviye 0 → 1');

  const [data] = cards.levelUp;
  assert.equal(data.name, 'Taylor');
  assert.equal(data.from, 0);
  assert.equal(data.level, 1);
  assert.equal(data.lang, 'tr');
  assert.deepEqual(data.labels, { level: 'Seviye', rank: 'Sıralama', totalXp: 'Toplam XP', levelUp: 'Seviye atladı', nextReward: 'Sıradaki ödül' });
  assert.equal(cards.rank.length, 0);
});

test('the level up card follows the server language', async () => {
  const world = await levelUpWorld();
  const cards = stubCards(world);
  world.app.settings.set(GUILD, 'language', 'ru');
  await levelUp(world, chatMessage(world, 'hello'));
  assert.equal(cards.levelUp[0].lang, 'ru');
  assert.equal(cards.levelUp[0].labels.levelUp, 'Новый уровень');
});

test('a level up falls back to a green embed when the card cannot be drawn', async () => {
  const world = await levelUpWorld();
  failingCards(world);
  const message = chatMessage(world, 'hello');

  await levelUp(world, message);

  assert.equal(message.replies.length, 1);
  assert.equal(body(message.replies[0]), '<@T> seviye atladı! Yeni seviye: **1**');
  assert.equal(colorOf(message.replies[0]), 0x57f287);
  assert.equal(message.replies[0].embeds[0].title, '⭐ Seviye kartı');
  assert.ok(world.logs.some((line) => line === '[levels] level up card failed, falling back to an embed: canvas unavailable'));
});

test('no announcement without a level up or when announcements are off', async () => {
  const world = await createWorld();
  const { app, client } = world;
  const quiet = chatMessage(world, 'hello');
  await handleMessageXp({ app, client, message: quiet, now: 1, random: fixedRandom(0) });
  assert.equal(quiet.replies.length, 0);

  app.settings.set(GUILD, 'levels.announce', 'off');
  app.levels.addMessageXp(GUILD, 'U', 99, 0);
  const silent = chatMessage(world, 'hello', 'U');
  const outcome = await handleMessageXp({ app, client, message: silent, now: 10_000_000, random: fixedRandom(0) });
  assert.equal(outcome.leveledUp, true);
  assert.equal(silent.replies.length, 0);
});

test('rank sends a card built from the right data for another user and for yourself', async () => {
  const world = await createWorld();
  const cards = stubCards(world);
  world.app.levels.addMessageXp(GUILD, 'T', 300, 0);
  world.app.levels.addMessageXp(GUILD, 'A', 500, 0);

  const other = await run(world, '!rank <@T>', 'A');
  assert.equal(other.embeds, undefined);
  assert.equal(other.files[0].name, 'card.png');
  assert.equal(await textOf(other.files[0]), 'rank-png');

  const [data] = cards.rank;
  assert.deepEqual(
    { name: data.name, lang: data.lang, level: data.level, rank: data.rank, xpInto: data.xpInto, xpNeeded: data.xpNeeded, totalXp: data.totalXp },
    { name: 'T', lang: 'tr', level: 2, rank: '#2', xpInto: '45', xpNeeded: '220', totalXp: '300' },
  );
  assert.equal(data.ratio, 45 / 220);
  assert.deepEqual(data.labels, { level: 'Seviye', rank: 'Sıralama', totalXp: 'Toplam XP', levelUp: 'Seviye atladı', nextReward: 'Sıradaki ödül' });
  assert.equal(other.files[0].description, 'T · Seviye 2 · Sıralama #2 · 300 XP');

  await run(world, '!seviye', 'A');
  assert.equal(cards.rank[1].name, 'Ali');
  assert.equal(cards.rank[1].rank, '#1');
});

test('rank works through every language alias and formats numbers per language', async () => {
  const world = await createWorld();
  const cards = stubCards(world);
  world.app.levels.addMessageXp(GUILD, 'A', 1234, 0);
  const aliases = ['rank', 'level', 'xp', 'seviye', 'rang', 'nivel', 'niveau', 'уровень'];
  for (const name of aliases) {
    const reply = await run(world, `!${name}`, 'A');
    assert.equal(reply.files[0].name, 'card.png', name);
  }
  assert.equal(cards.rank.length, aliases.length);
  assert.equal(cards.rank[0].totalXp, '1.234');

  world.app.settings.set(GUILD, 'language', 'en-US');
  await run(world, '!rank', 'A');
  assert.equal(cards.rank.at(-1).totalXp, '1,234');
  assert.equal(cards.rank.at(-1).labels.level, 'Level');
});

test('rank falls back to the embed card when drawing fails', async () => {
  const world = await createWorld();
  failingCards(world);
  world.app.levels.addMessageXp(GUILD, 'T', 300, 0);
  world.app.levels.addMessageXp(GUILD, 'A', 500, 0);

  const other = await run(world, '!rank <@T>', 'A');
  assert.equal(other.embeds[0].title, '⭐ Seviye kartı');
  assert.equal(colorOf(other), 0x5865f2);
  assert.equal(body(other), '<@T>\n▰▰▱▱▱▱▱▱▱▱ 20%\n45 / 220 XP');
  assert.deepEqual(other.embeds[0].fields.map((field) => [field.name, field.value]), [
    ['Seviye', '2'],
    ['Sıralama', '#2 / 2'],
    ['Toplam XP', '300'],
  ]);
  assert.ok(world.logs.some((line) => line === '[levels] rank card failed, falling back to an embed: canvas unavailable'));
});

test('rank handles users without xp and bad input without drawing', async () => {
  const world = await createWorld();
  const cards = stubCards(world);
  const empty = await run(world, '!rank <@T>', 'A');
  assert.equal(body(empty), '<@T> henüz XP kazanmadı.');
  const usage = await run(world, '!rank nope', 'A');
  assert.match(body(usage), /Kullanım: !seviye \[kullanici\]/);
  assert.equal(colorOf(usage), 0xfee75c);
  assert.equal(cards.rank.length, 0);
});

function seed(world, count) {
  for (let index = 0; index < count; index += 1) {
    world.app.levels.addMessageXp(GUILD, `u${String(index).padStart(2, '0')}`, 1000 - index * 10, 0);
  }
}

test('leaderboard sends a card with ten resolved rows per page', async () => {
  const world = await createWorld();
  const cards = stubCards(world);
  knownUsers(world);
  seed(world, 12);

  const reply = await run(world, '!leaderboard', 'A');

  assert.equal(reply.embeds, undefined);
  assert.equal(reply.files[0].name, 'card.png');
  assert.equal(await textOf(reply.files[0]), 'leaderboard-png');

  const [data] = cards.leaderboard;
  assert.equal(data.rows.length, 10);
  assert.deepEqual(data.rows[0], { position: 1, name: 'User u00', avatar: null, level: 4, xp: '1.000' });
  assert.equal(data.rows[9].position, 10);
  assert.equal(data.title, 'Liderlik tablosu');
  assert.equal(data.pageLabel, 'Sayfa 1/2');
  assert.equal(data.levelLabel, 'Seviye');
  assert.equal(data.lang, 'tr');
  assert.match(data.alt, /^Liderlik tablosu · Sayfa 1\/2\n1\. User u00 · Seviye 4 · 1\.000 XP\n2\. /);
  assert.equal(reply.files[0].description, data.alt);
});

test('leaderboard second page continues the numbering and follows the language', async () => {
  const world = await createWorld();
  const cards = stubCards(world);
  knownUsers(world);
  seed(world, 12);
  world.app.settings.set(GUILD, 'language', 'en-US');

  await run(world, '!leaderboard 2', 'A');

  const [data] = cards.leaderboard;
  assert.deepEqual(data.rows.map((row) => row.position), [11, 12]);
  assert.equal(data.pageLabel, 'Page 2/2');
  assert.equal(data.title, 'Leaderboard');
  assert.equal(data.levelLabel, 'Level');
  assert.equal(data.rows[0].xp, '900');
});

test('leaderboard falls back to ids when users cannot be resolved and still draws', async () => {
  const world = await createWorld();
  const cards = stubCards(world);
  world.client.users = {
    fetch: async (id) => {
      if (id === 'u01') throw new Error('unknown user');
      return { id, displayName: `User ${id}`, avatarURL: () => null };
    },
  };
  seed(world, 3);

  await run(world, '!top', 'A');

  assert.deepEqual(cards.leaderboard[0].rows.map((row) => row.name), ['User u00', 'u01', 'User u02']);
});

test('leaderboard works through every language alias', async () => {
  const world = await createWorld();
  const cards = stubCards(world);
  seed(world, 3);
  const names = ['leaderboard', 'top', 'liderlik', 'bestenliste', 'clasificacion', 'classement', 'топ'];
  for (const name of names) {
    const reply = await run(world, `!${name}`, 'A');
    assert.equal(reply.files[0].name, 'card.png', name);
  }
  assert.equal(cards.leaderboard.length, names.length);
});

test('leaderboard falls back to the embed list with medals and a footer when drawing fails', async () => {
  const world = await createWorld();
  failingCards(world);
  seed(world, 12);

  const reply = await run(world, '!leaderboard', 'A');
  const lines = body(reply).split('\n');

  assert.equal(lines.length, 10);
  assert.equal(levelFromXp(1000), 4);
  assert.equal(lines[0], '**🥇** <@u00> — Seviye 4 · 1.000 XP');
  assert.ok(lines[1].startsWith('**🥈**'));
  assert.ok(lines[2].startsWith('**🥉**'));
  assert.ok(lines[3].startsWith('**4.**'));
  assert.equal(reply.embeds[0].footer.text, 'Sayfa 1/2');
  assert.equal(reply.embeds[0].title, '🏆 Liderlik tablosu');
  assert.equal(colorOf(reply), 0x5865f2);
  assert.ok(world.logs.some((line) => line === '[levels] leaderboard card failed, falling back to an embed: canvas unavailable'));

  const second = await run(world, '!liderlik 2', 'A');
  assert.equal(body(second).split('\n').length, 2);
  assert.ok(body(second).startsWith('**11.**'));
  assert.equal(second.embeds[0].footer.text, 'Sayfa 2/2');
});

test('leaderboard keeps the text answer for an empty server and never draws it', async () => {
  const world = await createWorld();
  const cards = stubCards(world);
  const reply = await run(world, '!top', 'A');
  assert.equal(body(reply), 'Henüz kimse XP kazanmadı.');
  assert.equal(cards.leaderboard.length, 0);
});

test('leaderboard rejects out of range and non numeric pages without drawing', async () => {
  const world = await createWorld();
  const cards = stubCards(world);
  seed(world, 12);
  const high = await run(world, '!leaderboard 3', 'A');
  assert.equal(body(high), 'Geçersiz sayfa. 1 ile 2 arasında bir sayı gir.');
  assert.equal(colorOf(high), 0xfee75c);
  assert.equal(body(await run(world, '!leaderboard 0', 'A')), 'Geçersiz sayfa. 1 ile 2 arasında bir sayı gir.');
  assert.match(body(await run(world, '!leaderboard abc', 'A')), /Kullanım: !liderlik \[sayfa\]/);
  assert.equal(cards.leaderboard.length, 0);
});

test('leaderboard shows the typing indicator while it works', async () => {
  const world = await createWorld();
  stubCards(world);
  seed(world, 2);
  let typing = 0;
  const message = createMessage(world, '!leaderboard', 'A');
  message.channel.sendTyping = async () => {
    typing += 1;
  };
  await world.interactions.prefix.handleMessage(message);
  assert.equal(typing, 1);
  assert.equal(message.replies.at(-1).files[0].name, 'card.png');
});

test('resolveUsers fetches each id once, caches users and does not cache failures', async () => {
  let fetches = 0;
  const failing = new Set(['bad']);
  const client = {
    users: {
      fetch: async (id) => {
        fetches += 1;
        if (failing.has(id)) throw new Error('nope');
        return { id, displayName: id };
      },
    },
  };

  const first = await resolveUsers(client, ['a', 'b', 'a', 'bad'], { now: 1000 });
  assert.equal(fetches, 3);
  assert.equal(first.get('a').displayName, 'a');
  assert.equal(first.get('bad').displayName, 'bad');
  assert.equal(first.get('bad').avatarURL(), null);

  await resolveUsers(client, ['a', 'b', 'bad'], { now: 2000 });
  assert.equal(fetches, 4);

  failing.clear();
  const recovered = await resolveUsers(client, ['bad'], { now: 3000 });
  assert.equal(recovered.get('bad').displayName, 'bad');
  assert.equal(fetches, 5);

  await resolveUsers(client, ['a'], { now: 10 * 60 * 1000 + 2000 });
  assert.equal(fetches, 6);
});

test('the user cache is bounded', async () => {
  let fetches = 0;
  const client = { users: { fetch: async (id) => (fetches += 1, { id, displayName: id }) } };
  const ids = Array.from({ length: 520 }, (_, index) => `user${index}`);
  await resolveUsers(client, ids, { now: 1 });
  assert.equal(fetches, 520);
  await resolveUsers(client, ['user519'], { now: 2 });
  assert.equal(fetches, 520);
  await resolveUsers(client, ['user0'], { now: 2 });
  assert.equal(fetches, 521);
});

function slashInteraction(extra = {}) {
  const calls = [];
  const interaction = {
    guildId: GUILD,
    channelId: '200',
    locale: 'en-US',
    user: { id: 'u01', displayName: 'u01', avatarURL: () => null },
    deferred: false,
    replied: false,
    options: { getUser: () => null, getInteger: () => null },
    async deferReply(options) {
      this.deferred = true;
      calls.push(['defer', options]);
    },
    async followUp(payload) {
      calls.push(['followUp', payload]);
    },
    async deleteReply() {
      calls.push(['delete']);
    },
    async editReply(payload) {
      calls.push(['edit', payload]);
    },
    async reply(payload) {
      calls.push(['reply', payload]);
    },
    ...extra,
  };
  return { interaction, calls };
}

test('slash rank defers, sends the card as a follow up and removes the placeholder', async () => {
  const world = await createWorld();
  const cards = stubCards(world);
  seed(world, 3);
  const { interaction, calls } = slashInteraction();

  await world.client.slash.get('rank')(interaction);

  assert.deepEqual(calls.map(([kind]) => kind), ['defer', 'followUp', 'delete']);
  assert.deepEqual(calls[0][1], { ephemeral: false });
  assert.equal(calls[1][1].ephemeral, false);
  assert.equal(calls[1][1].files[0].name, 'card.png');
  assert.equal(await textOf(calls[1][1].files[0]), 'rank-png');
  assert.equal(cards.rank[0].lang, 'en-US');
  assert.equal(cards.rank[0].rank, '#2');
  assert.equal(cards.rank[0].labels.level, 'Level');
});

test('slash rank draws the selected user and answers without xp with an embed', async () => {
  const world = await createWorld();
  const cards = stubCards(world);
  seed(world, 3);

  const chosen = { id: 'u02', displayName: 'Chosen', avatarURL: () => null };
  const picked = slashInteraction({ options: { getUser: () => chosen } });
  await world.client.slash.get('rank')(picked.interaction);
  assert.equal(cards.rank[0].name, 'Chosen');
  assert.equal(cards.rank[0].rank, '#3');

  const stranger = { id: 'nobody', displayName: 'Nobody', avatarURL: () => null };
  const empty = slashInteraction({ options: { getUser: () => stranger } });
  await world.client.slash.get('rank')(empty.interaction);
  assert.deepEqual(empty.calls.map(([kind]) => kind), ['defer', 'edit']);
  assert.equal(body(empty.calls[1][1]), "<@nobody> hasn't earned any XP yet.");
  assert.equal(cards.rank.length, 1);
});

test('slash rank falls back to an embed edit when the card fails', async () => {
  const world = await createWorld();
  failingCards(world);
  seed(world, 3);
  const { interaction, calls } = slashInteraction();

  await world.client.slash.get('rank')(interaction);

  assert.deepEqual(calls.map(([kind]) => kind), ['defer', 'edit']);
  assert.equal(calls[1][1].embeds[0].title, '⭐ Level card');
  assert.match(body(calls[1][1]), /^<@u01>/);
});

test('slash rank falls back when the follow up is rejected', async () => {
  const world = await createWorld();
  stubCards(world);
  seed(world, 3);
  const { interaction, calls } = slashInteraction({
    async followUp() {
      throw new Error('files are not allowed');
    },
  });

  await world.client.slash.get('rank')(interaction);

  assert.deepEqual(calls.map(([kind]) => kind), ['defer', 'edit']);
  assert.match(body(calls[1][1]), /^<@u01>/);
});

test('slash leaderboard defers, sends the card as a follow up and removes the placeholder', async () => {
  const world = await createWorld();
  const cards = stubCards(world);
  knownUsers(world);
  seed(world, 3);
  const { interaction, calls } = slashInteraction();

  await world.client.slash.get('leaderboard')(interaction);

  assert.deepEqual(calls.map(([kind]) => kind), ['defer', 'followUp', 'delete']);
  assert.deepEqual(calls[0][1], { ephemeral: false });
  assert.equal(calls[1][1].ephemeral, false);
  assert.equal(calls[1][1].files[0].name, 'card.png');
  assert.equal(await textOf(calls[1][1].files[0]), 'leaderboard-png');
  assert.equal(cards.leaderboard[0].title, 'Leaderboard');
  assert.equal(cards.leaderboard[0].rows.length, 3);
});

test('slash leaderboard honours the page option and answers invalid or empty pages with text', async () => {
  const world = await createWorld();
  const cards = stubCards(world);
  seed(world, 12);

  const second = slashInteraction({ options: { getInteger: () => 2 } });
  await world.client.slash.get('leaderboard')(second.interaction);
  assert.deepEqual(cards.leaderboard[0].rows.map((row) => row.position), [11, 12]);

  const invalid = slashInteraction({ options: { getInteger: () => 9 } });
  await world.client.slash.get('leaderboard')(invalid.interaction);
  assert.deepEqual(invalid.calls.map(([kind]) => kind), ['defer', 'edit']);
  assert.equal(body(invalid.calls[1][1]), 'Invalid page. Enter a number between 1 and 2.');
  assert.equal(cards.leaderboard.length, 1);

  const empty = await createWorld();
  const emptyCards = stubCards(empty);
  const none = slashInteraction();
  await empty.client.slash.get('leaderboard')(none.interaction);
  assert.deepEqual(none.calls.map(([kind]) => kind), ['defer', 'edit']);
  assert.equal(body(none.calls[1][1]), 'Nobody has earned XP yet.');
  assert.equal(emptyCards.leaderboard.length, 0);
});

test('slash leaderboard falls back to an embed edit when the card fails', async () => {
  const world = await createWorld();
  failingCards(world);
  seed(world, 3);
  const { interaction, calls } = slashInteraction();

  await world.client.slash.get('leaderboard')(interaction);

  assert.deepEqual(calls.map(([kind]) => kind), ['defer', 'edit']);
  assert.equal(calls[1][1].embeds[0].title, '🏆 Leaderboard');
  assert.equal(body(calls[1][1]).split('\n').length, 3);
});

test('the message event feeds the xp service through the client app', async () => {
  const world = await createWorld();
  const { default: event } = await import('../src/events/messagexp.js');
  assert.equal(event.name, 'messageCreate');
  await event.execute(chatMessage(world, 'hello there'), { app: world.app, ...world.client });
  assert.equal(world.app.levels.count(GUILD), 1);
});
