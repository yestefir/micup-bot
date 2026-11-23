import test, { afterEach, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { GUILD, actorFor, apiError, body, click, colorOf, createMessage, createWorld, settle, submit } from './support/fakes.js';

const HOLD_MS = 15000;

beforeEach(() => {
  mock.timers.enable({ apis: ['setTimeout'] });
});

afterEach(() => {
  mock.timers.reset();
});

async function start(world, content = '!mute <@T>', actorId = 'A') {
  const message = createMessage(world, content, actorId);
  await world.interactions.prefix.handleMessage(message);
  await settle();
  const panel = message.replies[0];
  const sessionId = panel?.components?.[0]?.components?.[0]?.custom_id?.split(':')[1];
  return { message, panel, sessionId, id: (action) => `mute:${sessionId}:${action}` };
}

const tick = async (milliseconds) => {
  mock.timers.tick(milliseconds);
  await settle();
};

const lastEdit = (message) => message.edits.at(-1);

test('starting a mute holds the target and shows the duration menu', async () => {
  const world = await createWorld();
  const { panel } = await start(world);

  assert.equal(world.calls.timeout.length, 1);
  assert.deepEqual(world.calls.timeout[0].slice(0, 3), [GUILD, 'T', HOLD_MS]);
  assert.equal(colorOf(panel), 0x5865f2);
  assert.match(body(panel), /için mute süresini seç\. 15 saniye içinde/);

  const [select, buttons] = panel.components;
  assert.equal(select.components[0].options.length, 11);
  assert.deepEqual(select.components[0].options.slice(0, 3).map((option) => option.label), ['1m', '5m', '10m']);
  assert.equal(buttons.components.length, 1);
  assert.equal(world.client.listenerCount('interactionCreate'), 1);
});

test('choosing a duration updates the panel, adds reason buttons and extends the hold', async () => {
  const world = await createWorld();
  const { message, id } = await start(world);

  const choose = click(id('duration'), { values: ['600000'] });
  world.client.emit('interactionCreate', choose);
  await settle();

  const update = choose.log.updates[0];
  assert.match(body(update), /Süre: \*\*10m\*\*/);
  assert.equal(update.components.length, 1);
  assert.ok(update.components[0].components.every((component) => component.type === 2));
  assert.deepEqual(update.components[0].components.map((button) => button.custom_id.split(':')[2]), ['reason', 'none', 'cancel']);
  assert.equal(world.calls.timeout.length, 2);
  assert.equal(world.calls.timeout[1][2], HOLD_MS);
  assert.equal(message.edits.length, 0);
});

test('the menu is gone after a choice and a stale menu interaction changes nothing', async () => {
  const world = await createWorld();
  const { id } = await start(world);
  world.client.emit('interactionCreate', click(id('duration'), { values: ['600000'] }));
  await settle();
  assert.equal(world.calls.timeout.length, 2);

  const stale = click(id('duration'), { values: ['86400000'] });
  world.client.emit('interactionCreate', stale);
  await settle();

  assert.equal(stale.log.updates.length, 0);
  assert.equal(world.calls.timeout.length, 2);

  world.client.emit('interactionCreate', click(id('none')));
  await settle();
  assert.equal(world.calls.timeout.at(-1)[2], 600000);
});

test('the reason button opens a modal and its submit applies the mute with the reason', async () => {
  const world = await createWorld();
  const { message, panel, id } = await start(world);
  world.client.emit('interactionCreate', click(id('duration'), { values: ['600000'] }));
  await settle();

  const reasonClick = click(id('reason'));
  world.client.emit('interactionCreate', reasonClick);
  await settle();
  assert.equal(reasonClick.log.modals.length, 1);
  assert.equal(reasonClick.log.modals[0].custom_id, id('modal'));

  const form = submit(id('modal'), '  spam yapma  ');
  world.client.emit('interactionCreate', form);
  await settle();

  const finalCall = world.calls.timeout.at(-1);
  assert.deepEqual(finalCall, [GUILD, 'T', 600000, { reason: 'Ali: spam yapma', timeoutReason: 'spam yapma' }]);
  assert.equal(form.log.deferred, 1);
  assert.equal(form.log.deleted, 1);

  const done = lastEdit(message);
  assert.equal(colorOf(done), 0x57f287);
  assert.equal(body(done), '<@T> 10m süreyle susturuldu.');
  assert.deepEqual(done.components, []);
  assert.deepEqual(done.embeds[0].fields.map((field) => field.value), ['10m', 'spam yapma', '<@A>']);
  assert.equal(world.client.listenerCount('interactionCreate'), 0);
  assert.equal(world.calls.clearTimeout.length, 0);
  assert.ok(panel);
});

test('an empty reason is treated as no reason', async () => {
  const world = await createWorld();
  const { id } = await start(world);
  world.client.emit('interactionCreate', click(id('duration'), { values: ['300000'] }));
  await settle();
  world.client.emit('interactionCreate', submit(id('modal'), '   '));
  await settle();
  assert.deepEqual(world.calls.timeout.at(-1), [GUILD, 'T', 300000, { reason: 'Ali: -', timeoutReason: undefined }]);
});

test('the no-reason button applies the mute without asking', async () => {
  const world = await createWorld();
  const { message, id } = await start(world);
  world.client.emit('interactionCreate', click(id('duration'), { values: ['3600000'] }));
  await settle();

  const none = click(id('none'));
  world.client.emit('interactionCreate', none);
  await settle();

  assert.equal(none.log.deferred, 1);
  assert.deepEqual(world.calls.timeout.at(-1)[2], 3600000);
  assert.equal(world.calls.timeout.at(-1)[3].reason, 'Ali: -');
  const done = lastEdit(message);
  assert.equal(colorOf(done), 0x57f287);
  assert.equal(done.embeds[0].fields[1].value, 'Belirtilmedi');
  assert.equal(world.client.listenerCount('interactionCreate'), 0);
});

test('cancelling lifts the hold and closes the panel', async () => {
  const world = await createWorld();
  const { id } = await start(world);

  const cancel = click(id('cancel'));
  world.client.emit('interactionCreate', cancel);
  await settle();

  assert.equal(world.calls.clearTimeout.length, 1);
  assert.deepEqual(world.calls.clearTimeout[0].slice(0, 2), [GUILD, 'T']);
  const update = cancel.log.updates[0];
  assert.equal(colorOf(update), 0xfee75c);
  assert.equal(body(update), 'Mute iptal edildi.');
  assert.deepEqual(update.components, []);
  assert.equal(world.client.listenerCount('interactionCreate'), 0);

  await tick(60000);
  assert.equal(world.calls.clearTimeout.length, 1);
});

test('doing nothing for 15 seconds cancels and lifts the hold', async () => {
  const world = await createWorld();
  const { message } = await start(world);

  await tick(14999);
  assert.equal(world.calls.clearTimeout.length, 0);
  assert.equal(message.edits.length, 0);

  await tick(1);
  assert.equal(world.calls.clearTimeout.length, 1);
  const edit = lastEdit(message);
  assert.equal(body(edit), 'Süre doldu, mute iptal edildi.');
  assert.equal(colorOf(edit), 0xfee75c);
  assert.deepEqual(edit.components, []);
  assert.equal(world.client.listenerCount('interactionCreate'), 0);
});

test('every interaction restarts the 15 second window', async () => {
  const world = await createWorld();
  const { message, id } = await start(world);

  await tick(10000);
  world.client.emit('interactionCreate', click(id('duration'), { values: ['600000'] }));
  await settle();

  await tick(10000);
  assert.equal(message.edits.length, 0);
  assert.equal(world.calls.clearTimeout.length, 0);

  await tick(5000);
  assert.equal(world.calls.clearTimeout.length, 1);
  assert.equal(body(lastEdit(message)), 'Süre doldu, mute iptal edildi.');
});

test('the window length follows the mute.sessionSeconds setting', async () => {
  const world = await createWorld();
  world.app.settings.set(GUILD, 'mute.sessionSeconds', 30);
  const { message } = await start(world);
  assert.equal(world.calls.timeout[0][2], 30000);
  assert.match(body((await message.replies[0])), /30 saniye/);

  await tick(29999);
  assert.equal(world.calls.clearTimeout.length, 0);
  await tick(1);
  assert.equal(world.calls.clearTimeout.length, 1);
});

test('only the moderator who started the panel can use it', async () => {
  const world = await createWorld();
  const { message, id } = await start(world);

  const stranger = click(id('duration'), { user: 'H', values: ['600000'] });
  world.client.emit('interactionCreate', stranger);
  await settle();

  assert.equal(stranger.log.updates.length, 0);
  assert.equal(stranger.log.replies[0].ephemeral, true);
  assert.match(body(stranger.log.replies[0]), /yalnızca komutu başlatan yetkili/);
  assert.equal(world.calls.timeout.length, 1);

  await tick(15000);
  assert.equal(world.calls.clearTimeout.length, 1);
  assert.ok(message);
});

test('buttons that need a duration are ignored before one is chosen', async () => {
  const world = await createWorld();
  const { id } = await start(world);

  const none = click(id('none'));
  world.client.emit('interactionCreate', none);
  await settle();

  assert.equal(none.log.deferred, 0);
  assert.equal(world.calls.timeout.length, 1);
  assert.equal(world.client.listenerCount('interactionCreate'), 1);
});

test('unknown duration values are ignored', async () => {
  const world = await createWorld();
  const { id } = await start(world);

  const forged = click(id('duration'), { values: ['999'] });
  world.client.emit('interactionCreate', forged);
  await settle();

  assert.equal(forged.log.updates.length, 0);
  assert.equal(world.calls.timeout.length, 1);
});

test('interactions from other panels or commands are ignored', async () => {
  const world = await createWorld();
  await start(world);

  const other = click('mute:deadbeef:duration', { values: ['600000'] });
  world.client.emit('interactionCreate', other);
  world.client.emit('interactionCreate', { commandName: 'purge' });
  await settle();

  assert.equal(other.log.updates.length, 0);
  assert.equal(world.client.listenerCount('interactionCreate'), 1);
});

test('a second mute for the same target is refused while one is running', async () => {
  const world = await createWorld();
  await start(world);

  const second = createMessage(world, '!mute <@T>', 'A');
  await world.interactions.prefix.handleMessage(second);
  await settle();

  assert.equal(body(second.replies[0]), 'Bu kullanıcı için zaten bir mute işlemi sürüyor.');
  assert.equal(world.calls.timeout.length, 1);
  assert.equal(world.client.listenerCount('interactionCreate'), 1);

  await tick(15000);
  const third = createMessage(world, '!mute <@T>', 'A');
  await world.interactions.prefix.handleMessage(third);
  await settle();
  assert.match(body(third.replies[0]), /için mute süresini seç/);
});

test('a user who is already muted is not touched', async () => {
  const world = await createWorld();
  world.members.T.communication_disabled_until = new Date(Date.now() + 3600000).toISOString();
  const { message } = await start(world);

  assert.equal(body(message.replies[0]), 'Bu kullanıcı zaten susturulmuş.');
  assert.equal(colorOf(message.replies[0]), 0xed4245);
  assert.equal(world.calls.timeout.length, 0);
  assert.equal(world.client.listenerCount('interactionCreate'), 0);
});

test('bots cannot be muted and nothing is held', async () => {
  const world = await createWorld();
  const { message } = await start(world, '!mute <@OTHERBOT>');

  assert.equal(body(message.replies[0]), 'Botlara mute uygulanamaz.');
  assert.equal(colorOf(message.replies[0]), 0xed4245);
  assert.equal(message.replies[0].components, undefined);
  assert.equal(world.calls.timeout.length, 0);
  assert.equal(world.client.listenerCount('interactionCreate'), 0);
});

test('the bot check follows the member, not the id, and humans are unaffected', async () => {
  const world = await createWorld();
  world.members.T.user = { bot: false };
  const { panel } = await start(world);
  assert.match(body(panel), /için mute süresini seç/);
});

test('an expired earlier mute does not block a new one', async () => {
  const world = await createWorld();
  world.members.T.communication_disabled_until = new Date(Date.now() - 1000).toISOString();
  const { panel } = await start(world);
  assert.match(body(panel), /için mute süresini seç/);
});

test('hierarchy and membership are checked before anything is held', async () => {
  const world = await createWorld();
  const higher = await start(world, '!mute <@H>');
  assert.equal(body(higher.message.replies[0]), 'Bu kullanıcının rolü seninkinden yüksek veya eşit.');
  const self = await start(world, '!mute <@A>');
  assert.equal(body(self.message.replies[0]), 'Bu işlemi kendine uygulayamazsın.');
  const outsider = await start(world, '!mute 123456789');
  assert.equal(body(outsider.message.replies[0]), 'Bu kullanıcı sunucuda değil.');
  assert.equal(world.calls.timeout.length, 0);
});

test('a failing final mute reports the error and lifts the hold', async () => {
  const world = await createWorld();
  const { message, id } = await start(world);
  world.client.emit('interactionCreate', click(id('duration'), { values: ['600000'] }));
  await settle();

  world.client.rest.guilds.timeout = async () => {
    throw apiError(403);
  };
  world.client.emit('interactionCreate', click(id('none')));
  await settle();

  const edit = lastEdit(message);
  assert.equal(colorOf(edit), 0xed4245);
  assert.match(body(edit), /Micup bu işlemi reddetti/);
  assert.equal(world.calls.clearTimeout.length, 1);
});

test('the mute command shows usage without a target', async () => {
  const world = await createWorld();
  const { message } = await start(world, '!mute');
  assert.match(body(message.replies[0]), /Kullanım: !mute <kullanici>/);
  assert.equal(colorOf(message.replies[0]), 0xfee75c);
  assert.equal(world.calls.timeout.length, 0);
});

test('slash mute defers, shows the panel by editing the reply and runs the same flow', async () => {
  const world = await createWorld();
  const edits = [];
  const interaction = {
    guildId: GUILD,
    channelId: '200',
    locale: 'en-US',
    commandName: 'mute',
    member: actorFor(world, 'A'),
    deferred: false,
    replied: false,
    options: { getUser: () => ({ id: 'T' }) },
    async deferReply(options) {
      this.deferred = true;
      edits.push(['defer', options]);
    },
    async editReply(payload) {
      edits.push(['edit', payload]);
    },
  };
  await world.client.slash.get('mute')(interaction);
  await settle();

  assert.deepEqual(edits[0], ['defer', { ephemeral: false }]);
  const panel = edits[1][1];
  assert.match(body(panel), /Choose how long to mute <@T>/);
  const sessionId = panel.components[0].components[0].custom_id.split(':')[1];

  world.client.emit('interactionCreate', click(`mute:${sessionId}:duration`, { values: ['86400000'] }));
  await settle();
  world.client.emit('interactionCreate', click(`mute:${sessionId}:none`));
  await settle();

  assert.equal(world.calls.timeout.at(-1)[2], 86400000);
  const done = edits.at(-1)[1];
  assert.equal(body(done), '<@T> was muted for 1d.');
  assert.equal(done.embeds[0].title, '✅ Success');
});
