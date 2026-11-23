import test from 'node:test';
import assert from 'node:assert/strict';
import { loadImage } from '@napi-rs/canvas';
import cardConfig from '../src/config/general/card.json' with { type: 'json' };
import { WELCOME_LAYOUT, renderWelcomeCard } from '../src/utils/levels/card/render.js';
import { fillTemplate, sendWelcome } from '../src/utils/welcome/service.js';
import { GUILD, createWorld } from './support/fakes.js';

const { scale } = cardConfig;
const CHANNEL = '88888';

const newMember = (overrides = {}) => ({
  id: 'N',
  guildId: GUILD,
  bot: false,
  displayName: 'Newcomer',
  user: { id: 'N', displayName: 'Newcomer', avatarURL: () => null },
  ...overrides,
});

function withChannel(world, { fail = false, guildId = GUILD } = {}) {
  const posts = [];
  world.client.channels = {
    get: (id) => (id === CHANNEL ? { guildId, send: async (payload) => (fail ? Promise.reject(new Error('no access')) : posts.push(payload)) } : undefined),
    fetch: async () => null,
  };
  world.guilds[GUILD].name = 'Micup HQ';
  world.guilds[GUILD].memberCount = 42;
  world.app.settings.set(GUILD, 'welcome.channel', CHANNEL);
  return posts;
}

const stubCard = (world) => {
  const calls = [];
  world.app.cards.welcome = async (data) => (calls.push(data), Buffer.from('welcome-png'));
  return calls;
};

test('the welcome card is a PNG of the layout size', async () => {
  const png = await renderWelcomeCard({
    name: 'Şükrü Ağaoğlu',
    avatar: null,
    lang: 'tr',
    labels: { welcome: 'Hoş geldin' },
    subtitle: 'Micup HQ · 42. üye',
  });
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  const image = await loadImage(png);
  assert.equal(image.width, WELCOME_LAYOUT.width * scale);
  assert.equal(image.height, WELCOME_LAYOUT.height * scale);
});

test('very long names and subtitles still render', async () => {
  const long = 'W'.repeat(300);
  const png = await renderWelcomeCard({ name: long, avatar: null, lang: 'en-US', labels: { welcome: 'Welcome' }, subtitle: long });
  assert.ok(png.length > 100);
});

test('fillTemplate replaces only the known placeholders', () => {
  assert.equal(fillTemplate('{user} / {server} / {count} / {other}', { user: '<@1>', server: 'S', count: '5' }), '<@1> / S / 5 / {other}');
});

test('a new member is welcomed with the card, a mention and the default text', async () => {
  const world = await createWorld();
  const posts = withChannel(world);
  const calls = stubCard(world);

  const outcome = await sendWelcome({ app: world.app, client: world.client, member: newMember() });

  assert.deepEqual(outcome, { card: true });
  assert.equal(posts.length, 1);
  assert.match(posts[0].content, /<@N>/);
  assert.match(posts[0].content, /Micup HQ/);
  assert.equal(posts[0].files.length, 1);
  assert.deepEqual(posts[0].allowed_mentions, { users: ['N'] });
  assert.equal(calls[0].name, 'Newcomer');
  assert.match(calls[0].subtitle, /Micup HQ/);
  assert.match(calls[0].subtitle, /42/);
});

test('a custom message is used with its placeholders filled', async () => {
  const world = await createWorld();
  const posts = withChannel(world);
  stubCard(world);
  world.app.settings.set(GUILD, 'welcome.message', 'Hi {user}, you are #{count} on {server}');

  await sendWelcome({ app: world.app, client: world.client, member: newMember() });

  assert.equal(posts[0].content, 'Hi <@N>, you are #42 on Micup HQ');
});

test('nothing happens without a channel, for bots, or in a channel of another server', async () => {
  const world = await createWorld();
  stubCard(world);
  assert.equal(await sendWelcome({ app: world.app, client: world.client, member: newMember() }), null);

  const posts = withChannel(world);
  assert.equal(await sendWelcome({ app: world.app, client: world.client, member: newMember({ bot: true }) }), null);
  assert.equal(posts.length, 0);

  const foreign = withChannel(world, { guildId: 'OTHER' });
  assert.equal(await sendWelcome({ app: world.app, client: world.client, member: newMember() }), null);
  assert.equal(foreign.length, 0);
  assert.ok(world.logs.some((line) => line.startsWith('[welcome]')));
});

test('if the card cannot be drawn a green embed is posted instead', async () => {
  const world = await createWorld();
  const posts = withChannel(world);
  world.app.cards.welcome = async () => {
    throw new Error('canvas unavailable');
  };

  const outcome = await sendWelcome({ app: world.app, client: world.client, member: newMember() });

  assert.deepEqual(outcome, { card: false });
  assert.equal(posts[0].embeds[0].color, 0x57f287);
  assert.match(posts[0].embeds[0].description, /<@N>/);
  assert.equal(posts[0].files, undefined);
});

test('a channel that cannot be posted to is logged and never throws', async () => {
  const world = await createWorld();
  withChannel(world, { fail: true });
  stubCard(world);

  assert.equal(await sendWelcome({ app: world.app, client: world.client, member: newMember() }), null);
  assert.ok(world.logs.some((line) => line.includes('could not welcome N')));
});

test('the welcome text follows the server language', async () => {
  const world = await createWorld();
  const posts = withChannel(world);
  const calls = stubCard(world);
  world.app.settings.set(GUILD, 'language', 'en-US');

  await sendWelcome({ app: world.app, client: world.client, member: newMember() });

  assert.equal(posts[0].content, 'Welcome to Micup HQ, <@N>!');
  assert.equal(calls[0].labels.welcome, 'Welcome');
});
