import test from 'node:test';
import assert from 'node:assert/strict';
import { requirementMet } from '../src/utils/settings/requirements.js';
import { GUILD, apiError, body, createWorld } from './support/fakes.js';
import { PAGE_COUNT, actionsOf, controls, field, footerOf, lines, openPanel, valueOf } from './support/panel.js';

const PAGE = 4;
const NOTICE = 'Sunucu etiketi aktif değil. Etiket açılana kadar bu ayarlar düzenlenemez.';

async function lockedWorld({ restTag = null } = {}) {
  const world = await createWorld();
  world.guilds[GUILD] = { id: GUILD, raw: {} };
  world.client.rest.guilds.get = async () => ({ owner_id: 'O', guild_tag: restTag });
  return world;
}

const allDisabled = (payload) => controls(payload).slice(1).every((row) => row.every((component) => component.disabled === true));

test('without a server tag the page shows the notice instead of the description', async () => {
  const world = await lockedWorld();
  const { right } = await openPanel(world);
  const view = await right(PAGE);

  assert.equal(field(view, 0).value.split('\n')[0], `⚠️ ${NOTICE}`);
  assert.equal(footerOf(view), 'Sayfa 5/' + PAGE_COUNT + ' · 1/3');
  assert.equal(view.components.length, 3);
});

test('the controls of a locked setting are disabled but navigation still works', async () => {
  const world = await lockedWorld();
  const { right, down } = await openPanel(world);
  const view = await right(PAGE);

  assert.ok(allDisabled(view));
  assert.ok(controls(view)[0].every((component) => component.disabled !== true));
  const next = await down(1);
  assert.ok(allDisabled(next));
  assert.equal(footerOf(next), 'Sayfa 5/' + PAGE_COUNT + ' · 2/3');
  assert.equal(lines(next).length, 3);
});

test('other pages are not locked', async () => {
  const world = await lockedWorld();
  const { right } = await openPanel(world);
  const autorole = await right(3);
  assert.ok(!allDisabled(autorole));
  assert.notEqual(field(autorole, 0).value.split('\n')[0], `⚠️ ${NOTICE}`);
});

test('a forged change on a locked setting is refused privately and nothing changes', async () => {
  const world = await lockedWorld();
  const { right, press } = await openPanel(world);
  await right(PAGE);

  for (const [action, options] of [['roles', { values: ['111111'] }], ['reset', {}], ['edit', {}]]) {
    const result = await press(action, options);
    assert.equal(result.log.updates.length, 0, action);
    assert.equal(result.log.modals?.length ?? 0, 0, action);
    assert.equal(body(result.log.replies[0]), NOTICE, action);
  }
  assert.deepEqual(valueOf(world, 'guildtag.roles'), []);
});

test('the toggle and the channel menu are locked too', async () => {
  const world = await lockedWorld();
  const { right, down, press } = await openPanel(world);
  await right(PAGE);
  await down(1);
  const toggle = await press('toggle');
  assert.equal(body(toggle.log.replies[0]), NOTICE);
  assert.equal(valueOf(world, 'guildtag.removeRoles'), true);

  await down(1);
  const channel = await press('channel', { values: ['900100'] });
  assert.equal(body(channel.log.replies[0]), NOTICE);
  assert.equal(valueOf(world, 'guildtag.logChannel'), null);
});

test('with a server tag the page is editable as before', async () => {
  const world = await createWorld();
  const { right, press } = await openPanel(world);
  const view = await right(PAGE);
  assert.ok(!allDisabled(view));
  assert.deepEqual(actionsOf(controls(view)[1]), ['roles']);
  await press('roles', { values: ['111111'] });
  assert.deepEqual(valueOf(world, 'guildtag.roles'), ['111111']);
});

test('the tag is found through the server lookup when the cache has no data', async () => {
  const world = await lockedWorld({ restTag: 'ABC' });
  const { right } = await openPanel(world);
  assert.ok(!allDisabled(await right(PAGE)));
});

test('an unreachable server lookup never locks the page', async () => {
  const world = await lockedWorld();
  world.client.rest.guilds.get = async () => {
    throw apiError(500);
  };
  const { right } = await openPanel(world);
  assert.ok(!allDisabled(await right(PAGE)));
});

test('the answer is cached for a minute and then asked again', async () => {
  const world = await lockedWorld();
  let lookups = 0;
  world.client.rest.guilds.get = async () => (lookups += 1, { guild_tag: null });
  const context = { app: world.app, client: world.client, guildId: GUILD };

  assert.equal(await requirementMet(context, 'guildTag', { now: 1000 }), false);
  assert.equal(await requirementMet(context, 'guildTag', { now: 30_000 }), false);
  assert.equal(lookups, 1);

  world.client.rest.guilds.get = async () => (lookups += 1, { guild_tag: 'NEW' });
  assert.equal(await requirementMet(context, 'guildTag', { now: 62_000 }), true);
  assert.equal(lookups, 2);
});

test('an unknown requirement never blocks', async () => {
  const world = await createWorld();
  assert.equal(await requirementMet({ app: world.app, client: world.client, guildId: GUILD }, 'whatever'), true);
});

test('the notice exists in every language', async () => {
  const world = await createWorld();
  for (const code of world.app.i18n.codes) {
    const text = world.app.i18n.t(code, 'settings.requirements.guildTag');
    assert.notEqual(text, 'settings.requirements.guildTag', code);
  }
});

test('the notice follows the server language', async () => {
  const world = await lockedWorld();
  world.app.settings.set(GUILD, 'language', 'en-US');
  const { right } = await openPanel(world);
  const view = await right(PAGE);
  assert.equal(field(view, 0).value.split('\n')[0], '⚠️ The server tag is not active. These settings cannot be edited until the tag is enabled.');
});
