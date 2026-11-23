import test from 'node:test';
import assert from 'node:assert/strict';
import { handleMessageXp } from '../src/utils/levels/service.js';
import { GUILD, body, colorOf, createWorld } from './support/fakes.js';

const fixedRandom = (value) => () => value;
const PNG_SIGNATURE = '89504e470d0a1a0a';

function chatMessage(content, authorId = 'T', extra = {}) {
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
  const calls = { levelUp: [] };
  world.app.cards = {
    rank: async () => Buffer.from('rank-png'),
    leaderboard: async () => Buffer.from('leaderboard-png'),
    levelUp: async (data) => (calls.levelUp.push(data), Buffer.from('levelup-png')),
  };
  return calls;
}

function failingCards(world) {
  const broken = async () => {
    throw new Error('canvas unavailable');
  };
  world.app.cards = { rank: broken, levelUp: broken, leaderboard: broken };
}

async function levelUpWorld() {
  const world = await createWorld();
  world.app.settings.set(GUILD, 'levels.xpMin', 10);
  world.app.settings.set(GUILD, 'levels.xpMax', 10);
  world.app.levels.addMessageXp(GUILD, 'T', 95, 0);
  return world;
}

const levelUp = (world, message) =>
  handleMessageXp({ app: world.app, client: world.client, message, now: 10_000_000, random: fixedRandom(0) });

function levelChannel(world, { channel = {}, fetchError = null, cached = false } = {}) {
  const sent = [];
  const fetches = [];
  const target = { id: '900001', guildId: GUILD, send: async (payload) => (sent.push(payload), {}), ...channel };
  world.client.channels = {
    get: () => (cached ? target : undefined),
    fetch: async (id) => {
      fetches.push(id);
      if (fetchError) throw fetchError;
      return target;
    },
  };
  world.app.settings.set(GUILD, 'levels.channel', '900001');
  return { sent, fetches, target };
}

test('the level channel is a channel setting that is empty by default', async () => {
  const world = await createWorld();
  const definition = world.app.settings.definition('levels.channel');
  assert.deepEqual(
    { type: definition.type, category: definition.category, default: definition.default, editable: definition.editable },
    { type: 'channel', category: 'levels', default: null, editable: true },
  );
  assert.equal(world.app.settings.get(GUILD, 'levels.channel'), null);
});

test('without a level channel the card is a reply where the member leveled up', async () => {
  const world = await levelUpWorld();
  const cards = stubCards(world);
  const refuse = async () => {
    throw new Error('must not look up a channel');
  };
  world.client.channels = { get: refuse, fetch: refuse };
  const message = chatMessage('hello');

  await levelUp(world, message);

  assert.equal(message.replies.length, 1);
  assert.equal(message.replies[0].files[0].name, 'card.png');
  assert.equal(message.replies[0].content, undefined);
  assert.equal(cards.levelUp.length, 1);
});

test('with a level channel the card goes there with a mention and nothing is replied in place', async () => {
  const world = await levelUpWorld();
  const cards = stubCards(world);
  const { sent, fetches } = levelChannel(world);
  const message = chatMessage('hello', 'T', { author: { id: 'T', bot: false, displayName: 'Taylor', avatarURL: () => null } });

  await levelUp(world, message);

  assert.equal(message.replies.length, 0);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].content, '<@T>');
  assert.deepEqual(sent[0].allowed_mentions, { users: ['T'] });
  assert.equal(sent[0].embeds, undefined);
  assert.equal(sent[0].files[0].name, 'card.png');
  assert.equal(sent[0].files[0].data.type, 'image/png');
  assert.equal(await sent[0].files[0].data.text(), 'levelup-png');
  assert.equal(sent[0].files[0].description, 'Taylor · Seviye atladı · Seviye 0 → 1');
  assert.deepEqual(fetches, ['900001']);
  assert.equal(cards.levelUp[0].from, 0);
  assert.equal(cards.levelUp[0].level, 1);
});

test('a cached channel is used without asking the server', async () => {
  const world = await levelUpWorld();
  stubCards(world);
  const { sent, fetches } = levelChannel(world, { cached: true });
  await levelUp(world, chatMessage('hello'));
  assert.equal(sent.length, 1);
  assert.deepEqual(fetches, []);
});

test('only the member who leveled up is pinged', async () => {
  const world = await levelUpWorld();
  stubCards(world);
  const { sent } = levelChannel(world);
  await levelUp(world, chatMessage('@everyone <@999> hello'));
  assert.deepEqual(sent[0].allowed_mentions, { users: ['T'] });
  assert.equal(sent[0].content, '<@T>');
});

test('the card keeps following the server language when it goes to the channel', async () => {
  const world = await levelUpWorld();
  const cards = stubCards(world);
  levelChannel(world);
  world.app.settings.set(GUILD, 'language', 'de');
  await levelUp(world, chatMessage('hello'));
  assert.equal(cards.levelUp[0].lang, 'de');
  assert.equal(cards.levelUp[0].labels.levelUp, 'Aufgestiegen');
});

test('if the channel cannot be posted to the card is replied in place instead', async () => {
  const world = await levelUpWorld();
  stubCards(world);
  const { sent } = levelChannel(world, {
    channel: {
      send: async () => {
        throw new Error('Missing permissions');
      },
    },
  });
  const message = chatMessage('hello');

  await levelUp(world, message);

  assert.equal(sent.length, 0);
  assert.equal(message.replies.length, 1);
  assert.equal(message.replies[0].files[0].name, 'card.png');
  assert.ok(world.logs.includes('[levels] could not post the level up in channel 900001, replying in place: Missing permissions'));
});

test('if the channel no longer exists the card is replied in place instead', async () => {
  const world = await levelUpWorld();
  stubCards(world);
  levelChannel(world, { fetchError: new Error('Unknown channel') });
  const message = chatMessage('hello');

  await levelUp(world, message);

  assert.equal(message.replies.length, 1);
  assert.ok(world.logs.includes('[levels] could not post the level up in channel 900001, replying in place: Unknown channel'));
});

test('a channel that belongs to another server is never used', async () => {
  const world = await levelUpWorld();
  stubCards(world);
  const { sent } = levelChannel(world, { channel: { guildId: '999999999' } });
  const message = chatMessage('hello');

  await levelUp(world, message);

  assert.equal(sent.length, 0);
  assert.equal(message.replies.length, 1);
  assert.ok(world.logs.some((line) => line.includes('the level channel does not belong to this server')));
});

test('when the card cannot be drawn the channel gets a mention and the green embed', async () => {
  const world = await levelUpWorld();
  failingCards(world);
  const { sent } = levelChannel(world);
  const message = chatMessage('hello');

  await levelUp(world, message);

  assert.equal(message.replies.length, 0);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].content, '<@T>');
  assert.deepEqual(sent[0].allowed_mentions, { users: ['T'] });
  assert.equal(sent[0].files, undefined);
  assert.equal(body(sent[0]), '<@T> seviye atladı! Yeni seviye: **1**');
  assert.equal(colorOf(sent[0]), 0x57f287);
});

test('when neither the card nor the channel works the embed is still replied in place', async () => {
  const world = await levelUpWorld();
  failingCards(world);
  levelChannel(world, { fetchError: new Error('gone') });
  const message = chatMessage('hello');

  await levelUp(world, message);

  assert.equal(message.replies.length, 1);
  assert.equal(body(message.replies[0]), '<@T> seviye atladı! Yeni seviye: **1**');
});

test('if the card was drawn but cannot be sent in place the embed is used', async () => {
  const world = await levelUpWorld();
  stubCards(world);
  const message = chatMessage('hello', 'T', {
    reply: async (payload) => {
      if (payload.files) throw new Error('files rejected');
      message.replies.push(payload);
      return { delete: async () => {} };
    },
    channel: {
      send: async (payload) => {
        if (payload.files) throw new Error('files rejected');
        message.replies.push(payload);
        return { delete: async () => {} };
      },
    },
  });

  await levelUp(world, message);

  assert.equal(message.replies.length, 1);
  assert.equal(body(message.replies[0]), '<@T> seviye atladı! Yeni seviye: **1**');
  assert.ok(world.logs.some((line) => line.startsWith('[levels] level up card could not be sent')));
});

test('announcements that are switched off send nothing even with a channel', async () => {
  const world = await levelUpWorld();
  stubCards(world);
  const { sent, fetches } = levelChannel(world);
  world.app.settings.set(GUILD, 'levels.announce', 'off');
  const message = chatMessage('hello');

  const outcome = await levelUp(world, message);

  assert.equal(outcome.leveledUp, true);
  assert.equal(sent.length, 0);
  assert.equal(message.replies.length, 0);
  assert.deepEqual(fetches, []);
});

test('clearing the level channel goes back to replying in place', async () => {
  const world = await levelUpWorld();
  stubCards(world);
  const { sent } = levelChannel(world);

  world.app.settings.reset(GUILD, 'levels.channel');
  assert.equal(world.app.settings.get(GUILD, 'levels.channel'), null);
  const message = chatMessage('hello');
  await levelUp(world, message);

  assert.equal(sent.length, 0);
  assert.equal(message.replies.length, 1);
});

test('the real card is what reaches the level channel', async () => {
  const world = await levelUpWorld();
  const { sent } = levelChannel(world);
  await levelUp(world, chatMessage('hello'));

  const bytes = Buffer.from(await sent[0].files[0].data.arrayBuffer());
  assert.equal(bytes.subarray(0, 8).toString('hex'), PNG_SIGNATURE);
  assert.ok(bytes.length > 3000);
  assert.equal(sent[0].content, '<@T>');
});

test('each level up in the channel is a separate post and nothing is replied in place', async () => {
  const world = await createWorld();
  stubCards(world);
  const { sent } = levelChannel(world);
  world.app.settings.set(GUILD, 'levels.xpMin', 100);
  world.app.settings.set(GUILD, 'levels.xpMax', 100);
  world.app.settings.set(GUILD, 'levels.cooldownSeconds', 0);

  const first = chatMessage('a', 'T');
  const other = chatMessage('b', 'U');
  const run = (message, now) =>
    handleMessageXp({ app: world.app, client: world.client, message, now, random: fixedRandom(0) });
  await run(first, 1);
  await run(other, 2);
  await run(first, 3);

  assert.deepEqual(sent.map((payload) => payload.content), ['<@T>', '<@U>']);
  assert.equal(first.replies.length + other.replies.length, 0);
});
