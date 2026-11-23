import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { Permission } from 'micup.ts';
import { DELETE_WINDOWS } from '../src/utils/moderation/ban-session.js';
import { BOT, GUILD, OUTSIDER, actorFor, apiError, body, click, colorOf, createMessage, createWorld, settle, submit } from './support/fakes.js';

const WARNING = 0xfee75c;
const SUCCESS = 0x57f287;
const ERROR = 0xed4245;
const INFO = 0x5865f2;

async function openBan(world, { content = '!ban <@T>', actor = 'A', permissions } = {}) {
  const message = createMessage(world, content, actor, permissions);
  await world.interactions.prefix.handleMessage(message);
  await settle();
  const panel = message.replies[0];
  const sessionId = panel?.components?.[0]?.components?.[0]?.custom_id?.split(':')[1];

  const press = async (action, options) => {
    const interaction = click(`ban:${sessionId}:${action}`, options);
    world.client.emit('interactionCreate', interaction);
    await settle();
    return interaction;
  };
  const send = async (reason, options) => {
    const interaction = submit(`ban:${sessionId}:modal`, reason, options);
    world.client.emit('interactionCreate', interaction);
    await settle();
    return interaction;
  };
  const choose = (seconds) => press('delete', { values: [String(seconds)] });

  return { message, panel, sessionId, press, send, choose };
}

const edited = (message) => message.edits.at(-1);
const fieldValues = (payload) => payload.embeds[0].fields.map((field) => field.value);
const actionsOf = (components) => components.map((component) => component.custom_id.split(':').slice(2).join(':'));

test('the delete windows are the configured ones and never exceed seven days', () => {
  assert.deepEqual(DELETE_WINDOWS, [0, 3600, 21600, 43200, 86400, 259200, 604800]);
  assert.ok(DELETE_WINDOWS.every((seconds) => seconds <= 7 * 24 * 60 * 60));
});

test('ban opens a panel with a delete window menu and a cancel button, and bans nobody yet', async () => {
  const world = await createWorld();
  const { panel } = await openBan(world);

  assert.equal(colorOf(panel), WARNING);
  assert.equal(panel.embeds[0].title, '🔨 Ban');
  assert.equal(body(panel), '<@T> için silinecek mesajların süresini seç. 15 saniye içinde işlem yapılmazsa iptal edilir.');

  const [menuRow, buttonRow] = panel.components.map((row) => row.components);
  assert.equal(menuRow[0].type, 3);
  assert.deepEqual(menuRow[0].options.map((option) => [option.label, option.value]), [
    ['Silme', '0'],
    ['1h', '3600'],
    ['6h', '21600'],
    ['12h', '43200'],
    ['1d', '86400'],
    ['3d', '259200'],
    ['7d', '604800'],
  ]);
  assert.deepEqual(actionsOf(buttonRow), ['cancel']);
  assert.equal(buttonRow[0].label, 'İptal');
  assert.equal(world.calls.ban.length, 0);
  assert.equal(world.client.listenerCount('interactionCreate'), 1);
});

test('choosing a window removes the menu and offers reason, no reason and cancel', async () => {
  const world = await createWorld();
  const { choose } = await openBan(world);

  const update = (await choose(86400)).log.updates[0];

  assert.equal(colorOf(update), WARNING);
  assert.equal(body(update), 'Silinecek mesajlar: **1d**\nSebep ekleyebilir veya sebepsiz devam edebilirsin. 15 saniye içinde işlem yapılmazsa iptal edilir.');
  assert.equal(update.components.length, 1);
  assert.ok(update.components[0].components.every((component) => component.type === 2));
  assert.deepEqual(actionsOf(update.components[0].components), ['reason', 'none', 'cancel']);
  assert.deepEqual(update.components[0].components.map((button) => button.label), ['Sebep gir', 'Sebepsiz', 'İptal']);
  assert.equal(world.calls.ban.length, 0);
});

test('the reason button opens a modal and its answer bans with the reason and the chosen window', async () => {
  const world = await createWorld();
  const { message, choose, press, send, sessionId } = await openBan(world);
  await choose(86400);

  const reasonClick = await press('reason');
  assert.equal(reasonClick.log.modals.length, 1);
  const form = reasonClick.log.modals[0];
  assert.equal(form.custom_id, `ban:${sessionId}:modal`);
  assert.equal(form.title, 'Ban sebebi');
  assert.equal(form.components[0].components[0].style, 2);
  assert.equal(form.components[0].components[0].label, 'Sebep');

  const answer = await send('  spam yapma  ');

  assert.deepEqual(world.calls.ban, [[GUILD, 'T', { reason: 'Ali: spam yapma', delete_message_seconds: 86400 }, { reason: 'Ali: spam yapma' }]]);
  assert.equal(answer.log.deferred, 1);
  assert.equal(answer.log.deleted, 1);
  const done = edited(message);
  assert.equal(colorOf(done), SUCCESS);
  assert.equal(body(done), '<@T> sunucudan yasaklandı.');
  assert.deepEqual(fieldValues(done), ['1d', 'spam yapma', '<@A>']);
  assert.deepEqual(done.embeds[0].fields.map((field) => field.name), ['Silinen mesajlar', 'Sebep', 'Yetkili']);
  assert.deepEqual(done.components, []);
  assert.equal(world.client.listenerCount('interactionCreate'), 0);
});

test('the no reason button bans straight away', async () => {
  const world = await createWorld();
  const { message, choose, press } = await openBan(world);
  await choose(3600);

  const none = await press('none');

  assert.equal(none.log.deferred, 1);
  assert.deepEqual(world.calls.ban, [[GUILD, 'T', { reason: 'Ali: -', delete_message_seconds: 3600 }, { reason: 'Ali: -' }]]);
  const done = edited(message);
  assert.equal(colorOf(done), SUCCESS);
  assert.deepEqual(fieldValues(done), ['1h', 'Belirtilmedi', '<@A>']);
  assert.equal(world.client.listenerCount('interactionCreate'), 0);
});

test('choosing not to delete messages sends no delete window', async () => {
  const world = await createWorld();
  const { message, choose, press } = await openBan(world);
  await choose(0);
  assert.match(body((await press('none')).log.updates[0] ?? edited(message)), /sunucudan yasaklandı/);

  assert.equal('delete_message_seconds' in world.calls.ban[0][2], false);
  assert.deepEqual(fieldValues(edited(message)), ['Silme', 'Belirtilmedi', '<@A>']);
});

test('an empty reason is treated as no reason', async () => {
  const world = await createWorld();
  const { message, choose, send } = await openBan(world);
  await choose(0);
  await send('   ');
  assert.equal(world.calls.ban[0][2].reason, 'Ali: -');
  assert.equal(fieldValues(edited(message))[1], 'Belirtilmedi');
});

test('cancel closes the panel without banning and frees the target', async () => {
  const world = await createWorld();
  const { choose, press } = await openBan(world);
  await choose(3600);

  const cancel = await press('cancel');

  const update = cancel.log.updates[0];
  assert.equal(colorOf(update), INFO);
  assert.equal(body(update), 'Ban iptal edildi.');
  assert.deepEqual(update.components, []);
  assert.equal(world.calls.ban.length, 0);
  assert.equal(world.client.listenerCount('interactionCreate'), 0);

  const again = await openBan(world);
  assert.equal(colorOf(again.panel), WARNING);
});

test('cancel works before a window is chosen too', async () => {
  const world = await createWorld();
  const { press } = await openBan(world);
  const cancel = await press('cancel');
  assert.equal(body(cancel.log.updates[0]), 'Ban iptal edildi.');
  assert.equal(world.calls.ban.length, 0);
});

test('doing nothing for 15 seconds cancels the ban and every action restarts the window', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const world = await createWorld();
    const { message } = await openBan(world);

    mock.timers.tick(14_999);
    await settle();
    assert.equal(message.edits.length, 0);
    mock.timers.tick(1);
    await settle();
    const expired = edited(message);
    assert.equal(body(expired), 'Süre doldu, ban iptal edildi.');
    assert.equal(colorOf(expired), INFO);
    assert.deepEqual(expired.components, []);
    assert.equal(world.calls.ban.length, 0);
    assert.equal(world.client.listenerCount('interactionCreate'), 0);

    const second = await createWorld();
    const panel = await openBan(second);
    mock.timers.tick(10_000);
    await panel.choose(3600);
    mock.timers.tick(10_000);
    await settle();
    assert.equal(panel.message.edits.length, 0);
    mock.timers.tick(5_000);
    await settle();
    assert.equal(body(edited(panel.message)), 'Süre doldu, ban iptal edildi.');
    assert.equal(second.calls.ban.length, 0);
  } finally {
    mock.timers.reset();
  }
});

test('the window follows the ban.sessionSeconds setting', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const world = await createWorld();
    world.app.settings.set(GUILD, 'ban.sessionSeconds', 40);
    const { panel, message } = await openBan(world);
    assert.match(body(panel), /40 saniye/);

    mock.timers.tick(39_999);
    await settle();
    assert.equal(message.edits.length, 0);
    mock.timers.tick(1);
    await settle();
    assert.equal(body(edited(message)), 'Süre doldu, ban iptal edildi.');
  } finally {
    mock.timers.reset();
  }
});

test('the ban session length is validated like the mute one', async () => {
  const world = await createWorld();
  const { settings } = world.app;
  assert.equal(settings.get(GUILD, 'ban.sessionSeconds'), 15);
  assert.equal(settings.set(GUILD, 'ban.sessionSeconds', '30'), 30);
  assert.throws(() => settings.set(GUILD, 'ban.sessionSeconds', '4'), (error) => error.code === 'tooSmall');
  assert.throws(() => settings.set(GUILD, 'ban.sessionSeconds', '121'), (error) => error.code === 'tooLarge');
});

test('only the moderator who started the panel can use it', async () => {
  const world = await createWorld();
  const { choose, press } = await openBan(world);

  const stranger = await press('delete', { user: 'H', values: ['3600'] });
  assert.equal(stranger.log.updates.length, 0);
  assert.equal(stranger.log.replies[0].ephemeral, true);
  assert.equal(body(stranger.log.replies[0]), 'Bu paneli yalnızca komutu başlatan yetkili kullanabilir.');

  const owner = await choose(3600);
  assert.equal(owner.log.updates.length, 1);
  assert.equal(world.calls.ban.length, 0);
});

test('buttons that need a window, stale menu choices and forged values are ignored', async () => {
  const world = await createWorld();
  const { press, choose } = await openBan(world);

  const early = await press('none');
  assert.equal(early.log.deferred, 0);
  assert.equal((await press('reason')).log.modals.length, 0);

  const forged = await press('delete', { values: ['999'] });
  assert.equal(forged.log.updates.length, 0);

  await choose(3600);
  const stale = await choose(604800);
  assert.equal(stale.log.updates.length, 0);
  assert.equal(world.calls.ban.length, 0);

  await press('none');
  assert.equal(world.calls.ban[0][2].delete_message_seconds, 3600);
});

test('interactions from other panels or commands are ignored', async () => {
  const world = await createWorld();
  await openBan(world);

  const other = click('ban:deadbeef:delete', { values: ['3600'] });
  world.client.emit('interactionCreate', other);
  world.client.emit('interactionCreate', { commandName: 'purge' });
  await settle();

  assert.equal(other.log.updates.length, 0);
  assert.equal(world.client.listenerCount('interactionCreate'), 1);
});

test('a second ban panel for the same target is refused until the first one ends', async () => {
  const world = await createWorld();
  const first = await openBan(world);

  const second = createMessage(world, '!ban <@T>', 'A');
  await world.interactions.prefix.handleMessage(second);
  await settle();
  assert.equal(body(second.replies[0]), 'Bu kullanıcı için zaten bir ban işlemi sürüyor.');
  assert.equal(world.client.listenerCount('interactionCreate'), 1);

  await first.choose(0);
  await first.press('none');
  const third = await openBan(world);
  assert.equal(colorOf(third.panel), WARNING);
});

test('different targets can have panels at the same time', async () => {
  const world = await createWorld();
  const one = await openBan(world, { content: '!ban <@T>' });
  const two = await openBan(world, { content: `!ban ${OUTSIDER}` });
  assert.notEqual(one.sessionId, two.sessionId);
  assert.equal(world.client.listenerCount('interactionCreate'), 2);

  await one.choose(3600);
  await two.choose(0);
  await two.press('none');
  assert.equal(world.calls.ban.length, 1);
  assert.equal(world.calls.ban[0][1], OUTSIDER);
});

test('a double click on the final button bans only once', async () => {
  const world = await createWorld();
  const { choose, press } = await openBan(world);
  await choose(0);
  await press('none');
  await press('none');
  assert.equal(world.calls.ban.length, 1);
});

test('protected targets are refused at once and never get a panel', async () => {
  const world = await createWorld();

  const self = createMessage(world, '!ban <@A>', 'A');
  await world.interactions.prefix.handleMessage(self);
  const bot = createMessage(world, `!ban <@${BOT}>`, 'A');
  await world.interactions.prefix.handleMessage(bot);
  const owner = createMessage(world, '!ban <@O>', 'A');
  await world.interactions.prefix.handleMessage(owner);
  const higher = createMessage(world, '!ban <@H>', 'A');
  await world.interactions.prefix.handleMessage(higher);
  const above = createMessage(world, '!ban <@TOP>', 'ADMIN');
  await world.interactions.prefix.handleMessage(above);
  await settle();

  assert.equal(body(self.replies[0]), 'Bu işlemi kendine uygulayamazsın.');
  assert.equal(body(bot.replies[0]), 'Bu işlemi bana uygulayamam.');
  assert.equal(body(owner.replies[0]), 'Sunucu sahibine bu işlem uygulanamaz.');
  assert.equal(body(higher.replies[0]), 'Bu kullanıcının rolü seninkinden yüksek veya eşit.');
  assert.equal(body(above.replies[0]), 'Bu kullanıcının rolü benimkinden yüksek veya eşit.');
  for (const message of [self, bot, owner, higher, above]) {
    assert.equal(colorOf(message.replies[0]), ERROR);
    assert.equal(message.replies[0].components, undefined);
  }
  assert.equal(world.client.listenerCount('interactionCreate'), 0);
  assert.equal(world.calls.ban.length, 0);
});

test('the server owner can open a panel for anyone below the bot but not above it', async () => {
  const world = await createWorld();
  const blocked = await openBan(world, { content: '!ban <@H>', actor: 'O' });
  assert.equal(colorOf(blocked.panel), ERROR);

  const allowed = await openBan(world, { content: '!ban <@T>', actor: 'O' });
  assert.equal(colorOf(allowed.panel), WARNING);
  await allowed.press('delete', { user: 'O', values: ['0'] });
  await allowed.press('none', { user: 'O' });
  assert.equal(world.calls.ban.length, 1);
});

test('other bots can be banned', async () => {
  const world = await createWorld();
  const { message, choose, press } = await openBan(world, { content: '!ban <@OTHERBOT>' });
  await choose(0);
  await press('none');
  assert.equal(world.calls.ban[0][1], 'OTHERBOT');
  assert.equal(colorOf(edited(message)), SUCCESS);
});

test('a user who is not in the server can be banned by id', async () => {
  const world = await createWorld();
  const { message, choose, send } = await openBan(world, { content: `!ban ${OUTSIDER}` });
  await choose(86400);
  await send('reklam');

  assert.deepEqual(world.calls.ban, [[GUILD, OUTSIDER, { reason: 'Ali: reklam', delete_message_seconds: 86400 }, { reason: 'Ali: reklam' }]]);
  assert.equal(body(edited(message)), `<@${OUTSIDER}> sunucudan yasaklandı.`);
});

test('API refusals at the last step become readable errors and release the target', async () => {
  const world = await createWorld();
  world.calls.banError = apiError(403);
  const forbidden = await openBan(world);
  await forbidden.choose(0);
  await forbidden.press('none');
  assert.equal(colorOf(edited(forbidden.message)), ERROR);
  assert.match(body(edited(forbidden.message)), /Micup bu işlemi reddetti/);
  assert.deepEqual(edited(forbidden.message).components, []);
  assert.equal(world.client.listenerCount('interactionCreate'), 0);

  world.calls.banError = apiError(404);
  const missing = await openBan(world);
  await missing.choose(0);
  await missing.press('none');
  assert.equal(body(edited(missing.message)), 'Kullanıcı bulunamadı.');

  world.calls.banError = null;
  const retry = await openBan(world);
  assert.equal(colorOf(retry.panel), WARNING);
});

test('ban needs the ban permission for the member and for the bot', async () => {
  const world = await createWorld();
  const denied = await openBan(world, { permissions: Permission.ModerateMembers });
  assert.equal(body(denied.panel), 'Bu yetkiye sahip olmalısın: Üyeleri Yasakla');
  assert.equal(denied.panel.components, undefined);

  world.client.permissionsFor = () => Permission.ModerateMembers;
  const botDenied = await openBan(world);
  assert.equal(body(botDenied.panel), 'Benim şu yetkiye ihtiyacım var: Üyeleri Yasakla');
  assert.equal(world.client.listenerCount('interactionCreate'), 0);
});

test('ban shows its usage without a target and no longer takes a reason argument', async () => {
  const world = await createWorld();
  const usage = createMessage(world, '!ban', 'A');
  await world.interactions.prefix.handleMessage(usage);
  assert.equal(body(usage.replies[0]), 'Kullanım: !ban <kullanici>');
  assert.equal(colorOf(usage.replies[0]), WARNING);

  const withReason = await openBan(world, { content: '!ban <@T> spam yapma' });
  assert.equal(colorOf(withReason.panel), WARNING);
  assert.equal(world.calls.ban.length, 0);
});

test('every language name opens a ban panel', async () => {
  const world = await createWorld();
  for (const name of ['ban', 'yasakla', 'sperren', 'bannen', 'banear', 'vetar', 'bannir', 'бан', 'забанить']) {
    const opened = await openBan(world, { content: `!${name} <@T>` });
    assert.equal(colorOf(opened.panel), WARNING, name);
    await opened.press('cancel');
  }
});

test('the panel follows the server language', async () => {
  const world = await createWorld();
  world.app.settings.set(GUILD, 'language', 'en-US');
  const { panel, choose } = await openBan(world);
  assert.equal(panel.embeds[0].title, '🔨 Ban');
  assert.match(body(panel), /^Choose how far back to delete <@T>'s messages\./);
  assert.equal(panel.components[0].components[0].options[0].label, "Don't delete");

  const update = (await choose(3600)).log.updates[0];
  assert.match(body(update), /^Messages to delete: \*\*1h\*\*/);
  assert.deepEqual(update.components[0].components.map((button) => button.label), ['Add reason', 'No reason', 'Cancel']);
});

test('slash ban defers publicly, shows the panel by editing the reply and finishes the same way', async () => {
  const world = await createWorld();
  const calls = [];
  const interaction = {
    guildId: GUILD,
    channelId: '200',
    locale: 'ru',
    commandName: 'ban',
    member: actorFor(world, 'A'),
    deferred: false,
    replied: false,
    options: { getUser: () => ({ id: 'T' }) },
    async deferReply(options) {
      this.deferred = true;
      calls.push(['defer', options]);
    },
    async editReply(payload) {
      calls.push(['edit', payload]);
    },
  };

  await world.client.slash.get('ban')(interaction);
  await settle();

  assert.deepEqual(calls[0], ['defer', { ephemeral: false }]);
  const panel = calls[1][1];
  assert.equal(panel.embeds[0].title, '🔨 Бан');
  const sessionId = panel.components[0].components[0].custom_id.split(':')[1];

  world.client.emit('interactionCreate', click(`ban:${sessionId}:delete`, { values: ['86400'] }));
  await settle();
  world.client.emit('interactionCreate', click(`ban:${sessionId}:none`));
  await settle();

  assert.equal(world.calls.ban[0][2].delete_message_seconds, 86400);
  const done = calls.at(-1)[1];
  assert.equal(body(done), '<@T> забанен на сервере.');
  assert.equal(done.embeds[0].title, '✅ Успешно');
  assert.deepEqual(done.components, []);
});

test('a slash ban for a protected user answers with the error instead of a panel', async () => {
  const world = await createWorld();
  const calls = [];
  const interaction = {
    guildId: GUILD,
    channelId: '200',
    locale: 'tr',
    commandName: 'ban',
    member: actorFor(world, 'A'),
    deferred: false,
    replied: false,
    options: { getUser: () => ({ id: 'A' }) },
    async deferReply() {
      this.deferred = true;
    },
    async editReply(payload) {
      calls.push(payload);
    },
  };
  await world.client.slash.get('ban')(interaction);
  assert.equal(body(calls[0]), 'Bu işlemi kendine uygulayamazsın.');
  assert.equal(calls[0].components, undefined);
  assert.equal(world.client.listenerCount('interactionCreate'), 0);
});
