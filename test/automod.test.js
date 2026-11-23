import test from 'node:test';
import assert from 'node:assert/strict';
import { Permission } from 'micup.ts';
import messageCreate from '../src/events/messagecreate.js';
import messageUpdate from '../src/events/messageupdate.js';
import { moderateMessage } from '../src/utils/moderation/automod.js';
import { GUILD, body, createMessage, createWorld as createTestWorld } from './support/fakes.js';
import { controls, field, openPanel, valueOf } from './support/panel.js';

async function createWorld() {
  const world = await createTestWorld();
  world.client.permissionsFor = (_guildId, userId) => userId === 'T' ? Permission.SendMessages : Permission.All;
  return world;
}

function messageFor(world, content, channelId = '12345') {
  const message = createMessage(world, content, 'T');
  message.channelId = channelId;
  const calls = [];
  message.delete = async () => calls.push('delete');
  message.channel.send = async (payload) => {
    calls.push(body(payload));
    return { delete: async () => calls.push('delete warning') };
  };
  return { message, calls };
}

test('external ads are checked across the message and exempt channels only skip external ads', async () => {
  const world = await createWorld();
  for (const text of ['https://klipy.com/gif', 'www.klipy.com/gif', 'settings.js dosyasına bak']) {
    const { message } = messageFor(world, text);
    assert.equal(await moderateMessage(message, world.client, { edited: true }), false, text);
  }
  for (const text of ['klipy.com.example.org', 'https://klipy.com/gif ve https://example.org']) {
    const { message, calls } = messageFor(world, text);
    assert.equal(await moderateMessage(message, world.client, { edited: true }), true, text);
    assert.match(calls[1], /reklam bağlantısı/);
  }

  world.app.settings.set(GUILD, 'automod.adExemptChannels', ['12345']);
  const { message } = messageFor(world, 'örnek https://example.org');
  assert.equal(await moderateMessage(message, world.client, { edited: true }), false);
  const other = messageFor(world, message.content, '67890');
  assert.equal(await moderateMessage(other.message, world.client, { edited: true }), true);
});

test('Micup media links require Attach Files in the message channel and the warning expires', async ({ mock }) => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const world = await createWorld();
  world.app.settings.set(GUILD, 'automod.adExemptChannels', ['67890']);
  const permissionCalls = [];
  world.client.permissionsFor = (...args) => {
    permissionCalls.push(args);
    return args[2] === '12345' ? Permission.AttachFiles : Permission.SendMessages;
  };
  const { message } = messageFor(world, 'media.micup.gg/picture.png');
  assert.equal(await moderateMessage(message, world.client), false);

  const blocked = messageFor(world, 'https://media.micup.gg/picture.png', '67890');
  blocked.message.member = undefined;
  assert.equal(await moderateMessage(blocked.message, world.client), true);
  assert.deepEqual(permissionCalls, [[GUILD, 'T', '12345'], [GUILD, 'T', '67890']]);
  assert.deepEqual(blocked.calls, ['delete', '<@T> Bu kanalda görsel yükleme iznin yok.']);
  mock.timers.tick(4999);
  assert.equal(blocked.calls.length, 2);
  mock.timers.tick(1);
  assert.equal(blocked.calls.at(-1), 'delete warning');
});

test('the settings panel saves channel exemptions and lets an administrator replace and clear the profanity list', async () => {
  const world = await createWorld();
  const panel = await openPanel(world);
  const category = await panel.left(2);
  const [[select]] = controls(category).slice(1);
  assert.equal(select.type, 8);
  assert.equal(select.max_values, 25);
  assert.equal(select.placeholder, 'Reklama izin verilen kanalları seç');
  const channels = ['12345', '67890'];
  const changed = await panel.press('channels', { values: channels });
  assert.deepEqual(valueOf(world, 'automod.adExemptChannels'), channels);
  assert.deepEqual(controls(changed.log.updates[0])[1][0].default_values, channels.map((id) => ({ id, type: 'channel' })));
  assert.match(body(changed.log.updates[0]), /Kanal: 2/);

  await panel.down(1);
  const denied = await panel.send('automod.profanityWords', 'başka', { user: 'T' });
  assert.equal(denied.log.replies.length, 1);
  await panel.send('automod.profanityWords', 'yasak ifade, örnek');
  for (const [text, blocked] of [['Bu YASAK İFADE gider.', true], ['örnekler güzel', false], ['nice pic you got', false]]) {
    const { message } = messageFor(world, text);
    assert.equal(await moderateMessage(message, world.client, { edited: true }), blocked, text);
  }
  await panel.send('automod.profanityWords', '');
  assert.equal(valueOf(world, 'automod.profanityWords'), '');
  const { message } = messageFor(world, 'yasak ifade');
  assert.equal(await moderateMessage(message, world.client, { edited: true }), false);
});

test('caps and profanity block normal processing, including edits, while short acronyms pass', async () => {
  const world = await createWorld();
  const processed = [];
  world.client.interactions = { prefix: { handleMessage: async (message) => processed.push(message.content) } };
  const acronym = messageFor(world, 'GG WP');
  await messageCreate.execute(acronym.message, world.client);
  assert.deepEqual(processed, ['GG WP']);
  const caps = messageFor(world, 'BÜTÜN MESAJ BÜYÜK HARF');
  await messageCreate.execute(caps.message, world.client);
  assert.match(caps.calls[1], /büyük harf/);
  assert.deepEqual(processed, ['GG WP']);
  const edited = messageFor(world, 'Siktir.');
  await messageUpdate.execute({ guildId: GUILD, content: edited.message.content, message: edited.message }, world.client);
  assert.match(edited.calls[1], /küfür/);
  assert.equal(world.app.levels.get(GUILD, 'T').messages, 1);
});

test('spam counts repeats and bursts per author and channel and throttles repeated spam warnings', async () => {
  const world = await createWorld();
  for (const [index, content] of ['aynı mesaj', 'ayrı mesaj', ' AYNI   MESAJ ', 'aynı mesaj', 'aynı mesaj'].entries()) {
    const { message, calls } = messageFor(world, content);
    assert.equal(await moderateMessage(message, world.client, { now: index * 1000 }), index >= 3);
    assert.equal(calls.length, index === 3 ? 2 : index === 4 ? 1 : 0);
  }
  for (let index = 0; index < 6; index += 1) {
    const { message } = messageFor(world, 'farklı mesaj ' + index, '67890');
    assert.equal(await moderateMessage(message, world.client, { now: index * 200 }), index === 5);
  }
  const { message } = messageFor(world, 'aynı mesaj');
  assert.equal(await moderateMessage(message, world.client, { now: 15_000 }), false);
});

test('message managers and higher permissions bypass automod on new and edited messages', async () => {
  const world = await createWorld();
  const processed = [];
  world.client.interactions = { prefix: { handleMessage: async (message) => processed.push(message.content) } };
  world.app.settings.set(GUILD, 'automod.profanityWords', 'yasak ifade');
  const contents = ['yasak ifade', 'https://example.org', 'media.micup.gg/picture.png', 'BÜTÜN MESAJ BÜYÜK HARF'];

  for (const permissions of [Permission.ManageMessages, Permission.ManageGuild, Permission.Administrator, Permission.All]) {
    world.client.permissionsFor = (_guildId, _userId, channelId) => channelId === '12345' ? permissions : undefined;
    for (const content of contents) {
      const { message, calls } = messageFor(world, content);
      await messageCreate.execute(message, world.client);
      await messageUpdate.execute({ guildId: GUILD, content, message }, world.client);
      assert.deepEqual(calls, []);
    }
  }

  assert.deepEqual(processed, Array(4).fill(contents).flat());
  assert.equal(world.app.automodHistory.size, 0);

  const { message, calls } = messageFor(world, 'https://example.org', '67890');
  await messageCreate.execute(message, world.client);
  assert.equal(calls[0], 'delete');
  assert.match(calls[1], /reklam bağlantısı/);
});

test('the settings panel saves and clears roles exempt from all automod filters', async () => {
  const world = await createWorld();
  const panel = await openPanel(world, { permissions: Permission.ManageGuild });
  await panel.left(2);
  const view = await panel.down(2);
  assert.equal(field(view, 0).name, 'automod.exemptRoles');
  assert.equal(controls(view)[1][0].type, 6);
  assert.equal(controls(view)[1][0].max_values, 25);

  const roles = ['111111', '222222'];
  const denied = await panel.press('roles', { values: roles, user: 'T' });
  assert.equal(denied.log.replies.length, 1);
  assert.deepEqual(valueOf(world, 'automod.exemptRoles'), []);

  const saved = await panel.press('roles', { values: roles });
  assert.deepEqual(valueOf(world, 'automod.exemptRoles'), roles);
  assert.deepEqual(controls(saved.log.updates[0])[1][0].default_values, roles.map((id) => ({ id, type: 'role' })));
  assert.deepEqual(world.app.settings.get('other-guild', 'automod.exemptRoles'), []);

  world.members.T.roles = ['333333', '222222'];
  for (const content of ['Siktir.', 'BÜTÜN MESAJ BÜYÜK HARF', 'https://example.org', 'media.micup.gg/picture.png']) {
    const { message, calls } = messageFor(world, content);
    assert.equal(await moderateMessage(message, world.client), false);
    await messageUpdate.execute({ guildId: GUILD, content, message }, world.client);
    assert.deepEqual(calls, []);
  }
  assert.equal(world.app.automodHistory.size, 0);

  await panel.press('reset');
  assert.deepEqual(valueOf(world, 'automod.exemptRoles'), []);
  const { message, calls } = messageFor(world, 'https://example.org');
  assert.equal(await moderateMessage(message, world.client), true);
  assert.equal(calls[0], 'delete');
});

test('automod checks cached and fetched roles when an edited message has no member', async () => {
  const world = await createWorld();
  world.app.settings.set(GUILD, 'automod.exemptRoles', ['111111']);
  const { message, calls } = messageFor(world, 'https://example.org');
  message.member = undefined;
  const update = { guildId: GUILD, content: message.content, fetch: async () => message };
  let cachedMember = { roles: ['111111'] };
  world.client.sessionFor = () => ({ state: { member: () => cachedMember } });

  const fetches = [];
  const fetchMember = world.client.rest.guilds.member;
  world.client.rest.guilds.member = (...args) => {
    fetches.push(args);
    return fetchMember(...args);
  };
  await messageUpdate.execute(update, world.client);
  assert.deepEqual(calls, []);
  assert.deepEqual(fetches, []);

  cachedMember = undefined;
  world.members.T.roles = ['111111'];
  await messageUpdate.execute(update, world.client);
  assert.deepEqual(calls, []);
  assert.deepEqual(fetches, [[GUILD, 'T']]);

  world.members.T.roles = ['222222'];
  await messageUpdate.execute(update, world.client);
  assert.equal(calls[0], 'delete');
});
