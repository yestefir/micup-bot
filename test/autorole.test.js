import test from 'node:test';
import assert from 'node:assert/strict';
import { Client, MicupAPIError, Permission } from 'micup.ts/easy';
import { createApp } from '../src/app.js';
import { eventcore } from '../src/core/event/eventcore.js';
import autoroleEvent from '../src/events/autorole.js';
import { giveAutoRoles } from '../src/utils/autorole/service.js';
import { BOT, GUILD, apiError, createWorld } from './support/fakes.js';

const ROLES = ['700001', '700002', '700003'];

function joiner(overrides = {}) {
  const calls = [];
  const roles = overrides.roles ?? [];
  const member = {
    id: 'N',
    guildId: GUILD,
    bot: false,
    roles,
    hasRole: (id) => roles.includes(id),
    addRole: async (roleId, options) => {
      calls.push([roleId, options]);
      if (overrides.fail?.has(roleId)) throw overrides.fail.get(roleId);
    },
    ...overrides.member,
  };
  return { member, calls };
}

const run = (world, member) => giveAutoRoles({ app: world.app, client: world.client, member });
const warnings = (world) => world.logs.filter((line) => line.startsWith('[autorole]'));

test('a new member gets every configured role with an audit reason', async () => {
  const world = await createWorld();
  world.app.settings.set(GUILD, 'autorole.roles', ROLES);
  const { member, calls } = joiner();

  const outcome = await run(world, member);

  assert.deepEqual(calls.map(([roleId]) => roleId), ROLES);
  assert.ok(calls.every(([, options]) => options.reason === 'Auto role'));
  assert.deepEqual(outcome, { given: ROLES, failed: [], skipped: [] });
  assert.deepEqual(warnings(world), []);
});

test('nothing happens while no roles are configured', async () => {
  const world = await createWorld();
  const { member, calls } = joiner();
  const outcome = await run(world, member);
  assert.equal(calls.length, 0);
  assert.deepEqual(outcome, { given: [], failed: [], skipped: [] });
});

test('bot accounts never get auto roles', async () => {
  const world = await createWorld();
  world.app.settings.set(GUILD, 'autorole.roles', ROLES);
  const { member, calls } = joiner({ member: { bot: true } });
  await run(world, member);
  assert.equal(calls.length, 0);
});

test('roles the member already has are skipped', async () => {
  const world = await createWorld();
  world.app.settings.set(GUILD, 'autorole.roles', ROLES);
  const { member, calls } = joiner({ roles: ['700002'] });

  const outcome = await run(world, member);

  assert.deepEqual(calls.map(([roleId]) => roleId), ['700001', '700003']);
  assert.deepEqual(outcome.skipped, ['700002']);
  assert.deepEqual(outcome.given, ['700001', '700003']);
});

test('a member who already has all the roles costs no permission lookup and no requests', async () => {
  const world = await createWorld();
  world.app.settings.set(GUILD, 'autorole.roles', ROLES);
  world.client.permissionsFor = () => {
    throw new Error('must not be called');
  };
  const { member, calls } = joiner({ roles: ROLES });
  const outcome = await run(world, member);
  assert.equal(calls.length, 0);
  assert.deepEqual(outcome.skipped, ROLES);
});

test('each server uses its own roles', async () => {
  const world = await createWorld();
  world.app.settings.set('other-server', 'autorole.roles', ['800001']);
  world.app.settings.set(GUILD, 'autorole.roles', ['700001']);

  const here = joiner();
  await run(world, here.member);
  const there = joiner({ member: { guildId: 'other-server' } });
  await run(world, there.member);
  const nowhere = joiner({ member: { guildId: 'third-server' } });
  await run(world, nowhere.member);

  assert.deepEqual(here.calls.map(([roleId]) => roleId), ['700001']);
  assert.deepEqual(there.calls.map(([roleId]) => roleId), ['800001']);
  assert.equal(nowhere.calls.length, 0);
});

test('one role that cannot be given does not stop the others', async () => {
  const world = await createWorld();
  world.app.settings.set(GUILD, 'autorole.roles', ROLES);
  const { member, calls } = joiner({ fail: new Map([['700002', new Error('Missing Permissions')]]) });

  const outcome = await run(world, member);

  assert.equal(calls.length, 3);
  assert.deepEqual(outcome, { given: ['700001', '700003'], failed: ['700002'], skipped: [] });
  assert.deepEqual(warnings(world), ['[autorole] could not give role 700002 to N in 100000000000000001: Missing Permissions']);
});

test('every failure is reported on its own and never thrown', async () => {
  const world = await createWorld();
  world.app.settings.set(GUILD, 'autorole.roles', ROLES);
  const failures = new Map(ROLES.map((roleId) => [roleId, apiError(403)]));
  const { member } = joiner({ fail: failures });

  const outcome = await run(world, member);

  assert.deepEqual(outcome.failed, ROLES);
  assert.equal(warnings(world).length, 3);
  assert.ok(warnings(world).every((line) => line.includes('failed')));
});

test('without the Manage Roles permission nothing is attempted and the problem is logged once', async () => {
  const world = await createWorld();
  world.app.settings.set(GUILD, 'autorole.roles', ROLES);
  world.client.permissionsFor = () => Permission.SendMessages;
  const { member, calls } = joiner();

  const outcome = await run(world, member);

  assert.equal(calls.length, 0);
  assert.deepEqual(outcome.failed, ROLES);
  assert.deepEqual(warnings(world), ['[autorole] the bot lacks the Manage Roles permission in 100000000000000001, N got no roles']);
});

test('when the permissions are not known the roles are still attempted', async () => {
  const world = await createWorld();
  world.app.settings.set(GUILD, 'autorole.roles', ['700001']);
  world.client.permissionsFor = () => undefined;
  const { member, calls } = joiner();
  await run(world, member);
  assert.equal(calls.length, 1);
});

test('the Manage Roles permission alone is enough and the check uses the bot itself', async () => {
  const world = await createWorld();
  world.app.settings.set(GUILD, 'autorole.roles', ['700001']);
  const asked = [];
  world.client.permissionsFor = (guildId, userId) => {
    asked.push([guildId, userId]);
    return Permission.ManageRoles;
  };
  const { member, calls } = joiner();
  await run(world, member);
  assert.equal(calls.length, 1);
  assert.deepEqual(asked, [[GUILD, BOT]]);
});

test('changes made in the settings apply to the very next member', async () => {
  const world = await createWorld();
  const first = joiner();
  await run(world, first.member);
  assert.equal(first.calls.length, 0);

  world.app.settings.set(GUILD, 'autorole.roles', ['700001', '700002']);
  const second = joiner();
  await run(world, second.member);
  assert.equal(second.calls.length, 2);

  world.app.settings.set(GUILD, 'autorole.roles', ['700003']);
  const third = joiner();
  await run(world, third.member);
  assert.deepEqual(third.calls.map(([roleId]) => roleId), ['700003']);

  world.app.settings.reset(GUILD, 'autorole.roles');
  const fourth = joiner();
  await run(world, fourth.member);
  assert.equal(fourth.calls.length, 0);
});

test('up to ten roles are all given', async () => {
  const world = await createWorld();
  const ids = Array.from({ length: 10 }, (_, index) => String(710000 + index));
  world.app.settings.set(GUILD, 'autorole.roles', ids);
  const { member, calls } = joiner();
  const outcome = await run(world, member);
  assert.equal(calls.length, 10);
  assert.deepEqual(outcome.given, ids);
});

test('the event is registered for member joins and uses the client app', async () => {
  const world = await createWorld();
  world.app.settings.set(GUILD, 'autorole.roles', ['700001']);
  const { member, calls } = joiner();

  assert.equal(autoroleEvent.name, 'guildMemberAdd');
  assert.equal(autoroleEvent.once, false);
  await autoroleEvent.execute(member, { app: world.app, user: world.client.user, permissionsFor: world.client.permissionsFor });

  assert.deepEqual(calls.map(([roleId]) => roleId), ['700001']);
});

async function realClient() {
  const app = createApp({ databasePath: ':memory:' });
  const warnings = [];
  app.logger = { info() {}, warn: (message) => warnings.push(message), error: (...args) => console.error('[test logger]', ...args) };

  const added = [];
  const rest = {
    guilds: {
      addMemberRole: async (guildId, userId, roleId, options) => {
        added.push([guildId, userId, roleId, options]);
        if (rest.refuse?.has(roleId)) throw rest.refuse.get(roleId);
      },
    },
  };
  const client = new Client({ rest, token: 'id.secret', registerCommands: false });
  Object.defineProperty(client, 'user', { value: { id: BOT } });
  client.app = app;
  client.on('error', (error) => console.error('[client error]', error));
  await eventcore(client);
  return { app, client, added, warnings, rest };
}

const memberPayload = (overrides = {}) => ({
  guild_id: GUILD,
  user: { id: '31337', username: 'newcomer' },
  roles: [],
  joined_at: '2026-11-23T12:00:00.000Z',
  ...overrides,
});

async function join(client, data) {
  await client.handleDispatch({ name: 'GUILD_MEMBER_ADD', data, sequence: 1, shardId: 0 });
  for (let index = 0; index < 6; index += 1) await new Promise((resolve) => setImmediate(resolve));
}

test('a real client gives the roles when the gateway reports a new member', async () => {
  const { app, client, added } = await realClient();
  app.settings.set(GUILD, 'autorole.roles', ['700001', '700002']);

  await join(client, memberPayload());

  assert.deepEqual(added, [
    [GUILD, '31337', '700001', { reason: 'Auto role' }],
    [GUILD, '31337', '700002', { reason: 'Auto role' }],
  ]);
});

test('a real client skips bots, roles already held and servers without settings', async () => {
  const { app, client, added } = await realClient();
  app.settings.set(GUILD, 'autorole.roles', ['700001', '700002']);

  await join(client, memberPayload({ user: { id: '5', username: 'helper', bot: true } }));
  assert.equal(added.length, 0);

  await join(client, memberPayload({ roles: ['700001'] }));
  assert.deepEqual(added.map((call) => call[2]), ['700002']);

  await join(client, memberPayload({ guild_id: '999000999' }));
  assert.equal(added.length, 1);
});

test('a real client logs a role the bot is not allowed to give and still gives the rest', async () => {
  const { app, client, added, warnings, rest } = await realClient();
  app.settings.set(GUILD, 'autorole.roles', ['700001', '700002']);
  rest.refuse = new Map([['700001', new MicupAPIError(new Response(null, { status: 403 }), { message: 'Missing Permissions' })]]);

  await join(client, memberPayload());

  assert.equal(added.length, 2);
  assert.deepEqual(warnings, ['[autorole] could not give role 700001 to 31337 in 100000000000000001: Missing Permissions']);
});

test('a real client does nothing for members of servers without an auto role', async () => {
  const { client, added } = await realClient();
  await join(client, memberPayload());
  assert.equal(added.length, 0);
});

test('a failing role request never breaks the event for the next member', async () => {
  const { app, client, added, rest } = await realClient();
  app.settings.set(GUILD, 'autorole.roles', ['700001']);
  rest.refuse = new Map([['700001', apiError(404)]]);
  await join(client, memberPayload());
  rest.refuse = null;
  await join(client, memberPayload({ user: { id: '42', username: 'second' } }));
  assert.equal(added.length, 2);
  assert.equal(added.at(-1)[1], '42');
});
