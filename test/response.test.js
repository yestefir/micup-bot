import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { createContext } from '../src/core/interaction/src/context.js';
import { TYPES, createEmbed } from '../src/utils/message/embed.js';
import { attachResponder, interactionTarget, messageTarget } from '../src/utils/message/response.js';

const app = createApp({ databasePath: ':memory:' });

test('each type has its own color', () => {
  const colors = TYPES.map((type) => createEmbed({ type, description: 'x' }).color);
  assert.equal(new Set(colors).size, TYPES.length);
  assert.deepEqual(colors, [0x57f287, 0xed4245, 0xfee75c, 0x5865f2]);
});

test('unknown embed types are rejected', () => {
  assert.throws(() => createEmbed({ type: 'nope' }));
});

test('title is localized per language and can be turned off', async () => {
  const sent = [];
  const message = { reply: async (payload) => (sent.push(payload), { delete: async () => {} }), channel: {} };
  const context = createContext(app, {}, { guildId: 'g' });
  attachResponder(context, messageTarget(message));

  await context.success('ok');
  context.lang = 'de';
  await context.error('fail');
  context.lang = 'en-US';
  await context.warning('careful', { title: false });
  await context.info('fyi', { title: 'Custom' });

  assert.deepEqual(
    sent.map((payload) => payload.embeds[0].title),
    ['✅ Başarılı', '❌ Fehler', undefined, 'Custom'],
  );
});

test('prefix errors delete themselves, successes stay', async () => {
  const timers = [];
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms) => {
    timers.push(ms);
    return { unref() {} };
  };
  try {
    const message = { reply: async () => ({ delete: async () => {} }), channel: {} };
    const context = createContext(app, {}, { guildId: 'g' });
    attachResponder(context, messageTarget(message));
    await context.success('ok');
    await context.error('fail');
    await context.warning('careful');
    await context.info('fyi');
    await context.success('temporary', { ttl: 1234 });
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
  assert.deepEqual(timers, [5000, 5000, 1234]);
});

test('reply false sends to the channel instead of replying', async () => {
  const calls = [];
  const message = {
    reply: async () => calls.push('reply'),
    channel: { send: async () => (calls.push('send'), { delete: async () => {} }) },
  };
  const context = createContext(app, {}, { guildId: 'g' });
  attachResponder(context, messageTarget(message));
  await context.info('a');
  await context.info('b', { reply: false });
  assert.deepEqual(calls, ['reply', 'send']);
});

test('falls back to the channel when the original message cannot be replied to', async () => {
  const calls = [];
  const message = {
    reply: async () => {
      throw new Error('Unknown message');
    },
    channel: { send: async () => (calls.push('send'), { delete: async () => {} }) },
  };
  const context = createContext(app, {}, { guildId: 'g' });
  attachResponder(context, messageTarget(message));
  await context.error('lost');
  assert.deepEqual(calls, ['send']);
});

test('interaction target replies, edits after defer, and follows up after reply', async () => {
  const calls = [];
  const interaction = {
    deferred: false,
    replied: false,
    reply: async (payload) => calls.push(['reply', payload.ephemeral]),
    editReply: async () => calls.push(['edit']),
    followUp: async (payload) => calls.push(['followUp', payload.ephemeral]),
  };
  const context = createContext(app, {}, { guildId: 'g' });
  attachResponder(context, interactionTarget(interaction));

  await context.success('a');
  await context.success('b', { ephemeral: false });
  interaction.replied = true;
  await context.error('c');
  interaction.deferred = true;
  await context.info('d');

  assert.deepEqual(calls, [['reply', true], ['reply', false], ['followUp', true], ['edit']]);
});

const png = Buffer.from('png');

test('sendImage replies with the file, named and described', async () => {
  const sent = [];
  const message = { reply: async (payload) => (sent.push(payload), { delete: async () => {} }), channel: {} };
  const context = createContext(app, {}, { guildId: 'g' });
  attachResponder(context, messageTarget(message));

  await context.sendImage(png, { alt: 'Level 3' });
  await context.sendImage(png, { name: 'other.png' });

  assert.equal(sent[0].files.length, 1);
  assert.equal(sent[0].files[0].name, 'card.png');
  assert.equal(sent[0].files[0].description, 'Level 3');
  assert.equal(sent[0].files[0].data.type, 'image/png');
  assert.equal(sent[0].files[0].data.size, 3);
  assert.equal(sent[1].files[0].name, 'other.png');
  assert.equal('description' in sent[1].files[0], false);
});

test('sendImage can post to the channel, falls back when the reply fails and honours ttl', async () => {
  const calls = [];
  const timers = [];
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms) => (timers.push(ms), { unref() {} });
  try {
    const message = {
      reply: async () => {
        throw new Error('Unknown message');
      },
      channel: { send: async () => (calls.push('send'), { delete: async () => {} }) },
    };
    const context = createContext(app, {}, { guildId: 'g' });
    attachResponder(context, messageTarget(message));

    await context.sendImage(png);
    await context.sendImage(png, { reply: false, ttl: 2500 });
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
  assert.deepEqual(calls, ['send', 'send']);
  assert.deepEqual(timers, [2500]);
});

function fakeInteraction(overrides = {}) {
  const calls = [];
  const interaction = {
    deferred: false,
    replied: false,
    async deferReply(options) {
      this.deferred = true;
      calls.push(['defer', options]);
    },
    async followUp(payload) {
      calls.push(['followUp', payload]);
      return { id: 'm' };
    },
    async deleteReply() {
      calls.push(['delete']);
    },
    async editReply(payload) {
      calls.push(['edit', payload]);
    },
    ...overrides,
  };
  return { interaction, calls };
}

test('interaction sendImage acknowledges, follows up with the file and removes the placeholder', async () => {
  const { interaction, calls } = fakeInteraction();
  const context = createContext(app, {}, { guildId: 'g' });
  attachResponder(context, interactionTarget(interaction));

  await context.sendImage(png, { alt: 'Level 3' });

  assert.deepEqual(calls.map(([kind]) => kind), ['defer', 'followUp', 'delete']);
  assert.deepEqual(calls[0][1], { ephemeral: false });
  assert.equal(calls[1][1].ephemeral, false);
  assert.equal(calls[1][1].files[0].description, 'Level 3');
});

test('interaction sendImage reuses an existing deferral and edits the placeholder when it cannot be deleted', async () => {
  const { interaction, calls } = fakeInteraction({
    deferred: true,
    async deleteReply() {
      throw new Error('cannot delete');
    },
  });
  const context = createContext(app, {}, { guildId: 'g' });
  attachResponder(context, interactionTarget(interaction));

  await context.sendImage(png, { alt: 'Level 3' });

  assert.deepEqual(calls.map(([kind]) => kind), ['followUp', 'edit']);
  assert.equal(calls[1][1], 'Level 3');
});

test('interaction sendImage after a normal reply only follows up', async () => {
  const { interaction, calls } = fakeInteraction({ replied: true });
  const context = createContext(app, {}, { guildId: 'g' });
  attachResponder(context, interactionTarget(interaction));

  await context.sendImage(png);

  assert.deepEqual(calls.map(([kind]) => kind), ['followUp']);
});
