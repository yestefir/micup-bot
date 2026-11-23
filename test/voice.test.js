import test from 'node:test';
import assert from 'node:assert/strict';
import { ChannelType, Permission } from 'micup.ts';
import readyEvent from '../src/events/clientready.js';
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
    return {
      connected: true,
      on() {},
      close: async () => operations.push(['close', current.channel_id]),
    };
  });
  return { ...world, operations, failedRooms, session };
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
