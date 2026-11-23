import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, MicupAPIError, Permission } from 'micup.ts/easy';
import { createApp } from '../src/app.js';
import { eventcore } from '../src/core/event/eventcore.js';
import guildTagEvent from '../src/events/guildtag.js';
import { handleTagUpdate } from '../src/utils/guildtag/service.js';
import { BOT, GUILD, apiError, createWorld } from './support/fakes.js';

const ROLES = ['700001', '700002'];
const LOG_CHANNEL = '900100';
const OTHER_GUILD = '555000555';

const tagged = (userId = 'T', guildId = GUILD, extra = {}) => ({ id: userId, username: 'user', tag_guild_id: guildId, ...extra });
const untagged = (userId = 'T', extra = {}) => ({ id: userId, username: 'user', tag_guild_id: null, ...extra });

const update = (world, user, options = {}) => handleTagUpdate({ app: world.app, client: world.client, user, ...options });
const memberEvent = (world, user, roles = []) => update(world, user, { eventGuildId: GUILD, roles });
const warnings = (world) => world.logs.filter((line) => line.startsWith('[guildtag]'));

function logChannel(world, { channel = {}, fetchError = null, cached = false } = {}) {
  const sent = [];
  const fetches = [];
  const target = { id: LOG_CHANNEL, guildId: GUILD, send: async (payload) => (sent.push(payload), {}), ...channel };
  world.client.channels = {
    get: () => (cached ? target : undefined),
    fetch: async (id) => {
      fetches.push(id);
      if (fetchError) throw fetchError;
      return target;
    },
  };
  world.app.settings.set(GUILD, 'guildtag.logChannel', LOG_CHANNEL);
  return { sent, fetches };
}

const embedOf = (payload) => payload.embeds[0];
const fieldsOf = (payload) => Object.fromEntries(embedOf(payload).fields.map((field) => [field.name, field.value]));

test('wearing the server tag gives every configured role and remembers what was given', async () => {
  const world = await createWorld();
  world.app.settings.set(GUILD, 'guildtag.roles', ROLES);

  await memberEvent(world, tagged());

  assert.deepEqual(world.calls.addRole, ROLES.map((roleId) => [GUILD, 'T', roleId, { reason: 'Guild tag' }]));
  assert.deepEqual(world.app.guildTags.granted(GUILD, 'T'), ROLES);
});

test('a single role works the same as several', async () => {
  const world = await createWorld();
  world.app.settings.set(GUILD, 'guildtag.roles', ['700001']);
  await memberEvent(world, tagged());
  assert.equal(world.calls.addRole.length, 1);
  assert.deepEqual(world.app.guildTags.granted(GUILD, 'T'), ['700001']);
});

test('the log channel gets a green embed with the user, the tag and the roles, without pinging anyone', async () => {
  const world = await createWorld();
  world.app.settings.set(GUILD, 'guildtag.roles', ROLES);
  const { sent, fetches } = logChannel(world);

  await memberEvent(world, tagged());

  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].allowed_mentions, { parse: [] });
  const embed = embedOf(sent[0]);
  assert.equal(embed.color, 0x57f287);
  assert.equal(embed.title, '🏷️ Sunucu etiketi takıldı');
  assert.equal(embed.description, '<@T> sunucu etiketini taktı.');
  assert.deepEqual(fieldsOf(sent[0]), { Etiket: '**ABC**', 'Verilen roller': '<@&700001> <@&700002>' });
  assert.match(embed.timestamp, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(fetches, [LOG_CHANNEL]);
});

test('without a log channel the roles are still given and nothing is posted', async () => {
  const world = await createWorld();
  world.app.settings.set(GUILD, 'guildtag.roles', ROLES);
  const refuse = async () => {
    throw new Error('must not look up a channel');
  };
  world.client.channels = { get: refuse, fetch: refuse };

  await memberEvent(world, tagged());

  assert.equal(world.calls.addRole.length, 2);
  assert.deepEqual(warnings(world), []);
});

test('with only a log channel nothing is given but the adoption is logged and remembered', async () => {
  const world = await createWorld();
  const { sent } = logChannel(world);

  await memberEvent(world, tagged());

  assert.equal(world.calls.addRole.length, 0);
  assert.equal(sent.length, 1);
  assert.deepEqual(fieldsOf(sent[0]), { Etiket: '**ABC**' });
  assert.equal(world.app.guildTags.has(GUILD, 'T'), true);
});

test('a server with neither roles nor a log channel is left alone', async () => {
  const world = await createWorld();
  await memberEvent(world, tagged());
  assert.equal(world.calls.addRole.length, 0);
  assert.equal(world.app.guildTags.has(GUILD, 'T'), false);
});

test('the same member event again does not repeat the roles or the log', async () => {
  const world = await createWorld();
  world.app.settings.set(GUILD, 'guildtag.roles', ROLES);
  const { sent } = logChannel(world);

  await memberEvent(world, tagged());
  await memberEvent(world, tagged(), ROLES);
  await memberEvent(world, tagged(), ROLES);

  assert.equal(world.calls.addRole.length, 2);
  assert.equal(sent.length, 1);
});

test('removing the tag takes back the roles that were given and logs it in orange', async () => {
  const world = await createWorld();
  world.app.settings.set(GUILD, 'guildtag.roles', ROLES);
  const { sent } = logChannel(world);
  await memberEvent(world, tagged());

  await memberEvent(world, untagged(), ROLES);

  assert.deepEqual(world.calls.removeRole, ROLES.map((roleId) => [GUILD, 'T', roleId, { reason: 'Guild tag removed' }]));
  assert.equal(world.app.guildTags.has(GUILD, 'T'), false);
  assert.equal(sent.length, 2);
  const embed = embedOf(sent[1]);
  assert.equal(embed.color, 0xfee75c);
  assert.equal(embed.title, '🏷️ Sunucu etiketi çıkarıldı');
  assert.equal(embed.description, '<@T> sunucu etiketini çıkardı.');
  assert.deepEqual(fieldsOf(sent[1]), { Etiket: '**ABC**', 'Geri alınan roller': '<@&700001> <@&700002>' });
  assert.deepEqual(sent[1].allowed_mentions, { parse: [] });
});

test('a second removal event changes nothing', async () => {
  const world = await createWorld();
  world.app.settings.set(GUILD, 'guildtag.roles', ROLES);
  const { sent } = logChannel(world);
  await memberEvent(world, tagged());
  await memberEvent(world, untagged());
  await memberEvent(world, untagged());
  assert.equal(world.calls.removeRole.length, 2);
  assert.equal(sent.length, 2);
});

test('an event for someone who never wore the tag changes nothing', async () => {
  const world = await createWorld();
  world.app.settings.set(GUILD, 'guildtag.roles', ROLES);
  const { sent } = logChannel(world);
  await memberEvent(world, untagged('Z'));
  assert.equal(world.calls.addRole.length + world.calls.removeRole.length, 0);
  assert.equal(sent.length, 0);
});

test('switching to the tag of another server counts as removing ours', async () => {
  const world = await createWorld();
  world.app.settings.set(GUILD, 'guildtag.roles', ROLES);
  const { sent } = logChannel(world);
  await memberEvent(world, tagged());

  await memberEvent(world, tagged('T', OTHER_GUILD));

  assert.equal(world.calls.removeRole.length, 2);
  assert.equal(world.app.guildTags.has(GUILD, 'T'), false);
  assert.equal(sent.length, 2);
  assert.equal(world.calls.addRole.length, 2);
});

test('wearing the tag of a server the bot is not in does nothing', async () => {
  const world = await createWorld();
  world.app.settings.set(GUILD, 'guildtag.roles', ROLES);
  await update(world, tagged('T', OTHER_GUILD));
  assert.equal(world.calls.addRole.length, 0);
  assert.equal(world.app.guildTags.has(OTHER_GUILD, 'T'), false);
});

test('an event that does not carry the tag field is ignored instead of read as a removal', async () => {
  const world = await createWorld();
  world.app.settings.set(GUILD, 'guildtag.roles', ROLES);
  await memberEvent(world, tagged());

  await memberEvent(world, { id: 'T', username: 'user' }, ROLES);
  await update(world, { id: 'T', username: 'renamed' });

  assert.equal(world.calls.removeRole.length, 0);
  assert.equal(world.app.guildTags.has(GUILD, 'T'), true);
});

test('bots, empty users and missing users are ignored', async () => {
  const world = await createWorld();
  world.app.settings.set(GUILD, 'guildtag.roles', ROLES);
  assert.equal(await update(world, tagged('B', GUILD, { bot: true })), null);
  assert.equal(await update(world, null), null);
  assert.equal(await update(world, undefined), null);
  assert.equal(await update(world, { tag_guild_id: GUILD }), null);
  assert.equal(world.calls.addRole.length, 0);
});

test('a role the member already had is not given and not taken away later', async () => {
  const world = await createWorld();
  world.app.settings.set(GUILD, 'guildtag.roles', ROLES);

  await memberEvent(world, tagged(), ['700001']);
  assert.deepEqual(world.calls.addRole.map((call) => call[2]), ['700002']);
  assert.deepEqual(world.app.guildTags.granted(GUILD, 'T'), ['700002']);

  await memberEvent(world, untagged(), ['700001', '700002']);
  assert.deepEqual(world.calls.removeRole.map((call) => call[2]), ['700002']);
});

test('roles changed in the settings after the adoption do not change what is taken back', async () => {
  const world = await createWorld();
  world.app.settings.set(GUILD, 'guildtag.roles', ['700001']);
  await memberEvent(world, tagged());

  world.app.settings.set(GUILD, 'guildtag.roles', ['700002', '700003']);
  await memberEvent(world, untagged());

  assert.deepEqual(world.calls.removeRole.map((call) => call[2]), ['700001']);
});

test('with remove roles switched off the roles stay but the removal is still logged', async () => {
  const world = await createWorld();
  world.app.settings.set(GUILD, 'guildtag.roles', ROLES);
  world.app.settings.set(GUILD, 'guildtag.removeRoles', false);
  const { sent } = logChannel(world);
  await memberEvent(world, tagged());

  await memberEvent(world, untagged());

  assert.equal(world.calls.removeRole.length, 0);
  assert.equal(world.app.guildTags.has(GUILD, 'T'), false);
  assert.equal(sent.length, 2);
  assert.deepEqual(fieldsOf(sent[1]), { Etiket: '**ABC**' });
});

test('a user update without a server is resolved by looking the member up', async () => {
  const world = await createWorld();
  world.app.settings.set(GUILD, 'guildtag.roles', ROLES);
  let lookups = 0;
  const original = world.client.rest.guilds.member;
  world.client.rest.guilds.member = async (...args) => (lookups += 1, original(...args));

  await update(world, tagged());

  assert.equal(lookups, 1);
  assert.equal(world.calls.addRole.length, 2);

  await memberEvent(world, tagged('A'), []);
  assert.equal(lookups, 1);
});

test('a member who is not in the server any more is skipped quietly', async () => {
  const world = await createWorld();
  world.app.settings.set(GUILD, 'guildtag.roles', ROLES);
  const { sent } = logChannel(world);
  await update(world, tagged('GONE'));
  assert.equal(world.calls.addRole.length, 0);
  assert.equal(sent.length, 0);
  assert.equal(world.app.guildTags.has(GUILD, 'GONE'), false);
  assert.deepEqual(warnings(world), []);
});

test('a role that cannot be given is reported and the others are still given', async () => {
  const world = await createWorld();
  world.app.settings.set(GUILD, 'guildtag.roles', ROLES);
  world.calls.roleErrors.set('700001', new Error('Missing Permissions'));
  const { sent } = logChannel(world);

  await memberEvent(world, tagged());

  assert.deepEqual(world.calls.addRole.map((call) => call[2]), ['700002']);
  assert.deepEqual(world.app.guildTags.granted(GUILD, 'T'), ['700002']);
  assert.deepEqual(fieldsOf(sent[0]), {
    Etiket: '**ABC**',
    'Verilen roller': '<@&700002>',
    'Değiştirilemeyen roller': '<@&700001>',
  });
  assert.deepEqual(warnings(world), ['[guildtag] could not give role 700001 to T in 100000000000000001: Missing Permissions']);
});

test('without the Manage Roles permission nothing is attempted and the log says why', async () => {
  const world = await createWorld();
  world.app.settings.set(GUILD, 'guildtag.roles', ROLES);
  world.client.permissionsFor = () => Permission.SendMessages;
  const { sent } = logChannel(world);

  await memberEvent(world, tagged());

  assert.equal(world.calls.addRole.length, 0);
  assert.deepEqual(fieldsOf(sent[0]), { Etiket: '**ABC**', 'Değiştirilemeyen roller': '<@&700001> <@&700002>' });
  assert.deepEqual(warnings(world), ['[guildtag] the bot lacks the Manage Roles permission in 100000000000000001, T got no roles']);
  assert.equal(world.app.guildTags.has(GUILD, 'T'), true);
});

test('roles that cannot be taken back are listed and the member is still released', async () => {
  const world = await createWorld();
  world.app.settings.set(GUILD, 'guildtag.roles', ROLES);
  const { sent } = logChannel(world);
  await memberEvent(world, tagged());
  world.calls.removeErrors.set('700002', new Error('Hierarchy'));

  await memberEvent(world, untagged());

  assert.deepEqual(world.calls.removeRole.map((call) => call[2]), ['700001']);
  assert.equal(world.app.guildTags.has(GUILD, 'T'), false);
  assert.deepEqual(fieldsOf(sent[1]), {
    Etiket: '**ABC**',
    'Geri alınan roller': '<@&700001>',
    'Değiştirilemeyen roller': '<@&700002>',
  });
  assert.ok(warnings(world).includes('[guildtag] could not take role 700002 from T in 100000000000000001: Hierarchy'));
});

test('a role that no longer exists or a member who left counts as taken back', async () => {
  const world = await createWorld();
  world.app.settings.set(GUILD, 'guildtag.roles', ROLES);
  const { sent } = logChannel(world);
  await memberEvent(world, tagged());
  world.calls.removeErrors.set('700001', apiError(404));
  world.calls.removeErrors.set('700002', apiError(404));

  await memberEvent(world, untagged());

  assert.equal(fieldsOf(sent[1])['Geri alınan roller'], '<@&700001> <@&700002>');
  assert.equal(fieldsOf(sent[1])['Değiştirilemeyen roller'], undefined);
  assert.deepEqual(warnings(world), []);
});

test('a log channel problem never stops the roles', async () => {
  const world = await createWorld();
  world.app.settings.set(GUILD, 'guildtag.roles', ROLES);
  logChannel(world, { channel: { send: async () => { throw new Error('Missing Access'); } } });

  await memberEvent(world, tagged());

  assert.equal(world.calls.addRole.length, 2);
  assert.deepEqual(warnings(world), [`[guildtag] could not post the log in channel ${LOG_CHANNEL}: Missing Access`]);
});

test('a log channel that is gone or from another server is never used', async () => {
  const gone = await createWorld();
  gone.app.settings.set(GUILD, 'guildtag.roles', ROLES);
  logChannel(gone, { fetchError: new Error('Unknown Channel') });
  await memberEvent(gone, tagged());
  assert.equal(gone.calls.addRole.length, 2);
  assert.deepEqual(warnings(gone), [`[guildtag] could not post the log in channel ${LOG_CHANNEL}: Unknown Channel`]);

  const foreign = await createWorld();
  foreign.app.settings.set(GUILD, 'guildtag.roles', ROLES);
  const { sent } = logChannel(foreign, { channel: { guildId: '999999999' } });
  await memberEvent(foreign, tagged());
  assert.equal(sent.length, 0);
  assert.ok(warnings(foreign).some((line) => line.includes('does not belong to this server')));
});

test('a cached log channel is used without asking the server', async () => {
  const world = await createWorld();
  world.app.settings.set(GUILD, 'guildtag.roles', ROLES);
  const { sent, fetches } = logChannel(world, { cached: true });
  await memberEvent(world, tagged());
  assert.equal(sent.length, 1);
  assert.deepEqual(fetches, []);
});

test('the log follows the server language', async () => {
  const world = await createWorld();
  world.app.settings.set(GUILD, 'guildtag.roles', ['700001']);
  world.app.settings.set(GUILD, 'language', 'ru');
  const { sent } = logChannel(world);

  await memberEvent(world, tagged());
  await memberEvent(world, untagged());

  assert.equal(embedOf(sent[0]).title, '🏷️ Тег сервера надет');
  assert.equal(embedOf(sent[0]).description, '<@T> теперь носит тег сервера.');
  assert.deepEqual(Object.keys(fieldsOf(sent[0])), ['Тег', 'Выданные роли']);
  assert.equal(embedOf(sent[1]).title, '🏷️ Тег сервера снят');
  assert.deepEqual(Object.keys(fieldsOf(sent[1])), ['Тег', 'Забранные роли']);
});

test('the tag text is left out when the server has none', async () => {
  const world = await createWorld();
  world.guilds[GUILD] = { id: GUILD, raw: {} };
  world.app.settings.set(GUILD, 'guildtag.roles', ['700001']);
  const { sent } = logChannel(world);
  await memberEvent(world, tagged());
  assert.deepEqual(Object.keys(fieldsOf(sent[0])), ['Verilen roller']);
});

test('the same change arriving twice at once is handled only once', async () => {
  const world = await createWorld();
  world.app.settings.set(GUILD, 'guildtag.roles', ROLES);
  const { sent } = logChannel(world);

  await Promise.all([memberEvent(world, tagged()), update(world, tagged()), memberEvent(world, tagged())]);

  assert.equal(world.calls.addRole.length, 2);
  assert.equal(sent.length, 1);
  assert.equal(world.app.guildTagQueue.size, 0);
});

test('adopting and removing in quick succession keeps the right order', async () => {
  const world = await createWorld();
  world.app.settings.set(GUILD, 'guildtag.roles', ROLES);
  const { sent } = logChannel(world);

  await Promise.all([memberEvent(world, tagged()), memberEvent(world, untagged())]);

  assert.deepEqual(sent.map((payload) => embedOf(payload).title), ['🏷️ Sunucu etiketi takıldı', '🏷️ Sunucu etiketi çıkarıldı']);
  assert.equal(world.app.guildTags.has(GUILD, 'T'), false);
  assert.equal(world.calls.removeRole.length, 2);
});

test('different members are handled independently', async () => {
  const world = await createWorld();
  world.app.settings.set(GUILD, 'guildtag.roles', ['700001']);
  await Promise.all([memberEvent(world, tagged('T')), memberEvent(world, tagged('H')), memberEvent(world, tagged('A'))]);
  assert.deepEqual(world.calls.addRole.map((call) => call[1]).sort(), ['A', 'H', 'T']);
  assert.equal(world.app.guildTags.count(GUILD), 3);
});

test('a failure while handling one event never blocks the next one', async () => {
  const world = await createWorld();
  world.app.settings.set(GUILD, 'guildtag.roles', ROLES);
  world.client.rest.guilds.member = async () => {
    throw apiError(500);
  };

  await update(world, tagged('T'));
  assert.equal(world.app.guildTags.has(GUILD, 'T'), false);
  assert.ok(warnings(world).some((line) => line.startsWith('[guildtag] adopting the tag failed for T')));

  await memberEvent(world, tagged('A'), []);
  assert.equal(world.app.guildTags.has(GUILD, 'A'), true);
});

test('the remembered members survive a restart so nothing is logged twice', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'micup-guildtag-service-'));
  const file = join(directory, 'guildtag.db');
  try {
    const first = await createWorld({ guildTagPath: file });
    first.app.settings.set(GUILD, 'guildtag.roles', ROLES);
    const firstLog = logChannel(first);
    await memberEvent(first, tagged());
    assert.equal(firstLog.sent.length, 1);
    first.app.guildTags.close();

    const second = await createWorld({ guildTagPath: file });
    second.app.settings.set(GUILD, 'guildtag.roles', ROLES);
    const secondLog = logChannel(second);
    await memberEvent(second, tagged(), ROLES);
    assert.equal(secondLog.sent.length, 0);
    assert.equal(second.calls.addRole.length, 0);

    await memberEvent(second, untagged(), ROLES);
    assert.equal(second.calls.removeRole.length, 2);
    assert.equal(secondLog.sent.length, 1);
    second.app.guildTags.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('the event file listens to member joins, member updates and user updates', async () => {
  assert.deepEqual(guildTagEvent.names, ['GUILD_MEMBER_ADD', 'GUILD_MEMBER_UPDATE', 'USER_UPDATE']);
  assert.equal(guildTagEvent.once, false);

  const world = await createWorld();
  world.app.settings.set(GUILD, 'guildtag.roles', ['700001']);
  const client = { app: world.app, ...world.client, guilds: world.client.guilds };

  await guildTagEvent.execute({ guild_id: GUILD, roles: [], user: tagged('T') }, { name: 'GUILD_MEMBER_UPDATE' }, client);
  assert.equal(world.calls.addRole.length, 1);

  await guildTagEvent.execute(untagged('T'), { name: 'USER_UPDATE' }, client);
  assert.equal(world.calls.removeRole.length, 1);
});

test('the event loader registers every name of a multi event file', async () => {
  const world = await createWorld();
  const registered = [];
  const client = {
    app: world.app,
    on: (name) => registered.push(['on', name]),
    once: (name) => registered.push(['once', name]),
  };

  await eventcore(client);

  const names = registered.map(([, name]) => name);
  for (const expected of ['GUILD_MEMBER_ADD', 'GUILD_MEMBER_UPDATE', 'USER_UPDATE', 'guildMemberAdd', 'messageCreate', 'ready']) {
    assert.ok(names.includes(expected), expected);
  }
  assert.deepEqual(registered.find(([, name]) => name === 'ready'), ['once', 'ready']);
  assert.deepEqual(registered.find(([, name]) => name === 'USER_UPDATE'), ['on', 'USER_UPDATE']);
});

async function realClient() {
  const app = createApp({ databasePath: ':memory:' });
  const warned = [];
  app.logger = { info() {}, warn: (message) => warned.push(message), error: (...args) => console.error('[test logger]', ...args) };

  const calls = { added: [], removed: [], members: [] };
  const rest = {
    guilds: {
      addMemberRole: async (...args) => calls.added.push(args),
      removeMemberRole: async (...args) => calls.removed.push(args),
      member: async (guildId, userId) => {
        calls.members.push([guildId, userId]);
        return { user: { id: userId }, roles: [] };
      },
    },
  };
  const client = new Client({ rest, token: 'id.secret', registerCommands: false });
  Object.defineProperty(client, 'user', { value: { id: BOT } });
  Object.defineProperty(client, 'guilds', { value: { get: (id) => (id === GUILD ? { id, raw: { guild_tag: 'ABC' } } : undefined) } });
  client.app = app;
  client.on('error', (error) => console.error('[client error]', error));
  await eventcore(client);
  return { app, client, calls, warned };
}

async function dispatch(client, name, data) {
  await client.handleDispatch({ name, data, sequence: 1, shardId: 0 });
  for (let index = 0; index < 8; index += 1) await new Promise((resolve) => setImmediate(resolve));
}

test('a real client follows the tag through member updates', async () => {
  const { app, client, calls } = await realClient();
  app.settings.set(GUILD, 'guildtag.roles', ROLES);

  await dispatch(client, 'GUILD_MEMBER_UPDATE', { guild_id: GUILD, roles: [], user: { id: '31337', username: 'n', tag_guild_id: GUILD } });
  assert.deepEqual(calls.added, ROLES.map((roleId) => [GUILD, '31337', roleId, { reason: 'Guild tag' }]));
  assert.equal(calls.members.length, 0);

  await dispatch(client, 'GUILD_MEMBER_UPDATE', { guild_id: GUILD, roles: ROLES, user: { id: '31337', username: 'n', tag_guild_id: null } });
  assert.deepEqual(calls.removed.map((call) => call[2]), ROLES);
});

test('a real client follows the tag through user updates and member joins', async () => {
  const { app, client, calls } = await realClient();
  app.settings.set(GUILD, 'guildtag.roles', ['700001']);

  await dispatch(client, 'USER_UPDATE', { id: '41', username: 'u', tag_guild_id: GUILD });
  assert.deepEqual(calls.members, [[GUILD, '41']]);
  assert.deepEqual(calls.added, [[GUILD, '41', '700001', { reason: 'Guild tag' }]]);

  await dispatch(client, 'USER_UPDATE', { id: '41', username: 'u', tag_guild_id: null });
  assert.deepEqual(calls.removed.map((call) => call[1]), ['41']);

  await dispatch(client, 'GUILD_MEMBER_ADD', { guild_id: GUILD, roles: [], joined_at: '2026-11-23T12:00:00.000Z', user: { id: '42', username: 'joiner', tag_guild_id: GUILD } });
  assert.deepEqual(calls.added.at(-1), [GUILD, '42', '700001', { reason: 'Guild tag' }]);
  assert.equal(app.guildTags.has(GUILD, '42'), true);
});

test('a real client ignores updates that do not carry the tag field and bots', async () => {
  const { app, client, calls } = await realClient();
  app.settings.set(GUILD, 'guildtag.roles', ['700001']);

  await dispatch(client, 'USER_UPDATE', { id: '51', username: 'renamed' });
  await dispatch(client, 'GUILD_MEMBER_UPDATE', { guild_id: GUILD, roles: [], user: { id: '52', username: 'robot', bot: true, tag_guild_id: GUILD } });

  assert.equal(calls.added.length, 0);
  assert.equal(calls.removed.length, 0);
});

test('a real client keeps giving auto roles and tag roles side by side', async () => {
  const { app, client, calls } = await realClient();
  app.settings.set(GUILD, 'autorole.roles', ['800001']);
  app.settings.set(GUILD, 'guildtag.roles', ['700001']);

  await dispatch(client, 'GUILD_MEMBER_ADD', { guild_id: GUILD, roles: [], joined_at: '2026-11-23T12:00:00.000Z', user: { id: '61', username: 'both', tag_guild_id: GUILD } });

  assert.deepEqual(calls.added.map((call) => call[2]).sort(), ['700001', '800001']);
});

test('a real client reports a refused role without breaking anything', async () => {
  const { app, client, calls, warned } = await realClient();
  app.settings.set(GUILD, 'guildtag.roles', ['700001', '700002']);
  client.rest.guilds.addMemberRole = async (guildId, userId, roleId) => {
    if (roleId === '700001') throw new MicupAPIError(new Response(null, { status: 403 }), { message: 'Missing Permissions' });
    calls.added.push([guildId, userId, roleId]);
  };

  await dispatch(client, 'GUILD_MEMBER_UPDATE', { guild_id: GUILD, roles: [], user: { id: '71', username: 'n', tag_guild_id: GUILD } });

  assert.deepEqual(calls.added.map((call) => call[2]), ['700002']);
  assert.deepEqual(warned, ['[guildtag] could not give role 700001 to 71 in 100000000000000001: Missing Permissions']);
});
