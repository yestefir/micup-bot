import test from 'node:test';
import assert from 'node:assert/strict';
import { createContext } from '../src/core/interaction/src/context.js';
import { buildView, controlFor, groupByCategory, richValue, shortValue } from '../src/utils/settings/view.js';
import { GUILD, body, colorOf, createWorld } from './support/fakes.js';
import { actionsOf, controls, field, footerOf, lines, openPanel, row, tabsOf, valueOf, PAGE_COUNT, tabs } from './support/panel.js';

const KEY_WIDTH = 'autorole.roles'.length;
const AUTOROLE_TABS = tabs(3);

async function autorolePage() {
  const world = await createWorld();
  const opened = await openPanel(world);
  const view = await opened.right(3);
  return { world, view, ...opened };
}

test('the auto role category is its own page with one setting', async () => {
  const { view } = await autorolePage();

  assert.equal(tabsOf(view), AUTOROLE_TABS);
  assert.equal(footerOf(view), `Sayfa 4/${PAGE_COUNT} · 1/1`);
  assert.deepEqual(lines(view), [row('autorole.roles', '—', true, KEY_WIDTH)]);
  assert.equal(field(view, 0).name, 'autorole.roles');
  assert.equal(field(view, 0).value, 'Sunucuya katılan üyelere otomatik verilen roller (botlara verilmez)');
  assert.equal(field(view, 1).value, '*ayarlanmamış*');
  assert.equal(field(view, 2).value, '*ayarlanmamış*');
});

test('the control is a role menu that allows several roles and has a reset row', async () => {
  const { view } = await autorolePage();
  const [navigation, control, reset] = controls(view);

  assert.equal(view.components.length, 3);
  assert.equal(navigation.length, 5);
  assert.equal(control.length, 1);
  assert.deepEqual(
    { type: control[0].type, id: actionsOf(control)[0], placeholder: control[0].placeholder, min: control[0].min_values, max: control[0].max_values, defaults: control[0].default_values },
    { type: 6, id: 'roles', placeholder: 'Rolleri seç', min: 1, max: 10, defaults: undefined },
  );
  assert.deepEqual(actionsOf(reset), ['reset']);
});

test('picking several roles saves them all and the menu shows them as selected', async () => {
  const { world, press } = await autorolePage();

  const update = (await press('roles', { values: ['111111', '222222', '333333'] })).log.updates[0];

  assert.deepEqual(valueOf(world, 'autorole.roles'), ['111111', '222222', '333333']);
  assert.equal(lines(update)[0], row('autorole.roles', 'Rol: 3', true, KEY_WIDTH));
  assert.equal(field(update, 1).value, '<@&111111> <@&222222> <@&333333>');
  assert.equal(field(update, 2).value, '*ayarlanmamış*');
  assert.deepEqual(controls(update)[1][0].default_values, [
    { id: '111111', type: 'role' },
    { id: '222222', type: 'role' },
    { id: '333333', type: 'role' },
  ]);
  assert.equal(colorOf(update), 0x5865f2);
});

test('a new selection replaces the old one, so a role is removed by unticking it', async () => {
  const { world, press } = await autorolePage();
  await press('roles', { values: ['111111', '222222', '333333'] });

  const update = (await press('roles', { values: ['111111', '333333'] })).log.updates[0];

  assert.deepEqual(valueOf(world, 'autorole.roles'), ['111111', '333333']);
  assert.equal(field(update, 1).value, '<@&111111> <@&333333>');
  assert.deepEqual(controls(update)[1][0].default_values.map((entry) => entry.id), ['111111', '333333']);
});

test('a single role is a valid list', async () => {
  const { world, press } = await autorolePage();
  const update = (await press('roles', { values: ['444444'] })).log.updates[0];
  assert.deepEqual(valueOf(world, 'autorole.roles'), ['444444']);
  assert.equal(lines(update)[0], row('autorole.roles', 'Rol: 1', true, KEY_WIDTH));
});

test('duplicate picks are collapsed', async () => {
  const { world, press } = await autorolePage();
  await press('roles', { values: ['111111', '111111', '222222'] });
  assert.deepEqual(valueOf(world, 'autorole.roles'), ['111111', '222222']);
});

test('more than ten roles are refused privately and the old list stays', async () => {
  const { world, press } = await autorolePage();
  await press('roles', { values: ['111111'] });
  const many = Array.from({ length: 11 }, (_, index) => String(500000 + index));

  const refused = await press('roles', { values: many });

  assert.equal(refused.log.updates.length, 0);
  assert.equal(body(refused.log.replies[0]), 'En fazla 10 rol seçilebilir.');
  assert.equal(refused.log.replies[0].ephemeral, true);
  assert.equal(colorOf(refused.log.replies[0]), 0xed4245);
  assert.deepEqual(valueOf(world, 'autorole.roles'), ['111111']);
});

test('exactly ten roles are accepted', async () => {
  const { world, press } = await autorolePage();
  const ten = Array.from({ length: 10 }, (_, index) => String(500000 + index));
  const update = (await press('roles', { values: ten })).log.updates[0];
  assert.deepEqual(valueOf(world, 'autorole.roles'), ten);
  assert.equal(lines(update)[0], row('autorole.roles', 'Rol: 10', true, KEY_WIDTH));
});

test('an invalid id from the menu is refused privately', async () => {
  const { world, press } = await autorolePage();
  const refused = await press('roles', { values: ['111111', 'not-an-id'] });
  assert.equal(body(refused.log.replies[0]), 'Geçerli bir kimlik veya etiket gir.');
  assert.deepEqual(valueOf(world, 'autorole.roles'), []);
});

test('reset empties the list and brings the menu back to nothing selected', async () => {
  const { world, press } = await autorolePage();
  await press('roles', { values: ['111111', '222222'] });

  const cleared = (await press('reset')).log.updates[0];

  assert.deepEqual(valueOf(world, 'autorole.roles'), []);
  assert.equal(world.app.settings.isSet(GUILD, 'autorole.roles'), false);
  assert.equal(lines(cleared)[0], row('autorole.roles', '—', true, KEY_WIDTH));
  assert.equal(field(cleared, 1).value, '*ayarlanmamış*');
  assert.equal(controls(cleared)[1][0].default_values, undefined);
});

test('the panel keeps its size with an empty list and with a full one', async () => {
  const { press, view } = await autorolePage();
  const full = (await press('roles', { values: Array.from({ length: 10 }, (_, index) => String(500000 + index)) })).log.updates[0];

  for (const payload of [view, full]) {
    assert.equal(payload.components.length, 3);
    assert.equal(payload.embeds[0].fields.length, 3);
    assert.equal(body(payload).split('\n').length, body(view).split('\n').length);
  }
  assert.ok(field(full, 1).value.length <= 900);
});

test('the page and the menu follow the server language', async () => {
  const world = await createWorld();
  world.app.settings.set(GUILD, 'language', 'en-US');
  const { right, press } = await openPanel(world);
  const view = await right(3);

  assert.equal(tabsOf(view), tabs(3, { lang: 'en-US' }));
  assert.equal(controls(view)[1][0].placeholder, 'Select roles');
  assert.equal(field(view, 0).value, 'Roles given automatically to members who join (bots are skipped)');

  const two = (await press('roles', { values: ['111111', '222222'] })).log.updates[0];
  assert.equal(lines(two)[0], row('autorole.roles', 'Roles: 2', true, KEY_WIDTH));

  const many = await press('roles', { values: Array.from({ length: 11 }, (_, index) => String(500000 + index)) });
  assert.equal(body(many.log.replies[0]), 'You can select at most 10 roles.');
});

test('the selection is saved per server', async () => {
  const world = await createWorld();
  const { right, press } = await openPanel(world);
  await right(3);
  await press('roles', { values: ['111111'] });
  assert.deepEqual(valueOf(world, 'autorole.roles'), ['111111']);
  assert.deepEqual(world.app.settings.get('some-other-server', 'autorole.roles'), []);
});

test('every language has the auto role texts', async () => {
  const world = await createWorld();
  for (const code of world.app.i18n.codes) {
    for (const key of ['settings.categories.autorole', 'settings.items.autorole.roles', 'settings.panel.pickRoles', 'settings.panel.rolesCount', 'errors.setting.tooMany']) {
      assert.notEqual(world.app.i18n.t(code, key), key, `${code}: ${key}`);
    }
    assert.match(world.app.i18n.t(code, 'settings.panel.rolesCount', { count: 7 }), /7/);
    assert.match(world.app.i18n.t(code, 'errors.setting.tooMany', { max: 10 }), /10/);
  }
});

test('controlFor, shortValue and richValue understand role lists', () => {
  const definition = { key: 'x.roles', type: 'roles', default: [] };
  const context = {
    t: (key, values) =>
      ({ 'settings.panel.rolesCount': `n=${values?.count}`, 'settings.panel.notSet': 'not set' })[key] ?? key,
  };

  assert.equal(controlFor(definition), 'roles');
  assert.equal(shortValue(context, definition, []), '—');
  assert.equal(shortValue(context, definition, undefined), '—');
  assert.equal(shortValue(context, definition, ['1', '2']), 'n=2');
  assert.equal(richValue(context, definition, []), '*not set*');
  assert.equal(richValue(context, definition, ['123456', '654321']), '<@&123456> <@&654321>');
});

test('a very long role list is cut inside the field limit without breaking a mention', () => {
  const definition = { key: 'x.roles', type: 'roles', default: [] };
  const context = { t: (key) => key };
  const ids = Array.from({ length: 80 }, (_, index) => String(1234567890123456000 + index));
  const text = richValue(context, definition, ids);

  assert.ok(text.length <= 900);
  assert.ok(text.split(' ').length > 10);
  assert.ok(text.split(' ').every((mention) => /^<@&\d+>$/.test(mention)));
});

test('the menu never lists more than 25 defaults and never asks for more than 25 picks', async () => {
  const world = await createWorld();
  const context = createContext(world.app, world.client, { guildId: GUILD });
  const definition = { key: 'big.roles', category: 'big', type: 'roles', default: [], maxItems: 100 };
  const ids = Array.from({ length: 40 }, (_, index) => String(600000 + index));
  const groups = groupByCategory([{ definition, value: ids }]);

  const { options } = buildView(context, 'settings:abc:', groups, 0, 0);
  const menu = options.components[1].components[0];
  assert.equal(menu.max_values, 25);
  assert.equal(menu.default_values.length, 25);
});
