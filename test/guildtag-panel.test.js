import test from 'node:test';
import assert from 'node:assert/strict';
import { handleTagUpdate } from '../src/utils/guildtag/service.js';
import { GUILD, body, colorOf, createWorld } from './support/fakes.js';
import { PADDED, PAGE_COUNT, actionsOf, controls, field, footerOf, lines, openPanel, row, tabs, tabsOf, valueOf } from './support/panel.js';

const WIDTH = 'guildtag.removeRoles'.length;
const PAGE = 4;

async function guildTagPage(options = {}) {
  const world = await createWorld(options);
  const opened = await openPanel(world);
  const view = await opened.right(PAGE);
  return { world, view, ...opened };
}

test('the server tag category is its own page with three settings', async () => {
  const { view } = await guildTagPage();

  assert.equal(tabsOf(view), tabs(PAGE));
  assert.equal(footerOf(view), `Sayfa ${PAGE + 1}/${PAGE_COUNT} · 1/3`);
  assert.deepEqual(lines(view), [
    row('guildtag.roles', '—', true, WIDTH),
    row('guildtag.removeRoles', 'açık', false, WIDTH),
    row('guildtag.logChannel', '—', false, WIDTH),
  ]);
  assert.equal(field(view, 0).name, 'guildtag.roles');
  assert.equal(field(view, 0).value, PADDED('Sunucu etiketini takan üyelere verilen roller'));
  assert.equal(field(view, 1).value, '*ayarlanmamış*');
});

test('the roles setting is a multi role menu with room for ten roles', async () => {
  const { view } = await guildTagPage();
  const [menu] = controls(view)[1];

  assert.deepEqual(
    { type: menu.type, id: actionsOf([menu])[0], placeholder: menu.placeholder, min: menu.min_values, max: menu.max_values, defaults: menu.default_values },
    { type: 6, id: 'roles', placeholder: 'Rolleri seç', min: 1, max: 10, defaults: undefined },
  );
  assert.equal(view.components.length, 3);
});

test('one role or many roles can be saved and show up as mentions', async () => {
  const { world, press } = await guildTagPage();

  const one = (await press('roles', { values: ['111111'] })).log.updates[0];
  assert.deepEqual(valueOf(world, 'guildtag.roles'), ['111111']);
  assert.equal(lines(one)[0], row('guildtag.roles', 'Rol: 1', true, WIDTH));
  assert.equal(field(one, 1).value, '<@&111111>');

  const many = (await press('roles', { values: ['111111', '222222', '333333'] })).log.updates[0];
  assert.deepEqual(valueOf(world, 'guildtag.roles'), ['111111', '222222', '333333']);
  assert.equal(field(many, 1).value, '<@&111111> <@&222222> <@&333333>');
  assert.deepEqual(controls(many)[1][0].default_values.map((entry) => entry.id), ['111111', '222222', '333333']);
});

test('more than ten roles are refused privately', async () => {
  const { world, press } = await guildTagPage();
  const refused = await press('roles', { values: Array.from({ length: 11 }, (_, index) => String(500000 + index)) });
  assert.equal(body(refused.log.replies[0]), 'En fazla 10 rol seçilebilir.');
  assert.deepEqual(valueOf(world, 'guildtag.roles'), []);
});

test('taking the roles back is a toggle that defaults to on', async () => {
  const { world, press, down } = await guildTagPage();
  const toggle = await down(1);

  assert.equal(valueOf(world, 'guildtag.removeRoles'), true);
  assert.equal(footerOf(toggle), `Sayfa ${PAGE + 1}/${PAGE_COUNT} · 2/3`);
  assert.deepEqual(actionsOf(controls(toggle)[1]), ['toggle']);
  assert.equal(controls(toggle)[1][0].label, 'Kapat');
  assert.equal(field(toggle, 0).value, PADDED('Etiket çıkarılınca verilen roller geri alınsın'));

  const off = (await press('toggle')).log.updates[0];
  assert.equal(valueOf(world, 'guildtag.removeRoles'), false);
  assert.equal(field(off, 1).value, 'kapalı');
  assert.equal(field(off, 2).value, 'açık');
  assert.equal(controls(off)[1][0].label, 'Aç');

  const on = (await press('toggle')).log.updates[0];
  assert.equal(valueOf(world, 'guildtag.removeRoles'), true);
  assert.equal(controls(on)[1][0].label, 'Kapat');
});

test('the log channel is a channel menu limited to text channels', async () => {
  const { world, press, down } = await guildTagPage();
  const empty = await down(2);

  const [menu] = controls(empty)[1];
  assert.deepEqual({ type: menu.type, id: actionsOf([menu])[0], placeholder: menu.placeholder, types: menu.channel_types }, { type: 8, id: 'channel', placeholder: 'Bir kanal seç', types: [0, 5] });
  assert.equal(field(empty, 0).value, 'Etiket takıldığında ve çıkarıldığında log gönderilecek kanal');

  const chosen = (await press('channel', { values: ['900100'] })).log.updates[0];
  assert.equal(valueOf(world, 'guildtag.logChannel'), '900100');
  assert.equal(field(chosen, 1).value, '<#900100>');
  assert.equal(lines(chosen)[2], row('guildtag.logChannel', '900100', true, WIDTH));
  assert.deepEqual(controls(chosen)[1][0].default_values, [{ id: '900100', type: 'channel' }]);

  const cleared = (await press('reset')).log.updates[0];
  assert.equal(valueOf(world, 'guildtag.logChannel'), null);
  assert.equal(field(cleared, 1).value, '*ayarlanmamış*');
});

test('reset brings each setting back to its default', async () => {
  const { world, press, down } = await guildTagPage();
  await press('roles', { values: ['111111'] });
  await down(1);
  await press('toggle');
  assert.equal(valueOf(world, 'guildtag.removeRoles'), false);

  await press('reset');
  assert.equal(valueOf(world, 'guildtag.removeRoles'), true);
  assert.deepEqual(valueOf(world, 'guildtag.roles'), ['111111']);
});

test('every item of the page keeps the same panel size', async () => {
  const { view, down } = await guildTagPage();
  const shapes = [view];
  shapes.push(await down(1));
  shapes.push(await down(1));
  shapes.push(await down(1));

  assert.ok(shapes.every((payload) => payload.components.length === 3));
  assert.ok(shapes.every((payload) => payload.embeds[0].fields.length === 3));
  assert.ok(shapes.every((payload) => body(payload).split('\n').length === body(view).split('\n').length));
});

test('the page follows the server language', async () => {
  const world = await createWorld();
  world.app.settings.set(GUILD, 'language', 'en-US');
  const { right } = await openPanel(world);
  const view = await right(PAGE);

  assert.equal(tabsOf(view), tabs(PAGE, { lang: 'en-US' }));
  assert.equal(footerOf(view), `Page ${PAGE + 1}/${PAGE_COUNT} · 1/3`);
  assert.equal(field(view, 0).value, PADDED('Roles given to members who wear the server tag'));
  assert.equal(controls(view)[1][0].placeholder, 'Select roles');
});

test('every language has the server tag texts', async () => {
  const world = await createWorld();
  const keys = [
    'settings.categories.guildtag',
    'settings.items.guildtag.roles',
    'settings.items.guildtag.removeRoles',
    'settings.items.guildtag.logChannel',
    'guildtag.log.adoptedTitle',
    'guildtag.log.adopted',
    'guildtag.log.removedTitle',
    'guildtag.log.removed',
    'guildtag.log.tag',
    'guildtag.log.rolesGiven',
    'guildtag.log.rolesRemoved',
    'guildtag.log.rolesFailed',
  ];
  for (const code of world.app.i18n.codes) {
    for (const key of keys) assert.notEqual(world.app.i18n.t(code, key), key, `${code}: ${key}`);
    assert.match(world.app.i18n.t(code, 'guildtag.log.adopted', { user: '<@7>' }), /<@7>/);
    assert.match(world.app.i18n.t(code, 'guildtag.log.removed', { user: '<@7>' }), /<@7>/);
  }
});

test('the built in server tag settings have the expected types and defaults', async () => {
  const world = await createWorld();
  const pick = (key) => {
    const { type, category, default: initial, maxItems, editable } = world.app.settings.definition(key);
    return { type, category, default: initial, maxItems, editable };
  };
  assert.deepEqual(pick('guildtag.roles'), { type: 'roles', category: 'guildtag', default: [], maxItems: 10, editable: true });
  assert.deepEqual(pick('guildtag.removeRoles'), { type: 'boolean', category: 'guildtag', default: true, maxItems: undefined, editable: true });
  assert.deepEqual(pick('guildtag.logChannel'), { type: 'channel', category: 'guildtag', default: null, maxItems: undefined, editable: true });
});

test('what is set in the panel is what the system uses for the next member', async () => {
  const world = await createWorld();
  const sent = [];
  world.client.channels = { get: () => undefined, fetch: async () => ({ id: '900100', guildId: GUILD, send: async (payload) => (sent.push(payload), {}) }) };
  const { right, down, press } = await openPanel(world);
  await right(PAGE);

  await press('roles', { values: ['700001', '700002'] });
  await down(2);
  await press('channel', { values: ['900100'] });

  await handleTagUpdate({ app: world.app, client: world.client, user: { id: 'T', username: 'u', tag_guild_id: GUILD }, eventGuildId: GUILD, roles: [] });
  assert.deepEqual(world.calls.addRole.map((call) => call[2]), ['700001', '700002']);
  assert.equal(sent.length, 1);
  assert.equal(colorOf(sent[0]), 0x57f287);

  await press('reset');
  await handleTagUpdate({ app: world.app, client: world.client, user: { id: 'T', username: 'u', tag_guild_id: null }, eventGuildId: GUILD, roles: [] });
  assert.equal(world.calls.removeRole.length, 2);
  assert.equal(sent.length, 1);
});
