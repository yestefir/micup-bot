import test from 'node:test';
import assert from 'node:assert/strict';
import { Permission } from 'micup.ts';
import { formatDuration, parseDuration } from '../src/utils/args/duration.js';
import { BOT, GUILD, OUTSIDER, actorFor, apiError, body, colorOf, createWorld, run } from './support/fakes.js';

test('parseDuration reads units and combinations', () => {
  assert.equal(parseDuration('10m'), 600000);
  assert.equal(parseDuration('1h30m'), 5400000);
  assert.equal(parseDuration('2sa'), 7200000);
  assert.equal(parseDuration('1g'), 86400000);
  assert.equal(parseDuration('1W'), 604800000);
  assert.equal(parseDuration('365d'), 365 * 86400000);
});

test('parseDuration rejects invalid input', () => {
  for (const value of ['90', 'abc', '', '0m', '366d', '10x', '-5m', '1h 30m', undefined]) {
    assert.equal(parseDuration(value), null, String(value));
  }
});

test('formatDuration is compact', () => {
  assert.equal(formatDuration(5400000), '1h 30m');
  assert.equal(formatDuration(90061000), '1d 1h 1m 1s');
  assert.equal(formatDuration(0), '0s');
});

test('all four moderation commands are loaded', async () => {
  const world = await createWorld();
  assert.deepEqual([...world.client.slash.keys()].sort(), ['ban', 'leaderboard', 'mute', 'ping', 'purge', 'rank', 'settings']);
  assert.ok(world.interactions.prefix.commands.has('mute'));
  assert.ok(world.interactions.prefix.commands.has('ban'));
});

test('hierarchy: actor cannot act on a higher or equal role', async () => {
  const world = await createWorld();
  assert.equal(body(await run(world, '!ban <@H>', 'A')), 'Bu kullanıcının rolü seninkinden yüksek veya eşit.');
  assert.equal(body(await run(world, '!ban <@A>', 'T')), 'Bu kullanıcının rolü seninkinden yüksek veya eşit.');
  assert.equal(world.calls.ban.length, 0);
});

test('hierarchy: the bot cannot act on a role above its own', async () => {
  const world = await createWorld();
  const reply = await run(world, '!ban <@TOP>', 'ADMIN');
  assert.equal(body(reply), 'Bu kullanıcının rolü benimkinden yüksek veya eşit.');
  assert.equal(world.calls.ban.length, 0);
});

test('self, bot and owner are protected', async () => {
  const world = await createWorld();
  assert.equal(body(await run(world, '!ban <@A>', 'A')), 'Bu işlemi kendine uygulayamazsın.');
  assert.equal(body(await run(world, `!ban <@${BOT}>`, 'A')), 'Bu işlemi bana uygulayamam.');
  assert.equal(body(await run(world, '!ban <@O>', 'A')), 'Sunucu sahibine bu işlem uygulanamaz.');
  assert.equal(world.calls.ban.length, 0);
});

test('missing permission blocks ban and mute', async () => {
  const world = await createWorld();
  const ban = await run(world, '!ban <@T>', 'A', Permission.ModerateMembers);
  assert.match(body(ban), /yetkiye sahip olmalısın/);
  const mute = await run(world, '!mute <@T>', 'A', Permission.BanMembers);
  assert.match(body(mute), /yetkiye sahip olmalısın/);
  assert.equal(world.calls.ban.length + world.calls.timeout.length, 0);
});

test('mute needs the timeout permission and names it in the server language', async () => {
  const world = await createWorld();
  const denied = await run(world, '!mute <@T>', 'A', Permission.BanMembers | Permission.ManageMessages);
  assert.equal(body(denied), 'Bu yetkiye sahip olmalısın: Üyelere Zaman Aşımı Uygula');
  assert.equal(colorOf(denied), 0xed4245);

  world.app.settings.set(GUILD, 'language', 'en-US');
  const english = await run(world, '!mute <@T>', 'A', Permission.BanMembers);
  assert.equal(body(english), 'You need this permission: Timeout Members');

  const allowed = await run(world, '!mute <@T>', 'A', Permission.ModerateMembers);
  assert.equal(colorOf(allowed), 0x5865f2);
  assert.equal(world.calls.timeout.length, 1);
});

test('the bot also needs the timeout permission', async () => {
  const world = await createWorld();
  world.client.permissionsFor = () => Permission.BanMembers;
  const reply = await run(world, '!mute <@T>', 'A');
  assert.equal(body(reply), 'Benim şu yetkiye ihtiyacım var: Üyelere Zaman Aşımı Uygula');
  assert.equal(world.calls.timeout.length, 0);
});

test('slash mute is refused for members without the timeout permission', async () => {
  const world = await createWorld();
  const replies = [];
  const interaction = {
    guildId: GUILD,
    channelId: '200',
    locale: 'de',
    commandName: 'mute',
    member: actorFor(world, 'A', Permission.BanMembers),
    deferred: false,
    replied: false,
    options: { getUser: () => ({ id: 'T' }) },
    async reply(payload) {
      replies.push(payload);
    },
  };
  await world.client.slash.get('mute')(interaction);
  assert.equal(body(replies[0]), 'Dir fehlt diese Berechtigung: Mitglieder timeouten');
  assert.equal(replies[0].ephemeral, true);
  assert.equal(world.calls.timeout.length, 0);
});

