import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SettingError, Settings } from '../src/core/settings/settings.js';

function create(options = {}) {
  const settings = new Settings(':memory:');
  settings.define('auto.roles', { type: 'roles', default: [], ...options });
  return settings;
}

const codeOf = (action) => {
  try {
    action();
  } catch (error) {
    assert.ok(error instanceof SettingError);
    return [error.code, error.params];
  }
  return null;
};

test('a role list setting is empty by default and unset until changed', () => {
  const settings = create();
  assert.deepEqual(settings.get('g', 'auto.roles'), []);
  assert.equal(settings.isSet('g', 'auto.roles'), false);
});

test('a role list accepts arrays of ids and arrays of role mentions', () => {
  const settings = create();
  assert.deepEqual(settings.set('g', 'auto.roles', ['111111', '222222']), ['111111', '222222']);
  assert.deepEqual(settings.set('g', 'auto.roles', ['<@&333333>', '444444']), ['333333', '444444']);
  assert.deepEqual(settings.get('g', 'auto.roles'), ['333333', '444444']);
  assert.equal(settings.isSet('g', 'auto.roles'), true);
});

test('a role list accepts text with commas, spaces and mentions', () => {
  const settings = create();
  assert.deepEqual(settings.set('g', 'auto.roles', '111111, 222222  <@&333333>'), ['111111', '222222', '333333']);
  assert.deepEqual(settings.set('g', 'auto.roles', '555555'), ['555555']);
  assert.deepEqual(settings.set('g', 'auto.roles', '\n 666666 \n 777777 '), ['666666', '777777']);
});

test('a role list drops duplicates and keeps the order of first appearance', () => {
  const settings = create();
  assert.deepEqual(settings.set('g', 'auto.roles', ['333333', '111111', '333333', '<@&111111>', '222222']), ['333333', '111111', '222222']);
});

test('a role list rejects anything that is not a role id or a role mention', () => {
  const settings = create();
  for (const bad of [['abc'], ['12'], ['111111', 'nope'], ['<#123456>'], ['<@123456>'], 'abc', '111111 xx']) {
    assert.deepEqual(codeOf(() => settings.set('g', 'auto.roles', bad))?.[0], 'invalidId', JSON.stringify(bad));
  }
  assert.deepEqual(settings.get('g', 'auto.roles'), []);
});

test('a role list is limited to 25 items by default and to maxItems when given', () => {
  const settings = create();
  const ids = (count) => Array.from({ length: count }, (_, index) => String(100000 + index));
  assert.equal(settings.set('g', 'auto.roles', ids(25)).length, 25);
  assert.deepEqual(codeOf(() => settings.set('g', 'auto.roles', ids(26))), ['tooMany', { max: 25 }]);

  const small = create({ maxItems: 3 });
  assert.equal(small.set('g', 'auto.roles', ids(3)).length, 3);
  assert.deepEqual(codeOf(() => small.set('g', 'auto.roles', ids(4))), ['tooMany', { max: 3 }]);
  assert.equal(small.set('g', 'auto.roles', ['100000', '100000', '100000', '100001']).length, 2);
});

test('a rejected change leaves the stored list untouched', () => {
  const settings = create({ maxItems: 2 });
  settings.set('g', 'auto.roles', ['111111']);
  assert.ok(codeOf(() => settings.set('g', 'auto.roles', ['111111', '222222', '333333'])));
  assert.deepEqual(settings.get('g', 'auto.roles'), ['111111']);
});

test('changing a returned list never changes the stored setting', () => {
  const settings = create();
  const returned = settings.set('g', 'auto.roles', ['111111']);
  returned.push('999999');
  const read = settings.get('g', 'auto.roles');
  read.push('888888');
  assert.deepEqual(settings.get('g', 'auto.roles'), ['111111']);

  const fromDefault = settings.get('other', 'auto.roles');
  fromDefault.push('777777');
  assert.deepEqual(settings.get('other', 'auto.roles'), []);
});

test('lists are stored per scope', () => {
  const settings = create();
  settings.set('one', 'auto.roles', ['111111']);
  settings.set('two', 'auto.roles', ['222222', '333333']);
  assert.deepEqual(settings.get('one', 'auto.roles'), ['111111']);
  assert.deepEqual(settings.get('two', 'auto.roles'), ['222222', '333333']);
  assert.deepEqual(settings.get('three', 'auto.roles'), []);
});

test('reset empties the list and entries describe it', () => {
  const settings = create();
  settings.set('g', 'auto.roles', ['111111']);
  assert.deepEqual(settings.entries('g').map((entry) => [entry.key, entry.value, entry.isDefault]), [['auto.roles', ['111111'], false]]);

  assert.equal(settings.reset('g', 'auto.roles'), true);
  assert.deepEqual(settings.get('g', 'auto.roles'), []);
  assert.deepEqual(settings.entries('g').map((entry) => [entry.value, entry.isDefault]), [[[], true]]);
  assert.equal(settings.reset('g', 'auto.roles'), false);
});

test('change events carry copies of the new and the previous list', () => {
  const settings = create();
  const events = [];
  settings.on('change', (event) => events.push(event));

  settings.set('g', 'auto.roles', ['111111']);
  settings.set('g', 'auto.roles', ['111111', '222222']);
  settings.reset('g', 'auto.roles');

  assert.deepEqual(events.map((event) => [event.value, event.previous]), [
    [['111111'], []],
    [['111111', '222222'], ['111111']],
    [[], ['111111', '222222']],
  ]);
  events[0].value.push('mutated');
  assert.deepEqual(settings.get('g', 'auto.roles'), []);
});

test('a role list survives a restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'micup-roles-'));
  const file = join(directory, 'settings.db');
  try {
    const first = new Settings(file);
    first.define('auto.roles', { type: 'roles', default: [] });
    first.set('g', 'auto.roles', ['111111', '222222']);
    first.close();

    const second = new Settings(file);
    second.define('auto.roles', { type: 'roles', default: [] });
    assert.deepEqual(second.get('g', 'auto.roles'), ['111111', '222222']);
    second.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a role list setting needs a list as its default', () => {
  const settings = new Settings(':memory:');
  assert.throws(() => settings.define('x.null', { type: 'roles', default: null }), /needs a list|cannot default to null/);
  assert.throws(() => settings.define('x.text', { type: 'roles', default: '111111' }), /needs a list/);
  assert.throws(() => settings.define('x.bad', { type: 'roles', default: ['nope'] }), (error) => error.code === 'invalidId');
  assert.deepEqual(settings.define('x.ok', { type: 'roles', default: ['<@&123456>'] }).default, ['123456']);
});

test('the built in auto role setting is an empty list of at most ten roles', async () => {
  const { createApp } = await import('../src/app.js');
  const app = createApp({ databasePath: ':memory:' });
  const definition = app.settings.definition('autorole.roles');
  assert.deepEqual(
    { type: definition.type, category: definition.category, default: definition.default, maxItems: definition.maxItems, editable: definition.editable },
    { type: 'roles', category: 'autorole', default: [], maxItems: 10, editable: true },
  );
});
