import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from 'micup.ts/easy';
import { createApp } from '../src/app.js';
import { Interactions } from '../src/core/interaction/core.js';

const GUILD = '100000000000000001';
const PNG_SIGNATURE = '89504e470d0a1a0a';

const rawMessage = { id: '2000000000000000001', channel_id: '200000000000000001', content: '', author: { id: '9', username: 'bot' } };

async function realClient() {
  const app = createApp({ databasePath: ':memory:' });
  const warnings = [];
  app.logger = { info() {}, warn: (message) => warnings.push(message), error: (...args) => console.error('[test logger]', ...args) };

  const calls = [];
  const rest = {
    interactions: {
      respond: async (raw, message, options) => {
        calls.push({ kind: 'respond', message, options });
      },
      defer: async (raw, options) => {
        calls.push({ kind: 'defer', options });
      },
      editResponse: async (raw, message) => {
        calls.push({ kind: 'edit', message });
        return rawMessage;
      },
      followUp: async (raw, message, options) => {
        calls.push({ kind: 'followUp', message, options });
        return rawMessage;
      },
      deleteResponse: async () => {
        calls.push({ kind: 'delete' });
      },
    },
  };

  const client = new Client({ rest, token: 'id.secret', catalog: app.i18n.catalog(), registerCommands: false });
  client.app = app;
  client.interactions = new Interactions(client, app);
  client.on('error', (error) => console.error('[client error]', error));
  await client.interactions.initialize();
  return { app, client, calls, warnings };
}

const commandPayload = (name, options = []) => ({
  id: '1000000000000000001',
  token: 'token',
  application_id: '9',
  type: 2,
  guild_id: GUILD,
  channel_id: '200000000000000001',
  locale: 'tr',
  member: { user: { id: '55', username: 'user' }, roles: [] },
  data: { id: '1', name, type: 1, options },
});

async function dispatch(client, raw) {
  await client.handleDispatch({ name: 'INTERACTION_CREATE', data: raw, sequence: 1, shardId: 0 });
  for (let index = 0; index < 6; index += 1) await new Promise((resolve) => setImmediate(resolve));
}

const embedOf = (call) => call.message.embeds[0];
const answers = (calls) => calls.filter((call) => call.message?.embeds);

test('a real client routes a slash command to the loaded handler', async () => {
  const { client, calls } = await realClient();
  await dispatch(client, commandPayload('rank'));

  assert.deepEqual(calls.map((call) => call.kind), ['defer', 'edit']);
  assert.equal(calls[0].options.ephemeral, false);
  assert.equal(embedOf(calls[1]).title, '⭐ Seviye kartı');
  assert.equal(embedOf(calls[1]).description, '<@55> henüz XP kazanmadı.');
});

test('a real client reaches every loaded slash command', async () => {
  const { client, calls } = await realClient();
  const names = [...client.interactions.slash.commands.keys()].sort();
  assert.deepEqual(names, ['avatar', 'ban', 'help', 'leaderboard', 'levelrole', 'mute', 'ping', 'purge', 'rank', 'serverinfo', 'settings', 'userinfo', 'xpadjust', 'xpignore', 'xpreset']);

  for (const name of names) {
    calls.length = 0;
    await dispatch(client, commandPayload(name));
    const [answer] = answers(calls);
    assert.ok(answer, `${name} produced no response`);
    assert.ok(embedOf(answer).description, name);
  }
});

test('a real client refuses the settings panel to members without the permission', async () => {
  const { client, calls } = await realClient();
  await dispatch(client, commandPayload('settings'));

  const [answer] = answers(calls);
  assert.match(embedOf(answer).description, /Sunucuyu Yönet/);
  assert.equal(calls.some((call) => call.message?.components), false);
});
test('a real client answers a command the bot does not know instead of dropping it', async () => {
  const { client, calls, warnings } = await realClient();
  await dispatch(client, commandPayload('sil'));

  const [answer] = answers(calls);
  assert.equal(embedOf(answer).description, 'Bu komut güncel değil veya tanınmıyor. Biraz sonra tekrar dene.');
  assert.match(warnings.at(-1), /no handler for "sil"/);
});

test('a real client sends the drawn level card as a follow up file', async () => {
  const { app, client, calls } = await realClient();
  app.levels.addMessageXp(GUILD, '55', 300, 0);
  app.levels.addMessageXp(GUILD, '56', 900, 0);

  await dispatch(client, commandPayload('rank'));

  assert.deepEqual(calls.map((call) => call.kind), ['defer', 'followUp', 'delete']);
  const [file] = calls[1].message.files;
  assert.equal(file.name, 'card.png');
  assert.equal(file.data.type, 'image/png');
  assert.equal(file.description, 'user · Seviye 2 · Sıralama #2 · 300 XP');
  assert.equal(calls[1].options.ephemeral, false);

  const bytes = Buffer.from(await file.data.arrayBuffer());
  assert.equal(bytes.subarray(0, 8).toString('hex'), PNG_SIGNATURE);
  assert.ok(bytes.length > 5000);
});

test('a real client sends the drawn leaderboard as a follow up file', async () => {
  const { app, client, calls } = await realClient();
  app.levels.addMessageXp(GUILD, '55', 300, 0);
  app.levels.addMessageXp(GUILD, '56', 900, 0);
  app.levels.addMessageXp(GUILD, '57', 120, 0);

  await dispatch(client, commandPayload('leaderboard'));

  assert.deepEqual(calls.map((call) => call.kind), ['defer', 'followUp', 'delete']);
  const [file] = calls[1].message.files;
  assert.equal(file.name, 'card.png');
  assert.equal(file.data.type, 'image/png');
  assert.match(file.description, /^Liderlik tablosu · Sayfa 1\/1\n1\. 56 · Seviye 4 · 900 XP\n2\. 55 · Seviye 2 · 300 XP\n3\. 57 · Seviye 1 · 120 XP$/);

  const bytes = Buffer.from(await file.data.arrayBuffer());
  assert.equal(bytes.subarray(0, 8).toString('hex'), PNG_SIGNATURE);
  assert.ok(bytes.length > 8000);
});
