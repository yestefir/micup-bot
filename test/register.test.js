import test from 'node:test';
import assert from 'node:assert/strict';
import { apiError, createWorld, formError } from './support/fakes.js';

test('registration prunes commands the bot no longer defines', async () => {
  const world = await createWorld({ guildId: undefined });
  await world.interactions.register();
  assert.deepEqual(world.calls.register, [{ guildId: undefined, prune: true }]);
});

test('registration is scoped to the configured guild', async () => {
  const world = await createWorld({ guildId: '555' });
  await world.interactions.register();
  assert.deepEqual(world.calls.register, [{ guildId: '555', prune: true }]);
});

test('the log lists created, updated and deleted commands', async () => {
  const world = await createWorld({ guildId: '555' });
  world.calls.registerResult = {
    created: ['mute'],
    updated: ['purge', 'ban'],
    unchanged: ['settings'],
    deleted: ['eski-komut'],
  };
  const result = await world.interactions.register();
  assert.deepEqual(result.deleted, ['eski-komut']);
  assert.equal(
    world.logs.at(-1),
    '[slash] guild 555 | created: mute | updated: purge, ban | deleted: eski-komut | unchanged: 1',
  );
});

test('the log marks empty groups and the global scope', async () => {
  const world = await createWorld({ guildId: undefined });
  world.calls.registerResult = { created: [], updated: [], unchanged: ['purge', 'ban'], deleted: [] };
  await world.interactions.register();
  assert.equal(world.logs.at(-1), '[slash] global | created: - | updated: - | deleted: - | unchanged: 2');
});

const ALL_NAMES = ['ban', 'leaderboard', 'mute', 'ping', 'purge', 'rank', 'settings'];
const serverNames = (world) => [...world.server.values()].map((command) => command.name).sort();
const hasLocales = (command) => JSON.stringify(command).includes('_localizations');

async function rejectedWorld(overrides = {}) {
  const world = await createWorld({ expectErrors: true, ...overrides });
  world.calls.registerError = formError();
  return world;
}

test('the fast path never touches commands one by one', async () => {
  const world = await createWorld();
  await world.interactions.register();
  assert.equal(world.calls.writes.length, 0);
});

test('a rejected locale is dropped per command and the rest is kept', async () => {
  const world = await rejectedWorld({ guildId: '555' });
  world.calls.rules.rejectLocales.add('tr');
  world.server.set('old', { id: 'old', name: 'sil', type: 1 });

  const summary = await world.interactions.register();

  assert.deepEqual(serverNames(world), ALL_NAMES);
  assert.deepEqual(summary.deleted, ['sil']);
  assert.deepEqual(summary.failed, []);
  assert.deepEqual(Object.keys(summary.partial).sort(), ALL_NAMES);
  for (const name of ALL_NAMES) assert.deepEqual(summary.partial[name], ['tr'], name);

  const ban = [...world.server.values()].find((command) => command.name === 'ban');
  assert.deepEqual(Object.keys(ban.name_localizations).sort(), ['de', 'es-ES', 'fr', 'ru']);
  assert.equal(ban.options[0].name_localizations.de, 'benutzer');

  assert.match(world.logs.find((line) => line.includes('bulk registration rejected')), /root: INVALID_FORMAT/);
  assert.match(world.logs.at(-1), /^\[slash\] guild 555 \| one by one \| registered: .*ban.* \| partial: ban \(without tr\)/);
  assert.match(world.logs.at(-1), /deleted: sil$/);
});

test('when every locale is rejected the commands still register without localizations', async () => {
  const world = await rejectedWorld();
  for (const locale of ['de', 'es-ES', 'fr', 'ru', 'tr']) world.calls.rules.rejectLocales.add(locale);

  const summary = await world.interactions.register();

  assert.deepEqual(serverNames(world), ALL_NAMES);
  assert.deepEqual(summary.failed, []);
  assert.ok([...world.server.values()].every((command) => !hasLocales(command)));
  assert.deepEqual(summary.partial.purge.sort(), ['de', 'es-ES', 'fr', 'ru', 'tr']);
});

test('one broken command does not stop the others', async () => {
  const world = await rejectedWorld();
  world.calls.rules.rejectNames.add('ban');

  const summary = await world.interactions.register();

  assert.deepEqual(summary.failed, ['ban']);
  assert.deepEqual(serverNames(world), ['leaderboard', 'mute', 'ping', 'purge', 'rank', 'settings']);
  assert.ok(world.errors.some((line) => line.includes('"ban" is rejected even without localizations (root: INVALID_FORMAT)')));
  assert.match(world.logs.at(-1), /failed: ban/);
});

test('existing commands are edited in place, not duplicated', async () => {
  const world = await rejectedWorld();
  world.server.set('keep', { id: 'keep', name: 'mute', type: 1 });

  await world.interactions.register();

  assert.equal(serverNames(world).filter((name) => name === 'mute').length, 1);
  assert.ok(world.calls.writes.some(([kind]) => kind === 'edit'));
  assert.equal(world.server.get('keep').options[0].name, 'user');
});

test('errors that are not form errors are not swallowed', async () => {
  const world = await createWorld();
  world.calls.registerError = apiError(500);
  await assert.rejects(() => world.interactions.register(), (error) => error.status === 500);
  assert.equal(world.calls.writes.length, 0);

  const second = await rejectedWorld();
  second.calls.rules.failCreate = apiError(500);
  await assert.rejects(() => second.interactions.register(), (error) => error.status === 500);
});

test('an unknown command interaction is logged and answered instead of lost', async () => {
  const world = await createWorld();
  const replies = [];
  const interaction = {
    isCommand: () => true,
    commandName: 'sil',
    guildId: '555',
    channelId: '200',
    locale: 'tr',
    deferred: false,
    replied: false,
    async reply(payload) {
      replies.push(payload);
    },
  };

  world.client.emit('interactionCreate', interaction);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(replies[0].ephemeral, true);
  assert.equal(replies[0].embeds[0].description, 'Bu komut güncel değil veya tanınmıyor. Biraz sonra tekrar dene.');
  assert.match(world.logs.at(-1), /no handler for "sil", known commands: .*purge/);
});

test('known commands and non command interactions are left alone', async () => {
  const world = await createWorld();
  const replies = [];
  const base = { guildId: '555', channelId: '200', deferred: false, replied: false, reply: async (p) => replies.push(p) };

  world.client.emit('interactionCreate', { ...base, isCommand: () => true, commandName: 'purge' });
  world.client.emit('interactionCreate', { ...base, isCommand: () => false, customId: 'x' });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(replies.length, 0);
});
