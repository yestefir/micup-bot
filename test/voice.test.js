import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { ChannelType, Permission } from 'micup.ts';
import readyEvent from '../src/events/clientready.js';
import voiceStateUpdate from '../src/events/voicestateupdate.js';
import { VoiceChannels } from '../src/utils/voice/channels.js';
import { GUILD, body, createWorld, settle } from './support/fakes.js';
import { controls, openPanel, valueOf } from './support/panel.js';

const FIRST = '10001';
const SECOND = '10002';
const TEXT = '10003';
const KEY = 'voice.channel';

async function voiceWorld() {
  const world = await createWorld();
  const { app, client } = world;
  const operations = [];
  const rooms = [];
  const failedRooms = new Set();
  let grant;
  const session = {
    ready: true,
    voice: () => grant,
    joinVoice: async (guildId, channelId, options) => {
      operations.push(['join', guildId, channelId, options]);
      grant = { channel_id: channelId, connection_id: 'connection-' + channelId };
      return grant;
    },
    leaveVoice: async (guildId, connectionId) => {
      operations.push(['leave', guildId, connectionId]);
      if (grant?.connection_id === connectionId) grant = undefined;
    },
  };
  client.sessionFor = () => session;
  client.channels = {
    get: (id) => ({ id, guildId: GUILD, type: id === TEXT ? ChannelType.GuildText : ChannelType.GuildVoice }),
  };
  app.voiceChannels = new VoiceChannels(app, async (current, options) => {
    operations.push(['connect', current.channel_id, options]);
    if (failedRooms.has(current.channel_id)) throw new Error('Voice transport unavailable');
    const room = Object.assign(new EventEmitter(), {
      connected: true,
      close: async () => {
        room.connected = false;
        operations.push(['close', current.channel_id]);
      },
    });
    rooms.push(room);
    return room;
  });
  return { ...world, operations, rooms, failedRooms, session, loseGrant: () => { grant = undefined; } };
}

test('the administrator can select, move and reset the silent voice channel from the settings panel', async () => {
  const world = await voiceWorld();
  const panel = await openPanel(world);
  const voicePage = await panel.left(1);
  assert.match(body(voicePage), /\*\*Ses\*\*/);
  assert.deepEqual(controls(voicePage)[1][0].channel_types, [ChannelType.GuildVoice]);
  const denied = await panel.press('channel', { user: 'T', values: [FIRST] });
  assert.equal(denied.log.replies.length, 1);
  assert.equal(world.operations.length, 0);

  const selected = await panel.press('channel', { values: [FIRST] });
  assert.equal(selected.log.deferred, 1);
  assert.equal(valueOf(world, KEY), FIRST);
  assert.deepEqual(world.operations, [
    ['join', GUILD, FIRST, { selfMute: true, selfDeaf: true }],
    ['connect', FIRST, { publishOnConnect: false }],
  ]);
  assert.deepEqual(controls(panel.message.edits.at(-1))[1][0].default_values, [{ id: FIRST, type: 'channel' }]);

  await panel.press('channel', { values: [SECOND] });
  assert.equal(valueOf(world, KEY), SECOND);
  assert.deepEqual(world.operations.slice(2).map(([action]) => action), ['leave', 'close', 'join', 'connect']);

  await panel.press('reset');
  assert.equal(valueOf(world, KEY), null);
  assert.deepEqual(world.operations.slice(-2), [['leave', GUILD, 'connection-' + SECOND], ['close', SECOND]]);
});

test('text channels and missing permissions are rejected without altering the voice selection', async () => {
  const world = await voiceWorld();
  const panel = await openPanel(world);
  await panel.left(1);
  const invalid = await panel.press('channel', { values: [TEXT] });
  assert.match(body(invalid.log.replies[0]), /ses kanalı seç/);
  world.client.permissionsFor = () => Permission.ViewChannel;
  const denied = await panel.press('channel', { values: [FIRST] });
  assert.match(body(denied.log.replies[0]), /kanala bağlanma izinleri/);
  assert.equal(valueOf(world, KEY), null);
  assert.equal(world.operations.length, 0);
});

test('startup restores the saved channel and a failed move returns to the previous channel', async () => {
  const { app, client, operations, failedRooms, session } = await voiceWorld();
  app.settings.set(GUILD, KEY, FIRST);
  await readyEvent.execute(client, client);
  await settle();
  assert.equal(session.voice().channel_id, FIRST);
  await app.voiceChannels.restoreConfigured(client);
  assert.deepEqual(operations.map(([action]) => action), ['join', 'connect']);

  failedRooms.add(SECOND);
  await assert.rejects(app.voiceChannels.change(client, GUILD, SECOND), /Voice transport unavailable/);
  assert.equal(app.settings.get(GUILD, KEY), FIRST);
  assert.equal(session.voice().channel_id, FIRST);
  assert.deepEqual(operations.slice(2).map(([action]) => action), [
    'leave', 'close', 'join', 'connect', 'leave', 'join', 'connect',
  ]);

  await app.voiceChannels.close();
  assert.equal(session.voice(), undefined);
  assert.equal(app.settings.get(GUILD, KEY), FIRST);
});

test('a dropped room rejoins the saved channel and retries a temporary connection failure', async ({ mock }) => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const { app, client, operations, rooms, failedRooms, session } = await voiceWorld();
  await app.voiceChannels.change(client, GUILD, FIRST);

  failedRooms.add(FIRST);
  rooms[0].connected = false;
  rooms[0].emit('disconnected');
  rooms[0].emit('disconnected');
  mock.timers.tick(2_000);
  await settle();
  assert.equal(operations.filter(([action]) => action === 'join').length, 2);
  assert.equal(session.voice(), undefined);

  failedRooms.delete(FIRST);
  mock.timers.tick(3_999);
  await settle();
  assert.equal(session.voice(), undefined);
  mock.timers.tick(1);
  await settle();
  assert.equal(session.voice().channel_id, FIRST);
  assert.equal(operations.filter(([action]) => action === 'join').length, 3);
  await app.voiceChannels.close();
});

test('a gateway disconnect triggers recovery, and clearing the setting cancels recovery', async ({ mock }) => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const { app, client, operations, rooms, session, loseGrant } = await voiceWorld();
  const state = { guild_id: GUILD, user_id: client.user.id, channel_id: null };
  const joins = () => operations.filter(([action]) => action === 'join').length;
  await app.voiceChannels.change(client, GUILD, FIRST);

  loseGrant();
  voiceStateUpdate.execute({ ...state, user_id: 'T' }, client);
  mock.timers.tick(2_000);
  await settle();
  assert.equal(joins(), 1);

  voiceStateUpdate.execute(state, client);
  mock.timers.tick(2_000);
  await settle();
  assert.equal(session.voice().channel_id, FIRST);
  assert.equal(joins(), 2);

  voiceStateUpdate.execute(state, client);
  await app.voiceChannels.change(client, GUILD, null);
  rooms.at(-1).emit('disconnected');
  mock.timers.tick(60_000);
  await settle();
  assert.equal(app.settings.get(GUILD, KEY), null);
  assert.equal(session.voice(), undefined);
  assert.equal(joins(), 2);
  await app.voiceChannels.close();
});
