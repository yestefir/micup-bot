import test from 'node:test';
import assert from 'node:assert/strict';
import { Permission } from 'micup.ts';
import guildDelete from '../src/events/guilddelete.js';
import { levelFromXp } from '../src/utils/levels/formula.js';
import { handleMessageXp } from '../src/utils/levels/service.js';
import { GUILD, body, colorOf, createWorld, run, settle } from './support/fakes.js';

const NONE = 0n;
const SUCCESS = 0x57f287;
const noRandom = () => 0;

function chat(channelId, member) {
  return {
    content: 'hello',
    guildId: GUILD,
    channelId,
    member,
    author: { id: 'T', bot: false, displayName: 'T', avatarURL: () => null },
    fromSelf: false,
    reply: async () => ({ delete: async () => {} }),
    channel: { send: async () => ({ delete: async () => {} }) },
  };
}

test('help lists the commands with the server prefix', async () => {
  const world = await createWorld();
  const reply = await run(world, '!help', 'A');
  assert.match(body(reply), /!seviye/);
  assert.match(body(reply), /!xpayarla/);
  assert.equal(reply.embeds[0].footer.text.length > 0, true);
});

test('avatar, userinfo and serverinfo answer without errors', async () => {
  const world = await createWorld();
  assert.equal(colorOf(await run(world, '!avatar', 'A')), 0x5865f2);
  assert.match(body(await run(world, '!userinfo <@T>', 'A')), /<@T>/);
  assert.equal(colorOf(await run(world, '!serverinfo', 'A')), 0x5865f2);
  assert.match(body(await run(world, '!avatar nonsense', 'A')), /!avatar/);
});

test('xpadjust adds and removes xp but never goes below zero', async () => {
  const world = await createWorld();
  await run(world, '!xpadjust <@T> 120', 'A');
  assert.equal(world.app.levels.get(GUILD, 'T').xp, 120);
  const reply = await run(world, '!xpadjust <@T> -50', 'A');
  assert.equal(colorOf(reply), SUCCESS);
  assert.equal(world.app.levels.get(GUILD, 'T').xp, 70);
  await run(world, '!xpadjust <@T> -500', 'A');
  assert.equal(world.app.levels.get(GUILD, 'T').xp, 0);
  assert.match(body(await run(world, '!xpadjust <@T> abc', 'A')), /!xpayarla/);
});

test('xpreset clears the row and says so when there is nothing to clear', async () => {
  const world = await createWorld();
  world.app.levels.adjustXp(GUILD, 'T', 40);
  assert.equal(colorOf(await run(world, '!xpreset <@T>', 'A')), SUCCESS);
  assert.equal(world.app.levels.get(GUILD, 'T'), null);
  assert.equal(colorOf(await run(world, '!xpreset <@T>', 'A')), 0x5865f2);
});

test('the admin commands need Manage Server', async () => {
  const world = await createWorld();
  world.app.levels.adjustXp(GUILD, 'T', 40);
  await run(world, '!xpreset <@T>', 'A', NONE);
  await run(world, '!xpadjust <@T> 10', 'A', NONE);
  await run(world, '!xpignore', 'A', NONE);
  await run(world, '!levelrole 5 <@&12345>', 'A', NONE);
  assert.equal(world.app.levels.get(GUILD, 'T').xp, 40);
  assert.equal(world.app.levels.ignored(GUILD).length, 0);
  assert.equal(world.app.levels.rewards(GUILD).length, 0);
  assert.equal(Permission.ManageGuild > 0n, true);
});

test('levelrole sets, lists and removes rewards and validates the level', async () => {
  const world = await createWorld();
  const { levels } = world.app;
  await run(world, '!levelrole 10 <@&12345>', 'A');
  await run(world, '!levelrole 5 <@&54321>', 'A');
  assert.deepEqual(levels.rewards(GUILD), [{ level: 5, roleId: '54321' }, { level: 10, roleId: '12345' }]);
  const list = await run(world, '!levelrole', 'A');
  assert.match(body(list), /<@&54321>[\s\S]*<@&12345>/);
  await run(world, '!levelrole 5', 'A');
  assert.deepEqual(levels.rewards(GUILD), [{ level: 10, roleId: '12345' }]);
  assert.equal(colorOf(await run(world, '!levelrole 0 <@&12345>', 'A')), 0xfee75c);
  assert.equal(colorOf(await run(world, '!levelrole 5', 'A')), 0x5865f2);
});

test('reaching a reward level gives the role once and skips roles the member already has', async () => {
  const world = await createWorld();
  const { app, client } = world;
  app.levels.setReward(GUILD, 1, 'r1');
  app.levels.setReward(GUILD, 2, 'r2');
  app.levels.adjustXp(GUILD, 'T', 90);
  app.settings.set(GUILD, 'levels.announce', 'off');
  app.settings.set(GUILD, 'levels.xpMin', 100);
  app.settings.set(GUILD, 'levels.xpMax', 100);

  const added = [];
  const member = { id: 'T', hasRole: (id) => id === 'r2', addRole: async (id) => added.push(id) };
  const result = await handleMessageXp({ app, client, message: chat('200', member), now: 1_000_000, random: noRandom });

  assert.equal(result.leveledUp, true);
  assert.equal(levelFromXp(result.after) >= 1, true);
  assert.deepEqual(added, ['r1']);
});

test('a failing reward role does not break the xp flow', async () => {
  const world = await createWorld();
  const { app, client } = world;
  app.levels.setReward(GUILD, 1, 'r1');
  app.settings.set(GUILD, 'levels.announce', 'off');
  app.settings.set(GUILD, 'levels.xpMin', 100);
  app.settings.set(GUILD, 'levels.xpMax', 100);
  const member = { id: 'T', hasRole: () => false, addRole: async () => { throw new Error('nope'); } };
  const result = await handleMessageXp({ app, client, message: chat('200', member), now: 1_000_000, random: noRandom });
  assert.equal(result.leveledUp, true);
});

test('xpignore toggles a channel and ignored channels earn nothing', async () => {
  const world = await createWorld();
  const { app, client } = world;

  await run(world, '!xpignore <#777777>', 'A');
  assert.deepEqual(app.levels.ignored(GUILD), ['777777']);
  assert.equal(await handleMessageXp({ app, client, message: chat('777777'), now: 1, random: noRandom }), null);
  assert.ok(await handleMessageXp({ app, client, message: chat('200'), now: 1, random: noRandom }));

  await run(world, '!xpignore <#777777>', 'A');
  assert.deepEqual(app.levels.ignored(GUILD), []);

  await run(world, '!xpignore', 'A');
  assert.deepEqual(app.levels.ignored(GUILD), ['200']);
});

function withLogChannel(world) {
  const posts = [];
  world.client.channels = { get: (id) => (id === '88888' ? { guildId: GUILD, send: async (payload) => posts.push(payload) } : undefined), fetch: async () => null };
  world.app.settings.set(GUILD, 'moderation.logChannel', '88888');
  return posts;
}

test('without a log channel nothing is posted and a broken channel never breaks the action', async () => {
  const world = await createWorld();
  const { moderation } = await import('../src/utils/moderation/actions.js');
  const { createContext } = await import('../src/core/interaction/src/context.js');
  const context = createContext(world.app, world.client, { guildId: GUILD });
  const actor = { id: 'A', displayName: 'Ali' };

  const quiet = await moderation.applyBan(context, { actor, targetId: 'T' });
  assert.equal(quiet.type, 'success');

  const posts = withLogChannel(world);
  const logged = await moderation.applyBan(context, { actor, targetId: 'T', reason: 'spam' });
  assert.equal(logged.type, 'success');
  assert.equal(posts.length, 1);
  assert.match(posts[0].embeds[0].description, /<@A> → <@T>/);
  assert.deepEqual(posts[0].allowed_mentions, { parse: [] });

  world.client.channels.get = () => { throw new Error('gone'); };
  const survived = await moderation.applyMute(context, { actor, targetId: 'T', durationMs: 60000 });
  assert.equal(survived.type, 'success');
});

test('removing the bot from a server deletes its stored data', async () => {
  const world = await createWorld();
  const { app, client } = world;
  const OTHER = '100000000000000009';

  for (const guild of [GUILD, OTHER]) {
    app.settings.set(guild, 'prefix', '?');
    app.levels.adjustXp(guild, 'T', 10);
    app.levels.setReward(guild, 3, 'r');
    app.levels.toggleIgnored(guild, 'c');
    app.guildTags.record(guild, 'T', ['r']);
  }

  await guildDelete.execute({ id: GUILD, unavailable: true }, {}, client);
  assert.equal(app.levels.count(GUILD), 1);

  await guildDelete.execute({ id: GUILD }, {}, client);
  assert.equal(app.settings.isSet(GUILD, 'prefix'), false);
  assert.equal(app.levels.count(GUILD), 0);
  assert.deepEqual(app.levels.rewards(GUILD), []);
  assert.deepEqual(app.levels.ignored(GUILD), []);
  assert.equal(app.guildTags.count(GUILD), 0);

  assert.equal(app.settings.get(OTHER, 'prefix'), '?');
  assert.equal(app.levels.count(OTHER), 1);
  assert.equal(app.guildTags.count(OTHER), 1);
});

test('every command name is unique across languages', async () => {
  const world = await createWorld();
  const seen = new Map();
  for (const [key, command] of world.interactions.prefix.commands) {
    for (const name of new Set([key, ...world.app.i18n.names(key)])) {
      assert.equal(seen.has(name) && seen.get(name) !== key, false, `${name} belongs to ${seen.get(name)} and ${key}`);
      seen.set(name, key);
    }
    assert.ok(command.run);
  }
});

test('ping answers with a latency in milliseconds and never a negative one', async () => {
  const world = await createWorld();
  const reply = await run(world, '!ping', 'A');
  assert.equal(colorOf(reply), 0x5865f2);
  assert.match(body(reply), /\*\*\d+ ms\*\*/);

  const { pingView } = await import('../src/utils/message/ping.js');
  const { createContext } = await import('../src/core/interaction/src/context.js');
  const context = createContext(world.app, world.client, { guildId: GUILD });
  assert.match(pingView(context, new Date(Date.now() + 60_000)).text, /\*\*0 ms\*\*/);
  assert.match(pingView(context, new Date(Date.now() - 250)).text, /\*\*\d{3,} ms\*\*/);
});
