import test from 'node:test';
import assert from 'node:assert/strict';
import { Permission } from 'micup.ts';
import { createApp } from '../src/app.js';
import { Interactions } from '../src/core/interaction/core.js';

const GUILD = '100000000000000001';
const body = (payload) => payload.embeds[0].description;
const colorOf = (payload) => payload.embeds[0].color;
const CHANNEL = '200000000000000001';

function silent() {
  return { info() {}, error() {}, warn() {} };
}

function createClient(app) {
  const slash = new Map();
  return {
    app,
    user: { id: '900000000000000001' },
    slash,
    command(builder, handler) {
      slash.set(builder.toJSON().name, handler);
      return this;
    },
    permissionsFor: () => Permission.All,
    on() {
      return this;
    },
  };
}

function createChannel(history) {
  const sent = [];
  const deleted = [];
  return {
    sent,
    deleted,
    async send(content) {
      sent.push(content);
      return { delete: async () => {} };
    },
    async fetchMessages({ limit, before }) {
      const older = history.filter((message) => (before ? BigInt(message.id) < BigInt(before) : true));
      return older.sort((a, b) => Number(BigInt(b.id) - BigInt(a.id))).slice(0, limit);
    },
    async bulkDelete(ids) {
      deleted.push(...ids);
    },
  };
}

function createMessage(channel, content, { permissions = Permission.All, id = '500', authorId = '300' } = {}) {
  const replies = [];
  return {
    id,
    content,
    replies,
    author: { id: authorId, bot: false },
    fromSelf: false,
    guildId: GUILD,
    channelId: CHANNEL,
    channel: channel,
    member: { hasPermission: (needed) => (permissions & needed) === needed },
    delete: async () => {},
    reply: async (text) => {
      replies.push(text);
    },
  };
}

async function setup(history = []) {
  const app = createApp({ databasePath: ':memory:', logger: silent() });
  app.logger = silent();
  const client = createClient(app);
  const interactions = new Interactions(client, app);
  await interactions.initialize();
  const channel = createChannel(history);
  return { app, client, interactions, channel };
}

const history = (count, authorOf = () => '300') =>
  Array.from({ length: count }, (_, index) => ({ id: String(1000 + index), author: { id: authorOf(index) } }));

test('loads both slash commands and both prefix commands', async () => {
  const { client, interactions } = await setup();
  assert.deepEqual([...client.slash.keys()].sort(), ['ban', 'leaderboard', 'mute', 'ping', 'purge', 'rank', 'settings']);
  assert.deepEqual([...interactions.prefix.commands.keys()].sort(), ['ban', 'leaderboard', 'mute', 'ping', 'purge', 'rank', 'settings']);
});

test('prefix sil deletes the requested number of messages before the command', async () => {
  const { interactions, channel } = await setup(history(30));
  const message = createMessage(channel, '!sil 5', { id: '5000' });
  await interactions.prefix.handleMessage(message);
  assert.equal(channel.deleted.length, 5);
  assert.deepEqual(channel.deleted, ['1029', '1028', '1027', '1026', '1025']);
  assert.match(body(channel.sent.at(-1)), /5/);
  assert.equal(colorOf(channel.sent.at(-1)), 0x57f287);
});

test('prefix sil works with a localized alias and a user filter', async () => {
  const authorOf = (index) => (index % 2 ? '777777' : '300');
  const { interactions, channel } = await setup(history(20, authorOf));
  const message = createMessage(channel, '!purge 3 <@777777>', { id: '5000' });
  await interactions.prefix.handleMessage(message);
  assert.equal(channel.deleted.length, 3);
  assert.ok(channel.deleted.every((id) => authorOf(Number(id) - 1000) === '777777'));
});

test('prefix sil rejects bad input with usage and respects the max setting', async () => {
  const { app, interactions, channel } = await setup(history(10));
  const wrong = createMessage(channel, '!sil abc');
  await interactions.prefix.handleMessage(wrong);
  assert.match(body(wrong.replies.at(-1)), /Kullanım: !sil <miktar> \[kullanici\]/);
  assert.equal(colorOf(wrong.replies.at(-1)), 0xfee75c);

  app.settings.set(GUILD, 'purge.maxAmount', 5);
  const tooMany = createMessage(channel, '!sil 6');
  await interactions.prefix.handleMessage(tooMany);
  assert.match(body(tooMany.replies.at(-1)), /en fazla 5/);

  const missingUser = createMessage(channel, '!sil 3 nobody');
  await interactions.prefix.handleMessage(missingUser);
  assert.match(body(missingUser.replies.at(-1)), /Kullanım:/);

  assert.equal(channel.deleted.length, 0);
  assert.equal(channel.sent.length, 0);
});

test('prefix sil is refused without ManageMessages', async () => {
  const { interactions, channel } = await setup(history(10));
  const message = createMessage(channel, '!sil 3', { permissions: 0n });
  await interactions.prefix.handleMessage(message);
  assert.equal(channel.deleted.length, 0);
  assert.match(body(message.replies.at(-1)), /yetkiye sahip olmalısın/);
  assert.equal(colorOf(message.replies.at(-1)), 0xed4245);
});

test('messages without the prefix and bot messages are ignored', async () => {
  const { interactions, channel } = await setup(history(10));
  await interactions.prefix.handleMessage(createMessage(channel, 'sil 3'));
  const bot = createMessage(channel, '!sil 3');
  bot.author.bot = true;
  await interactions.prefix.handleMessage(bot);
  assert.equal(channel.deleted.length, 0);
  assert.equal(channel.sent.length, 0);
});

test('slash sil responds ephemerally and deletes messages', async () => {
  const { client, channel } = await setup(history(30));
  const calls = [];
  const interaction = {
    guildId: GUILD,
    channelId: CHANNEL,
    locale: 'en',
    commandName: 'purge',
    member: { hasPermission: () => true },
    channel,
    deferred: false,
    replied: false,
    options: {
      getInteger: () => 7,
      getUser: () => null,
    },
    async deferReply(options) {
      this.deferred = true;
      calls.push(['defer', options]);
    },
    async editReply(content) {
      calls.push(['edit', content]);
    },
    async reply(options) {
      calls.push(['reply', options]);
    },
  };
  await client.slash.get('purge')(interaction);
  assert.equal(channel.deleted.length, 7);
  assert.deepEqual(calls[0], ['defer', { ephemeral: true }]);
  assert.equal(body(calls[1][1]), 'Messages deleted: 7');
  assert.equal(colorOf(calls[1][1]), 0x57f287);
});

test('slash without permission is refused in the user language', async () => {
  const { client } = await setup();
  const replies = [];
  const interaction = {
    guildId: GUILD,
    channelId: CHANNEL,
    locale: 'ru',
    commandName: 'purge',
    member: { hasPermission: () => false },
    deferred: false,
    replied: false,
    async reply(options) {
      replies.push(options);
    },
  };
  await client.slash.get('purge')(interaction);
  assert.match(body(replies[0]), /Тебе нужно разрешение/);
  assert.equal(replies[0].embeds[0].title, '❌ Ошибка');
});
