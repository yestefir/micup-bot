import test from 'node:test';
import assert from 'node:assert/strict';
import { Settings, SettingError } from '../src/core/settings/settings.js';

function create() {
  const settings = new Settings(':memory:');
  settings.define('prefix', { type: 'string', default: '!', minLength: 1, maxLength: 5 });
  settings.define('limit', { type: 'integer', default: 10, min: 1, max: 50 });
  settings.define('enabled', { type: 'boolean', default: true });
  settings.define('mode', { type: 'string', default: 'a', choices: ['a', 'b'] });
  return settings;
}

test('returns defaults until a value is set', () => {
  const settings = create();
  assert.equal(settings.get('g1', 'prefix'), '!');
  assert.equal(settings.isSet('g1', 'prefix'), false);
});

test('scopes are isolated', () => {
  const settings = create();
  settings.set('g1', 'prefix', '?');
  assert.equal(settings.get('g1', 'prefix'), '?');
  assert.equal(settings.get('g2', 'prefix'), '!');
});

test('coerces strings to typed values', () => {
  const settings = create();
  assert.equal(settings.set('g', 'limit', '25'), 25);
  assert.equal(settings.set('g', 'enabled', 'off'), false);
  assert.equal(settings.set('g', 'mode', 'B'), 'b');
});

test('rejects invalid values with a code', () => {
  const settings = create();
  const code = (action) => {
    try {
      action();
    } catch (error) {
      assert.ok(error instanceof SettingError);
      return error.code;
    }
    return null;
  };
  assert.equal(code(() => settings.set('g', 'limit', 'abc')), 'invalidInteger');
  assert.equal(code(() => settings.set('g', 'limit', '99')), 'tooLarge');
  assert.equal(code(() => settings.set('g', 'limit', '0')), 'tooSmall');
  assert.equal(code(() => settings.set('g', 'prefix', 'toolong')), 'tooLong');
  assert.equal(code(() => settings.set('g', 'enabled', 'maybe')), 'invalidBoolean');
  assert.equal(code(() => settings.set('g', 'mode', 'z')), 'invalidChoice');
});

test('reset restores the default and emits change', () => {
  const settings = create();
  const events = [];
  settings.on('change', (event) => events.push(event));
  settings.set('g', 'limit', 20);
  assert.equal(settings.reset('g', 'limit'), true);
  assert.equal(settings.get('g', 'limit'), 10);
  assert.equal(settings.reset('g', 'limit'), false);
  assert.deepEqual(events.map((event) => [event.key, event.value, event.previous]), [
    ['limit', 20, 10],
    ['limit', 10, 20],
  ]);
});

test('unknown keys throw and duplicate definitions throw', () => {
  const settings = create();
  assert.throws(() => settings.get('g', 'missing'));
  assert.throws(() => settings.define('prefix', { type: 'string', default: '!' }));
});

test('values persist across instances', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const directory = mkdtempSync(join(tmpdir(), 'micup-settings-'));
  const file = join(directory, 'settings.db');
  try {
    const first = new Settings(file);
    first.define('limit', { type: 'integer', default: 10 });
    first.set('g', 'limit', 42);
    first.close();
    const second = new Settings(file);
    second.define('limit', { type: 'integer', default: 10 });
    assert.equal(second.get('g', 'limit'), 42);
    second.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('role and channel settings accept ids and their own mentions and default to not set', () => {
  const settings = new Settings(':memory:');
  settings.define('mod.role', { type: 'role', default: null });
  settings.define('log.channel', { type: 'channel', default: null });

  assert.equal(settings.get('g', 'mod.role'), null);
  assert.equal(settings.get('g', 'log.channel'), null);
  assert.equal(settings.isSet('g', 'mod.role'), false);

  assert.equal(settings.set('g', 'mod.role', '123456'), '123456');
  assert.equal(settings.set('g', 'mod.role', '<@&654321>'), '654321');
  assert.equal(settings.set('g', 'mod.role', '  777777  '), '777777');
  assert.equal(settings.set('g', 'log.channel', '<#987654>'), '987654');
  assert.equal(settings.set('g', 'log.channel', '555555'), '555555');
});

test('role and channel settings reject anything that is not their own id or mention', () => {
  const settings = new Settings(':memory:');
  settings.define('mod.role', { type: 'role', default: null });
  settings.define('log.channel', { type: 'channel', default: null });
  const code = (key, value) => {
    try {
      settings.set('g', key, value);
    } catch (error) {
      return error.code;
    }
    return null;
  };

  for (const bad of ['', 'abc', '12', '<@123456>', '<#123456>', '<@&abc>', '123 456']) {
    assert.equal(code('mod.role', bad), 'invalidId', `role ${JSON.stringify(bad)}`);
  }
  for (const bad of ['', 'abc', '12', '<@123456>', '<@&123456>', '<#abc>']) {
    assert.equal(code('log.channel', bad), 'invalidId', `channel ${JSON.stringify(bad)}`);
  }
});

test('role and channel values persist, reset to not set and appear in the entries', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const directory = mkdtempSync(join(tmpdir(), 'micup-types-'));
  const file = join(directory, 'settings.db');
  try {
    const first = new Settings(file);
    first.define('mod.role', { type: 'role', default: null });
    first.set('g', 'mod.role', '424242');
    first.close();

    const second = new Settings(file);
    second.define('mod.role', { type: 'role', default: null });
    assert.equal(second.get('g', 'mod.role'), '424242');
    assert.deepEqual(second.entries('g').map((entry) => [entry.key, entry.value, entry.isDefault]), [['mod.role', '424242', false]]);
    assert.equal(second.reset('g', 'mod.role'), true);
    assert.equal(second.get('g', 'mod.role'), null);
    assert.deepEqual(second.entries('g').map((entry) => [entry.value, entry.isDefault]), [[null, true]]);
    second.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('only role and channel settings may default to not set', () => {
  const settings = new Settings(':memory:');
  for (const type of ['string', 'integer', 'boolean']) {
    assert.throws(() => settings.define(`x.${type}`, { type, default: null }), /cannot default to null/);
  }
  assert.throws(() => settings.define('x.unknown', { type: 'color', default: 'red' }), /Unknown setting type/);
  assert.ok(settings.define('ok.role', { type: 'role', default: null }));
  assert.ok(settings.define('ok.channel', { type: 'channel', default: '123456' }));
  assert.equal(settings.get('g', 'ok.channel'), '123456');
});

test('role and channel changes emit change events with the previous value', () => {
  const settings = new Settings(':memory:');
  settings.define('mod.role', { type: 'role', default: null });
  const events = [];
  settings.on('change', (event) => events.push([event.key, event.value, event.previous]));

  settings.set('g', 'mod.role', '111111');
  settings.set('g', 'mod.role', '222222');
  settings.reset('g', 'mod.role');

  assert.deepEqual(events, [
    ['mod.role', '111111', null],
    ['mod.role', '222222', '111111'],
    ['mod.role', null, '222222'],
  ]);
});

test('settings have a category that defaults to general and cannot be empty', () => {
  const settings = new Settings(':memory:');
  assert.equal(settings.define('a', { type: 'string', default: 'x' }).category, 'general');
  assert.equal(settings.define('b', { type: 'string', default: 'x', category: 'levels' }).category, 'levels');
  assert.deepEqual(settings.definitions.map((definition) => [definition.key, definition.category]), [['a', 'general'], ['b', 'levels']]);
  assert.throws(() => settings.define('c', { type: 'string', default: 'x', category: '' }), /needs a category/);
  assert.throws(() => settings.define('d', { type: 'string', default: 'x', category: 7 }), /needs a category/);
});

test('every built in setting declares a category', async () => {
  const { createApp } = await import('../src/app.js');
  const app = createApp({ databasePath: ':memory:' });
  const categories = Object.fromEntries(app.settings.definitions.map((definition) => [definition.key, definition.category]));
  assert.deepEqual(categories, {
    prefix: 'general',
    language: 'general',
    'levels.enabled': 'levels',
    'levels.xpMin': 'levels',
    'levels.xpMax': 'levels',
    'levels.cooldownSeconds': 'levels',
    'levels.announce': 'levels',
    'levels.channel': 'levels',
    'mute.sessionSeconds': 'moderation',
    'purge.maxAmount': 'moderation',
    'moderation.logChannel': 'moderation',
    'welcome.channel': 'welcome',
    'welcome.message': 'welcome',
    'ban.sessionSeconds': 'moderation',
    'autorole.roles': 'autorole',
    'guildtag.roles': 'guildtag',
    'guildtag.removeRoles': 'guildtag',
    'guildtag.logChannel': 'guildtag',
  });
  for (const category of new Set(Object.values(categories))) {
    for (const code of app.i18n.codes) {
      assert.notEqual(app.i18n.t(code, `settings.categories.${category}`), `settings.categories.${category}`, `${code}: ${category}`);
    }
  }
});

test('every built in setting has a description in every language', async () => {
  const { createApp } = await import('../src/app.js');
  const app = createApp({ databasePath: ':memory:' });
  for (const definition of app.settings.definitions) {
    for (const code of app.i18n.codes) {
      const key = `settings.items.${definition.key}`;
      assert.notEqual(app.i18n.t(code, key), key, `${code}: ${definition.key}`);
    }
  }
});
