import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { Permission } from 'micup.ts';
import { createContext } from '../src/core/interaction/src/context.js';
import {
  INVISIBLE,
  buildView,
  categoryName,
  controlFor,
  groupByCategory,
  listBlock,
  listHeight,
  padDescription,
  richValue,
  shortValue,
} from '../src/utils/settings/view.js';
import { GUILD, actorFor, body, click, colorOf, createMessage, createWorld, settle, submit } from './support/fakes.js';
import { PADDED, actionsOf, controls, field, footerOf, lines, openPanel, rawLines, row, tabsOf, valueOf, PAGE_COUNT, tabs } from './support/panel.js';

const GENERAL_WIDTH = 'language'.length;
const LEVELS_WIDTH = 'levels.cooldownSeconds'.length;
const MODERATION_WIDTH = 'moderation.logChannel'.length;

async function worldWithAccess() {
  const world = await createWorld();
  world.app.settings.define('access.role', { category: 'access', type: 'role', default: null });
  world.app.settings.define('access.channel', { category: 'access', type: 'channel', default: null });
  return world;
}

test('the panel opens on the first category with tabs, an arrow on the first setting and the details below', async () => {
  const world = await createWorld();
  const { panel } = await openPanel(world);
  const embed = panel.embeds[0];

  assert.equal(embed.title, '⚙️ Sunucu ayarları');
  assert.equal(colorOf(panel), 0x5865f2);
  assert.equal(footerOf(panel), `Sayfa 1/${PAGE_COUNT} · 1/2`);
  assert.equal(tabsOf(panel), tabs(0));
  assert.equal(body(panel).split('\n')[1], '```');
  assert.ok(body(panel).endsWith('\n```'));

  assert.deepEqual(lines(panel), [row('prefix', '!', true, GENERAL_WIDTH), row('language', 'Türkçe (tr)', false, GENERAL_WIDTH)]);
  assert.deepEqual(embed.fields, [
    { name: 'prefix', value: PADDED('Komutları başlatan işaret, örneğin !') },
    { name: 'Değer', value: '`!`', inline: true },
    { name: 'Varsayılan', value: '`!`', inline: true },
  ]);
});

test('the first row has left, up, down, right and close; text settings get edit and reset on their own rows', async () => {
  const world = await createWorld();
  const { panel } = await openPanel(world);
  const [navigation, control, reset] = controls(panel);

  assert.deepEqual(actionsOf(navigation), ['left', 'up', 'down', 'right', 'close']);
  assert.deepEqual(navigation.map((button) => button.label), ['◀', '▲', '▼', '▶', 'Paneli kapat']);
  assert.ok(navigation.every((button) => button.type === 2));
  assert.deepEqual(actionsOf(control), ['edit']);
  assert.equal(control[0].label, 'Düzenle');
  assert.deepEqual(actionsOf(reset), ['reset']);
  assert.equal(reset[0].label, 'Sıfırla');
  assert.equal(panel.components.length, 3);
});

test('right and left switch between category pages and wrap around', async () => {
  const world = await createWorld();
  const { right, left } = await openPanel(world);

  const levels = await right(1);
  assert.equal(tabsOf(levels), tabs(1));
  assert.equal(footerOf(levels), `Sayfa 2/${PAGE_COUNT} · 1/6`);
  assert.deepEqual(lines(levels), [
    row('levels.enabled', 'açık', true, LEVELS_WIDTH),
    row('levels.xpMin', '15', false, LEVELS_WIDTH),
    row('levels.xpMax', '25', false, LEVELS_WIDTH),
    row('levels.cooldownSeconds', '60', false, LEVELS_WIDTH),
    row('levels.announce', 'Kanalda duyur', false, LEVELS_WIDTH),
    row('levels.channel', '—', false, LEVELS_WIDTH),
  ]);
  assert.equal(field(levels, 0).name, 'levels.enabled');

  const moderation = await right(1);
  assert.equal(tabsOf(moderation), tabs(2));
  assert.deepEqual(lines(moderation), [
    row('mute.sessionSeconds', '15', true, MODERATION_WIDTH),
    row('purge.maxAmount', '100', false, MODERATION_WIDTH),
    row('moderation.logChannel', '—', false, MODERATION_WIDTH),
    row('ban.sessionSeconds', '15', false, MODERATION_WIDTH),
  ]);

  const autorole = await right(1);
  assert.equal(tabsOf(autorole), tabs(3));
  assert.equal(footerOf(autorole), `Sayfa 4/${PAGE_COUNT} · 1/1`);
  assert.deepEqual(lines(autorole), [row('autorole.roles', '—', true, 'autorole.roles'.length)]);

  const guildTag = await right(1);
  assert.equal(tabsOf(guildTag), tabs(4));
  assert.equal(footerOf(guildTag), `Sayfa 5/${PAGE_COUNT} · 1/3`);
  assert.deepEqual(lines(guildTag), [
    row('guildtag.roles', '—', true, 'guildtag.removeRoles'.length),
    row('guildtag.removeRoles', 'açık', false, 'guildtag.removeRoles'.length),
    row('guildtag.logChannel', '—', false, 'guildtag.removeRoles'.length),
  ]);

  const general = await right(1);
  assert.equal(tabsOf(general), tabs(0));
  assert.equal(footerOf(general), `Sayfa 1/${PAGE_COUNT} · 1/2`);

  const wrapped = await left(1);
  assert.equal(tabsOf(wrapped), tabs(4));
  assert.equal(footerOf(wrapped), `Sayfa 5/${PAGE_COUNT} · 1/3`);

  const back = await left(1);
  assert.equal(tabsOf(back), tabs(3));
  assert.equal(footerOf(back), `Sayfa 4/${PAGE_COUNT} · 1/1`);
  assert.equal(tabsOf(await left(1)), tabs(2));
  assert.equal(tabsOf(await left(1)), tabs(1));
  assert.equal(footerOf(await left(1)), `Sayfa 1/${PAGE_COUNT} · 1/2`);
});

test('up and down move inside the current category only and wrap there', async () => {
  const world = await createWorld();
  const { down, up } = await openPanel(world);

  const second = await down(1);
  assert.deepEqual(lines(second), [row('prefix', '!', false, GENERAL_WIDTH), row('language', 'Türkçe (tr)', true, GENERAL_WIDTH)]);
  assert.equal(footerOf(second), `Sayfa 1/${PAGE_COUNT} · 2/2`);

  const wrapped = await down(1);
  assert.ok(lines(wrapped)[0].startsWith('→ prefix'));

  const last = await up(1);
  assert.ok(lines(last)[1].startsWith('→ language'));
  assert.equal(tabsOf(last), tabs(0));
});

test('each page remembers where you were', async () => {
  const world = await createWorld();
  const { right, left, down } = await openPanel(world);

  await right(1);
  const deep = await down(2);
  assert.equal(footerOf(deep), `Sayfa 2/${PAGE_COUNT} · 3/6`);
  assert.equal(field(deep, 0).name, 'levels.xpMax');

  await right(1);
  await down(1);
  const back = await left(1);
  assert.equal(footerOf(back), `Sayfa 2/${PAGE_COUNT} · 3/6`);
  assert.ok(lines(back)[2].startsWith('→ levels.xpMax'));

  const general = await left(1);
  assert.equal(footerOf(general), `Sayfa 1/${PAGE_COUNT} · 1/2`);
});

test('the control below the list follows the setting type, with reset on its own row for menus', async () => {
  const world = await createWorld();
  const { down, right } = await openPanel(world);

  const language = await down(1);
  const [, menuRow, resetRow] = controls(language);
  assert.equal(language.components.length, 3);
  assert.equal(menuRow[0].type, 3);
  assert.deepEqual(menuRow[0].options.map((option) => option.label), ['Deutsch (de)', 'English (en-US)', 'Español (es-ES)', 'Français (fr)', 'Русский (ru)', 'Türkçe (tr)']);
  assert.deepEqual(menuRow[0].options.filter((option) => option.default).map((option) => option.value), ['tr']);
  assert.deepEqual(actionsOf(resetRow), ['reset']);
  assert.equal(field(language, 0).value, PADDED('Botun bu sunucuda kullandığı dil'));

  const toggle = await right(1);
  const [, toggleRow, toggleReset] = controls(toggle);
  assert.equal(toggle.components.length, 3);
  assert.deepEqual(actionsOf(toggleRow), ['toggle']);
  assert.equal(toggleRow[0].label, 'Kapat');
  assert.deepEqual(actionsOf(toggleReset), ['reset']);
});

test('editing text opens a prefilled modal and a valid answer updates the panel', async () => {
  const world = await createWorld();
  const { message, press, send } = await openPanel(world);

  const edit = await press('edit');
  const form = edit.log.modals[0];
  assert.equal(form.title, 'Ayarı düzenle');
  assert.match(form.custom_id, /^settings:[0-9a-f]{8}:modal:prefix$/);
  const [input] = form.components[0].components;
  assert.deepEqual(
    { id: input.custom_id, label: input.label, value: input.value, min: input.min_length, max: input.max_length, required: input.required },
    { id: 'value', label: 'prefix', value: '!', min: 1, max: 5, required: true },
  );
  assert.equal(input.style, 2);

  const answer = await send('prefix', '?');
  assert.equal(valueOf(world, 'prefix'), '?');
  assert.equal(answer.log.deferred, 1);
  assert.equal(answer.log.deleted, 1);
  assert.equal(answer.log.replies.length, 0);

  const edited = message.edits.at(-1);
  assert.equal(lines(edited)[0], row('prefix', '?', true, GENERAL_WIDTH));
  assert.equal(field(edited, 1).value, '`?`');
  assert.equal(field(edited, 2).value, '`!`');
});

test('a rejected answer shows a private error and changes nothing', async () => {
  const world = await createWorld();
  const { message, send } = await openPanel(world);

  const tooLong = await send('prefix', 'toolong');
  assert.equal(body(tooLong.log.replies[0]), 'Değer en fazla 5 karakter olmalı.');
  assert.equal(tooLong.log.replies[0].ephemeral, true);
  assert.equal(colorOf(tooLong.log.replies[0]), 0xed4245);

  assert.equal(body((await send('prefix', 'a b')).log.replies[0]), 'Bu değere izin verilmiyor.');
  assert.equal(body((await send('prefix', '   ')).log.replies[0]), 'Değer en az 1 karakter olmalı.');

  assert.equal(valueOf(world, 'prefix'), '!');
  assert.equal(message.edits.length, 0);
  assert.equal(tooLong.log.deferred, 0);
});

test('number settings get a number modal, validate the range and keep the page and selection', async () => {
  const world = await createWorld();
  const { message, right, down, press, send } = await openPanel(world);
  await right(2);
  await down(1);

  const edit = await press('edit');
  const [input] = edit.log.modals[0].components[0].components;
  assert.equal(edit.log.modals[0].custom_id.endsWith(':modal:purge.maxAmount'), true);
  assert.deepEqual({ label: input.label, value: input.value, max: input.max_length, min: input.min_length }, { label: 'purge.maxAmount', value: '100', max: 12, min: undefined });

  assert.equal(body((await send('purge.maxAmount', 'abc')).log.replies[0]), 'Değer tam sayı olmalı.');
  assert.equal(body((await send('purge.maxAmount', '5000')).log.replies[0]), 'Değer en fazla 1000 olmalı.');
  assert.equal(body((await send('purge.maxAmount', '0')).log.replies[0]), 'Değer en az 1 olmalı.');
  assert.equal(valueOf(world, 'purge.maxAmount'), 100);

  await send('purge.maxAmount', '250');
  assert.equal(valueOf(world, 'purge.maxAmount'), 250);
  const edited = message.edits.at(-1);
  assert.equal(lines(edited)[1], row('purge.maxAmount', '250', true, MODERATION_WIDTH));
  assert.equal(footerOf(edited), `Sayfa 3/${PAGE_COUNT} · 2/4`);
});

test('an answer for a setting on another page brings that page to the front', async () => {
  const world = await createWorld();
  const { message, send } = await openPanel(world);

  await send('levels.xpMax', '40');

  assert.equal(valueOf(world, 'levels.xpMax'), 40);
  const edited = message.edits.at(-1);
  assert.equal(tabsOf(edited), tabs(1));
  assert.equal(footerOf(edited), `Sayfa 2/${PAGE_COUNT} · 3/6`);
  assert.ok(lines(edited)[2].startsWith('→ levels.xpMax'));
});

test('yes or no settings use a toggle button that flips and relabels', async () => {
  const world = await createWorld();
  const { right, press } = await openPanel(world);
  await right(1);

  const off = (await press('toggle')).log.updates[0];
  assert.equal(valueOf(world, 'levels.enabled'), false);
  assert.equal(lines(off)[0], row('levels.enabled', 'kapalı', true, LEVELS_WIDTH));
  assert.equal(field(off, 1).value, 'kapalı');
  assert.equal(field(off, 2).value, 'açık');
  assert.equal(controls(off)[1][0].label, 'Aç');

  const on = (await press('toggle')).log.updates[0];
  assert.equal(valueOf(world, 'levels.enabled'), true);
  assert.equal(field(on, 1).value, 'açık');
  assert.equal(controls(on)[1][0].label, 'Kapat');
});

test('settings with fixed choices use a select menu with readable names', async () => {
  const world = await createWorld();
  const { right, down, press } = await openPanel(world);
  await right(1);
  const announce = await down(4);
  assert.equal(footerOf(announce), `Sayfa 2/${PAGE_COUNT} · 5/6`);

  const [menu] = controls(announce)[1];
  assert.equal(menu.type, 3);
  assert.deepEqual(menu.options.map((option) => [option.label, option.value, Boolean(option.default)]), [
    ['Kanalda duyur', 'message', true],
    ['Kapalı', 'off', false],
  ]);

  const chosen = (await press('choice', { values: ['off'] })).log.updates[0];
  assert.equal(valueOf(world, 'levels.announce'), 'off');
  assert.equal(lines(chosen)[4], row('levels.announce', 'Kapalı', true, LEVELS_WIDTH));
  assert.equal(field(chosen, 1).value, 'Kapalı');
  assert.deepEqual(controls(chosen)[1][0].options.map((option) => Boolean(option.default)), [false, true]);
});

test('changing the language redraws tabs, buttons, details and footer in the new language', async () => {
  const world = await createWorld();
  const { down, press } = await openPanel(world);
  await down(1);

  const english = (await press('choice', { values: ['en-US'] })).log.updates[0];

  assert.equal(valueOf(world, 'language'), 'en-US');
  assert.equal(english.embeds[0].title, '⚙️ Server settings');
  assert.equal(tabsOf(english), tabs(0, { lang: 'en-US' }));
  assert.equal(footerOf(english), `Page 1/${PAGE_COUNT} · 2/2`);
  assert.deepEqual(controls(english)[0].map((button) => button.label), ['◀', '▲', '▼', '▶', 'Close']);
  assert.equal(controls(english)[2][0].label, 'Reset');
  assert.equal(lines(english)[1], row('language', 'English (en-US)', true, GENERAL_WIDTH));
  assert.equal(field(english, 0).value, PADDED('Language the bot uses in this server'));
  assert.deepEqual([field(english, 1).name, field(english, 2).name], ['Value', 'Default']);
  assert.equal(field(english, 2).value, 'Türkçe (tr)');

  const back = (await press('choice', { values: ['tr'] })).log.updates[0];
  assert.equal(back.embeds[0].title, '⚙️ Sunucu ayarları');
  assert.equal(tabsOf(back), tabs(0));
});

test('a category without a translation shows its raw name', async () => {
  const world = await worldWithAccess();
  const { right } = await openPanel(world);
  const access = await right(PAGE_COUNT);
  assert.equal(tabsOf(access), tabs(PAGE_COUNT, { extra: ['access'] }));
  assert.equal(footerOf(access), `Sayfa ${PAGE_COUNT + 1}/${PAGE_COUNT + 1} · 1/2`);
});

test('role settings use a role menu that shows the current role and can be reset', async () => {
  const world = await worldWithAccess();
  const { right, press } = await openPanel(world);

  const empty = await right(PAGE_COUNT);
  assert.equal(lines(empty)[0], row('access.role', '—', true, 'access.channel'.length));
  assert.equal(field(empty, 0).value, PADDED('—'));
  assert.equal(field(empty, 1).value, '*ayarlanmamış*');
  const [menu] = controls(empty)[1];
  assert.deepEqual({ type: menu.type, placeholder: menu.placeholder, defaults: menu.default_values }, { type: 6, placeholder: 'Bir rol seç', defaults: undefined });
  assert.deepEqual(actionsOf([menu]), ['role']);
  assert.deepEqual(actionsOf(controls(empty)[2]), ['reset']);

  const chosen = (await press('role', { values: ['777777'] })).log.updates[0];
  assert.equal(valueOf(world, 'access.role'), '777777');
  assert.equal(field(chosen, 1).value, '<@&777777>');
  assert.equal(lines(chosen)[0], row('access.role', '777777', true, 'access.channel'.length));
  assert.deepEqual(controls(chosen)[1][0].default_values, [{ id: '777777', type: 'role' }]);

  const cleared = (await press('reset')).log.updates[0];
  assert.equal(valueOf(world, 'access.role'), null);
  assert.equal(field(cleared, 1).value, '*ayarlanmamış*');
  assert.equal(controls(cleared)[1][0].default_values, undefined);
});

test('channel settings use a channel menu limited to text channels and show a mention', async () => {
  const world = await worldWithAccess();
  const { right, down, press } = await openPanel(world);
  await right(PAGE_COUNT);

  const empty = await down(1);
  const [menu] = controls(empty)[1];
  assert.deepEqual({ type: menu.type, placeholder: menu.placeholder, types: menu.channel_types }, { type: 8, placeholder: 'Bir kanal seç', types: [0, 5] });
  assert.deepEqual(actionsOf([menu]), ['channel']);

  const chosen = (await press('channel', { values: ['888888'] })).log.updates[0];
  assert.equal(valueOf(world, 'access.channel'), '888888');
  assert.equal(field(chosen, 1).value, '<#888888>');
  assert.deepEqual(controls(chosen)[1][0].default_values, [{ id: '888888', type: 'channel' }]);
});

test('a channel setting can ask for other channel types', async () => {
  const world = await createWorld();
  world.app.settings.define('radio.channel', { category: 'radio', type: 'channel', default: null, channelTypes: [2] });
  const { right } = await openPanel(world);
  assert.deepEqual(controls(await right(PAGE_COUNT))[1][0].channel_types, [2]);
});

test('an invalid role id from a menu is rejected privately', async () => {
  const world = await worldWithAccess();
  const { right, press } = await openPanel(world);
  await right(PAGE_COUNT);

  const bad = await press('role', { values: ['not-an-id'] });
  assert.equal(body(bad.log.replies[0]), 'Geçerli bir kimlik veya etiket gir.');
  assert.equal(bad.log.updates.length, 0);
  assert.equal(valueOf(world, 'access.role'), null);
});

test('reset restores the default of the selected setting', async () => {
  const world = await createWorld();
  const { message, press, send } = await openPanel(world);
  await send('prefix', '?');
  assert.equal(world.app.settings.isSet(GUILD, 'prefix'), true);
  assert.equal(message.edits.length, 1);

  const reset = (await press('reset')).log.updates[0];
  assert.equal(valueOf(world, 'prefix'), '!');
  assert.equal(world.app.settings.isSet(GUILD, 'prefix'), false);
  assert.equal(field(reset, 1).value, '`!`');
});

test('reset after a language change brings the default language back', async () => {
  const world = await createWorld();
  const { down, press } = await openPanel(world);
  await down(1);
  await press('choice', { values: ['de'] });
  assert.equal(valueOf(world, 'language'), 'de');

  const reset = (await press('reset')).log.updates[0];
  assert.equal(valueOf(world, 'language'), 'tr');
  assert.equal(reset.embeds[0].title, '⚙️ Sunucu ayarları');
});

test('close removes the controls, keeps the page and ends the session', async () => {
  const world = await createWorld();
  const { right, press } = await openPanel(world);
  await right(1);
  assert.equal(world.client.listenerCount('interactionCreate'), 1);

  const closed = (await press('close')).log.updates[0];
  assert.deepEqual(closed.components, []);
  assert.equal(footerOf(closed), `Sayfa 2/${PAGE_COUNT} · 1/6`);
  assert.equal(tabsOf(closed), tabs(1));
  assert.equal(world.client.listenerCount('interactionCreate'), 0);

  const late = await press('down');
  assert.equal(late.log.updates.length, 0);
});

test('only the person who opened the panel can use it', async () => {
  const world = await createWorld();
  const { press } = await openPanel(world);

  const stranger = await press('right', { user: 'H' });
  assert.equal(stranger.log.updates.length, 0);
  assert.equal(body(stranger.log.replies[0]), 'Bu paneli yalnızca açan kişi kullanabilir.');
  assert.equal(stranger.log.replies[0].ephemeral, true);

  const owner = await press('right');
  assert.equal(tabsOf(owner.log.updates[0]), tabs(1));
});

test('a stale modal for an unknown setting is rejected', async () => {
  const world = await createWorld();
  const { send, message } = await openPanel(world);
  const stale = await send('removed.setting', 'x');
  assert.equal(body(stale.log.replies[0]), 'Bilinmeyen ayar: removed.setting');
  assert.equal(message.edits.length, 0);
});

test('the panel closes itself after 120 idle seconds and every action restarts the window', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const world = await createWorld();
    const { message, press } = await openPanel(world);

    mock.timers.tick(119_999);
    await settle();
    assert.equal(message.edits.length, 0);

    mock.timers.tick(1);
    await settle();
    assert.deepEqual(message.edits.at(-1).components, []);
    assert.equal(footerOf(message.edits.at(-1)), `Sayfa 1/${PAGE_COUNT} · 1/2`);
    assert.equal(world.client.listenerCount('interactionCreate'), 0);
    assert.equal((await press('down')).log.updates.length, 0);

    const second = await createWorld();
    const panel = await openPanel(second);
    mock.timers.tick(100_000);
    await panel.press('right');
    mock.timers.tick(100_000);
    await settle();
    assert.equal(panel.message.edits.length, 0);
    mock.timers.tick(20_000);
    await settle();
    assert.deepEqual(panel.message.edits.at(-1).components, []);
    assert.equal(footerOf(panel.message.edits.at(-1)), `Sayfa 2/${PAGE_COUNT} · 1/6`);
  } finally {
    mock.timers.reset();
  }
});

function slashFor(world, locale = 'en-US') {
  const calls = [];
  const interaction = {
    guildId: GUILD,
    channelId: '200',
    locale,
    commandName: 'settings',
    member: actorFor(world, 'A'),
    deferred: false,
    replied: false,
    async reply(payload) {
      calls.push(['reply', payload]);
    },
    async editReply(payload) {
      calls.push(['edit', payload]);
    },
  };
  return { interaction, calls };
}

test('the slash command opens a private panel and edits it through the interaction', async () => {
  const world = await createWorld();
  const { interaction, calls } = slashFor(world);

  await world.client.slash.get('settings')(interaction);
  await settle();

  const [, panel] = calls[0];
  assert.equal(panel.ephemeral, true);
  assert.equal(panel.embeds[0].title, '⚙️ Server settings');
  assert.equal(tabsOf(panel), tabs(0, { lang: 'en-US' }));
  const sessionId = panel.components[0].components[0].custom_id.split(':')[1];

  const press = click(`settings:${sessionId}:right`);
  world.client.emit('interactionCreate', press);
  await settle();
  assert.equal(tabsOf(press.log.updates[0]), tabs(1, { lang: 'en-US' }));

  const answer = submit(`settings:${sessionId}:modal:language`, 'x');
  world.client.emit('interactionCreate', answer);
  await settle();
  assert.equal(body(answer.log.replies[0]), 'The value must be one of: de, en-US, es-ES, fr, ru, tr');
});

test('a successful slash modal answer edits the original reply', async () => {
  const world = await createWorld();
  world.app.settings.define('custom.text', { category: 'custom', type: 'string', default: 'a', maxLength: 10 });
  const { interaction, calls } = slashFor(world, 'tr');
  await world.client.slash.get('settings')(interaction);
  await settle();
  const sessionId = calls[0][1].components[0].components[0].custom_id.split(':')[1];

  const answer = submit(`settings:${sessionId}:modal:custom.text`, 'hello');
  world.client.emit('interactionCreate', answer);
  await settle();

  assert.equal(valueOf(world, 'custom.text'), 'hello');
  const [kind, payload] = calls.at(-1);
  assert.equal(kind, 'edit');
  assert.equal(tabsOf(payload), tabs(PAGE_COUNT, { extra: ['custom'] }));
  assert.ok(lines(payload)[0].endsWith('hello'));
  assert.equal(answer.log.deleted, 1);
});

test('members without Manage Server cannot open the panel in either mode', async () => {
  const world = await createWorld();
  const { panel } = await openPanel(world, { permissions: Permission.ManageMessages });
  assert.match(body(panel), /Sunucuyu Yönet/);
  assert.equal(panel.components, undefined);
  assert.equal(world.client.listenerCount('interactionCreate'), 0);

  const replies = [];
  const interaction = {
    guildId: GUILD,
    channelId: '200',
    locale: 'tr',
    commandName: 'settings',
    member: actorFor(world, 'A', Permission.ManageMessages),
    deferred: false,
    replied: false,
    async reply(payload) {
      replies.push(payload);
    },
  };
  await world.client.slash.get('settings')(interaction);
  assert.match(body(replies[0]), /Sunucuyu Yönet/);
  assert.equal(world.client.listenerCount('interactionCreate'), 0);
});

test('every language name opens the panel and each panel is independent', async () => {
  const world = await createWorld();
  const names = ['settings', 'ayarlar', 'ayar', 'config', 'einstellungen', 'ajustes', 'parametres', 'настройки'];
  const panels = [];
  for (const name of names) {
    const opened = await openPanel(world, { content: `!${name}` });
    assert.ok(opened.panel.components, name);
    panels.push(opened);
  }
  assert.equal(new Set(panels.map((opened) => opened.sessionId)).size, names.length);
  assert.equal(world.client.listenerCount('interactionCreate'), names.length);

  await panels[0].press('right');
  const untouched = await panels[1].press('up');
  assert.ok(lines(untouched.log.updates[0])[1].startsWith('→ language'));
  assert.equal(footerOf(untouched.log.updates[0]), `Sayfa 1/${PAGE_COUNT} · 2/2`);
});

test('settings without a category land on the general page', async () => {
  const world = await createWorld();
  world.app.settings.define('plain.setting', { type: 'string', default: 'x' });
  const { panel, down } = await openPanel(world);
  assert.equal(footerOf(panel), `Sayfa 1/${PAGE_COUNT} · 1/3`);
  assert.equal((await down(2)).embeds[0].fields[0].name, 'plain.setting');
});

test('non editable settings never appear and a category with only those has no page', async () => {
  const world = await createWorld();
  world.app.settings.define('internal.flag', { category: 'internal', type: 'boolean', default: false, editable: false });
  world.app.settings.define('general.hidden', { category: 'general', type: 'boolean', default: false, editable: false });
  const { panel } = await openPanel(world);
  assert.equal(footerOf(panel), `Sayfa 1/${PAGE_COUNT} · 1/2`);
  assert.ok(!body(panel).includes('internal'));
  assert.ok(!body(panel).includes('hidden'));
});

test('a big category scrolls in a window that keeps the arrow visible', async () => {
  const world = await createWorld();
  for (let index = 0; index < 12; index += 1) {
    world.app.settings.define(`zz.item${String(index).padStart(2, '0')}`, { category: 'bulk', type: 'string', default: 'x' });
  }
  const { right, down } = await openPanel(world);
  const first = await right(PAGE_COUNT);
  assert.equal(footerOf(first), `Sayfa ${PAGE_COUNT + 1}/${PAGE_COUNT + 1} · 1/12`);
  assert.equal(lines(first).length, 9);
  assert.ok(lines(first)[0].startsWith('→ zz.item00'));

  const middle = await down(4);
  assert.equal(lines(middle).length, 9);
  assert.ok(lines(middle)[4].startsWith('→ zz.item04'));

  const deep = await down(5);
  assert.ok(lines(deep)[6].startsWith('→ zz.item09'));
  assert.ok(lines(deep)[0].includes('zz.item03'));

  const end = await down(2);
  assert.ok(lines(end)[8].startsWith('→ zz.item11'));
  assert.equal(footerOf(end), `Sayfa ${PAGE_COUNT + 1}/${PAGE_COUNT + 1} · 12/12`);
});

test('long values are cut in the list and backticks cannot break the code block', async () => {
  const world = await createWorld();
  world.app.settings.define('note.long', { category: 'notes', type: 'string', default: 'y'.repeat(60) });
  world.app.settings.define('note.tick', { category: 'notes', type: 'string', default: 'a`b`c' });
  const { right, down } = await openPanel(world);

  const long = await right(PAGE_COUNT);
  const longLine = lines(long).find((line) => line.startsWith('→'));
  assert.ok(longLine.endsWith('…'));
  assert.equal(Array.from(longLine.match(/y+…$/)[0]).length, 22);
  assert.equal(field(long, 1).value, `\`${'y'.repeat(60)}\``);

  const tick = await down(1);
  const tickLine = lines(tick).find((line) => line.startsWith('→'));
  assert.ok(tickLine.endsWith("a'b'c"));
  assert.equal(field(tick, 1).value, "`a'b'c`");
  assert.equal(body(tick).split('```').length, 3);
});

test('with a single category there are no page buttons and no tabs bar change', async () => {
  const world = await createWorld();
  const context = createContext(world.app, world.client, { guildId: GUILD });
  const definition = world.app.settings.definition('prefix');
  const groups = [{ key: 'general', items: [{ definition, value: '!' }] }];

  const { text, options } = buildView(context, 'settings:x:', groups, 0, 0);
  assert.equal(text.split('\n')[0], '**Genel**');
  assert.deepEqual(actionsOf(options.components[0].components), ['up', 'down', 'close']);
  assert.equal(options.footer, 'Sayfa 1/1 · 1/1');

  const closed = buildView(context, 'settings:x:', groups, 0, 0, { interactive: false });
  assert.deepEqual(closed.options.components, []);
});

test('groupByCategory keeps the order of first appearance and the order inside each group', () => {
  const item = (key, category) => ({ definition: { key, category }, value: null });
  const groups = groupByCategory([item('a', 'x'), item('b', 'y'), item('c', 'x'), item('d', 'z'), item('e', 'y')]);
  assert.deepEqual(groups.map((group) => [group.key, group.items.map((entry) => entry.definition.key)]), [
    ['x', ['a', 'c']],
    ['y', ['b', 'e']],
    ['z', ['d']],
  ]);
  assert.deepEqual(groupByCategory([]), []);
});

test('categoryName translates known categories and falls back to the key', async () => {
  const world = await createWorld();
  const context = createContext(world.app, world.client, { guildId: GUILD });
  assert.equal(categoryName(context, 'levels'), 'Seviye');
  assert.equal(categoryName(context, 'unknown-one'), 'unknown-one');
  context.lang = 'ru';
  assert.deepEqual(['general', 'levels', 'moderation'].map((key) => categoryName(context, key)), ['Общие', 'Уровни', 'Модерация']);
});

test('controlFor maps every setting type to the right kind of control', () => {
  const kinds = [
    [{ type: 'string' }, 'edit'],
    [{ type: 'integer' }, 'edit'],
    [{ type: 'boolean' }, 'toggle'],
    [{ type: 'role' }, 'role'],
    [{ type: 'channel' }, 'channel'],
    [{ type: 'string', choices: ['a', 'b'] }, 'choice'],
    [{ type: 'string', choices: () => ['a'] }, 'choice'],
    [{ type: 'integer', choices: [1, 2, 3] }, 'choice'],
    [{ type: 'string', choices: [] }, 'edit'],
    [{ type: 'string', choices: () => [] }, 'edit'],
  ];
  for (const [definition, expected] of kinds) assert.equal(controlFor(definition), expected, JSON.stringify(definition));
});

test('values are written short in the list and rich in the details', () => {
  const context = { t: (key) => ({ 'settings.panel.on': 'on', 'settings.panel.off': 'off', 'settings.panel.notSet': 'not set' })[key] ?? key };

  assert.equal(shortValue(context, { type: 'boolean' }, true), 'on');
  assert.equal(shortValue(context, { type: 'boolean' }, false), 'off');
  assert.equal(shortValue(context, { type: 'role' }, null), '—');
  assert.equal(shortValue(context, { type: 'string' }, ''), '—');
  assert.equal(shortValue(context, { type: 'integer' }, 0), '0');
  assert.equal(shortValue(context, { type: 'string' }, 'a`b'), "a'b");

  assert.equal(richValue(context, { type: 'role' }, '5'), '<@&5>');
  assert.equal(richValue(context, { type: 'channel' }, '6'), '<#6>');
  assert.equal(richValue(context, { type: 'role' }, null), '*not set*');
  assert.equal(richValue(context, { type: 'integer' }, 12), '`12`');
  assert.equal(richValue(context, { type: 'boolean' }, true), 'on');
});

test('listBlock keeps the selection inside the window at the edges', () => {
  const context = { t: (key) => key };
  const items = Array.from({ length: 30 }, (_, index) => ({ definition: { key: `k${index}`, type: 'string' }, value: String(index) }));
  const arrowAt = (selected) => {
    const rows = listBlock(context, items, selected).split('\n').slice(1, -1);
    return { count: rows.length, arrow: rows.findIndex((line) => line.startsWith('→')), first: rows[0].slice(2).split(' ')[0] };
  };

  assert.deepEqual(arrowAt(0), { count: 9, arrow: 0, first: 'k0' });
  assert.deepEqual(arrowAt(4), { count: 9, arrow: 4, first: 'k0' });
  assert.deepEqual(arrowAt(15), { count: 9, arrow: 4, first: 'k11' });
  assert.deepEqual(arrowAt(29), { count: 9, arrow: 8, first: 'k21' });
  assert.equal(listBlock(context, items.slice(0, 3), 1).split('\n').length, 5);
});

test('the settings modal is the same multi line box as the mute reason modal', async () => {
  const world = await createWorld();
  const { press } = await openPanel(world);
  const settingsInput = (await press('edit')).log.modals[0].components[0].components[0];

  const { paragraphInput } = await import('micup.ts/easy');
  assert.equal(settingsInput.type, 4);
  assert.equal(settingsInput.style, paragraphInput('x', 'y').style);
});

test('line breaks typed into the modal become spaces so single line settings keep working', async () => {
  const world = await createWorld();
  const { send, message } = await openPanel(world);

  const trailing = await send('prefix', '?\n');
  assert.equal(trailing.log.replies.length, 0);
  assert.equal(valueOf(world, 'prefix'), '?');
  assert.equal(message.edits.length, 1);

  const split = await send('prefix', 'a\nb');
  assert.equal(body(split.log.replies[0]), 'Bu değere izin verilmiyor.');
  assert.equal(valueOf(world, 'prefix'), '?');

  const crlf = await send('purge.maxAmount', '2\r\n5');
  assert.equal(body(crlf.log.replies[0]), 'Değer tam sayı olmalı.');

  const padded = await send('purge.maxAmount', '\n  300 \n');
  assert.equal(padded.log.replies.length, 0);
  assert.equal(valueOf(world, 'purge.maxAmount'), 300);
});

test('free text settings keep their words and lose only the line breaks', async () => {
  const world = await createWorld();
  world.app.settings.define('custom.note', { category: 'custom', type: 'string', default: 'a', maxLength: 50 });
  const { send } = await openPanel(world);

  await send('custom.note', 'hello\n  there \r\n world');
  assert.equal(valueOf(world, 'custom.note'), 'hello there world');
});

test('the panel keeps one height on every page and for every kind of setting', async () => {
  const world = await worldWithAccess();
  const shapes = [];
  const { panel, right, down } = await openPanel(world);
  const record = (payload) =>
    shapes.push({
      listRows: rawLines(payload).length,
      componentRows: payload.components.length,
      fields: payload.embeds[0].fields.length,
      descriptionLines: Math.max(field(payload, 0).value.split('\n').length, Math.ceil(Array.from(field(payload, 0).value).length / 55)),
    });

  const pages = Number(footerOf(panel).match(/\/(\d+) ·/)[1]);
  assert.equal(pages, PAGE_COUNT + 1);
  for (let page = 0; page < pages; page += 1) {
    const view = page === 0 ? panel : await right(1);
    record(view);
    const size = Number(footerOf(view).match(/· \d+\/(\d+)/)[1]);
    for (let position = 1; position < size; position += 1) record(await down(1));
  }

  assert.equal(shapes.length, 2 + 6 + 4 + 1 + 3 + 2);
  assert.deepEqual(new Set(shapes.map((shape) => shape.listRows)), new Set([6]));
  assert.deepEqual(new Set(shapes.map((shape) => shape.componentRows)), new Set([3]));
  assert.deepEqual(new Set(shapes.map((shape) => shape.fields)), new Set([3]));
  assert.ok(shapes.every((shape) => shape.descriptionLines >= 2));
});

test('every kind of control sits in the same place', async () => {
  const world = await worldWithAccess();
  const { right, down } = await openPanel(world);
  const kinds = [];

  const note = (payload) => {
    const [navigation, control, reset] = controls(payload);
    kinds.push({ rows: payload.components.length, navigation: navigation.length, resetRow: actionsOf(reset).join(), first: control[0].type });
  };

  note(await down(1));
  note(await right(1));
  note(await down(4));
  note(await right(2));
  note(await right(1));
  note(await right(1));
  note(await down(1));

  assert.ok(kinds.every((kind) => kind.rows === 3));
  assert.ok(kinds.every((kind) => kind.navigation === 5));
  assert.ok(kinds.every((kind) => kind.resetRow === 'reset'));
  assert.deepEqual(new Set(kinds.map((kind) => kind.first)), new Set([3, 2, 6, 8]));
});

test('small pages are filled up with invisible lines inside the code block', async () => {
  const world = await createWorld();
  const { panel, right } = await openPanel(world);

  assert.equal(rawLines(panel).length, 6);
  assert.deepEqual(rawLines(panel).slice(2), [INVISIBLE, INVISIBLE, INVISIBLE, INVISIBLE]);
  assert.equal(lines(panel).length, 2);

  const levels = await right(1);
  assert.equal(rawLines(levels).length, 6);
  assert.ok(!rawLines(levels).includes(INVISIBLE));
  assert.equal(body(panel).split('```').length, 3);
});

test('the padding character is invisible but is not whitespace so it is not trimmed away', () => {
  assert.equal(INVISIBLE, '⠀');
  assert.equal(INVISIBLE.trim(), INVISIBLE);
  assert.ok(!/\s/.test(INVISIBLE));
});

test('the list is as tall as the biggest category but never taller than the window', async () => {
  const world = await createWorld();
  const context = createContext(world.app, world.client, { guildId: GUILD });
  const group = (count) => ({ key: `g${count}`, items: Array.from({ length: count }, (_, index) => ({ definition: { key: `k${index}`, type: 'string' }, value: 'v' })) });

  assert.equal(listHeight([group(2), group(5), group(3)]), 5);
  assert.equal(listHeight([group(2)]), 2);
  assert.equal(listHeight([group(2), group(40)]), 9);

  const padded = listBlock(context, group(2).items, 0, 5).split('\n').slice(1, -1);
  assert.equal(padded.length, 5);
  assert.deepEqual(padded.slice(2), [INVISIBLE, INVISIBLE, INVISIBLE]);
  assert.equal(listBlock(context, group(7).items, 0, 5).split('\n').slice(1, -1).length, 7);
});

test('descriptions are filled up to two lines but long ones are left alone', () => {
  assert.equal(padDescription('Short'), `Short\n${INVISIBLE}`);
  assert.equal(padDescription('x'.repeat(55)), `${'x'.repeat(55)}\n${INVISIBLE}`);
  assert.equal(padDescription('x'.repeat(56)), 'x'.repeat(56));
  assert.equal(padDescription('x'.repeat(200)), 'x'.repeat(200));
  assert.equal(padDescription('—'), `—\n${INVISIBLE}`);
});

test('every built in description ends up with two lines in every language', async () => {
  const world = await createWorld();
  const context = createContext(world.app, world.client, { guildId: GUILD });
  for (const code of world.app.i18n.codes) {
    context.lang = code;
    for (const definition of world.app.settings.definitions) {
      const text = world.app.i18n.t(code, `settings.items.${definition.key}`);
      assert.ok(padDescription(text).split('\n').length >= 2 || Array.from(text).length > 55, `${code}:${definition.key}`);
    }
  }
});
