import { MicupAPIError, Permission } from 'micup.ts';
import { createApp } from '../../src/app.js';
import { Interactions } from '../../src/core/interaction/core.js';

export const GUILD = '100000000000000001';
export const BOT = '900000000000000001';
export const OUTSIDER = '123456789';

export const body = (payload) => payload.embeds[0].description;
export const colorOf = (payload) => payload.embeds[0].color;

const ROLES = [
  { id: 'everyone', position: 0 },
  { id: 'mod', position: 5 },
  { id: 'bot', position: 8 },
  { id: 'top', position: 9 },
  { id: 'admin', position: 10 },
];

const baseMembers = () => ({
  A: { roles: ['mod'] },
  T: { roles: [] },
  OTHERBOT: { roles: [], user: { bot: true } },
  H: { roles: ['admin'] },
  TOP: { roles: ['top'] },
  ADMIN: { roles: ['admin'] },
  O: { roles: [] },
  [BOT]: { roles: ['bot'] },
});

export function apiError(status) {
  return new MicupAPIError(new Response(null, { status }), { message: 'failed' });
}

export function formError(path = 'root') {
  return new MicupAPIError(new Response(null, { status: 400 }), {
    code: 'INVALID_FORM_BODY',
    message: 'Invalid form body.',
    errors: [{ path, message: 'The provided value is in an invalid format.', code: 'INVALID_FORMAT' }],
  });
}

function hasLocale(node, locales) {
  if (Array.isArray(node)) return node.some((item) => hasLocale(item, locales));
  if (!node || typeof node !== 'object') return false;
  return Object.entries(node).some(([key, value]) => {
    if (key.endsWith('_localizations') && value && typeof value === 'object') {
      return Object.keys(value).some((locale) => locales.has(locale));
    }
    return hasLocale(value, locales);
  });
}

export async function createWorld(overrides = {}) {
  const app = createApp({ databasePath: ':memory:', ...overrides });
  const logs = [];
  const errors = [];
  app.logger = {
    info: (message) => logs.push(message),
    warn: (message) => logs.push(message),
    error: (...args) => {
      errors.push(args.join(' '));
      if (!overrides.expectErrors) console.error('[test logger]', ...args);
    },
  };
  const members = baseMembers();
  const calls = {
    timeout: [],
    clearTimeout: [],
    ban: [],
    banError: null,
    register: [],
    registerError: null,
    registerResult: { created: [], updated: [], unchanged: [], deleted: [] },
    writes: [],
    addRole: [],
    removeRole: [],
    roleErrors: new Map(),
    removeErrors: new Map(),
    rules: { rejectLocales: new Set(), rejectNames: new Set(), failCreate: null },
  };
  const listeners = new Map();
  const baseline = new Map();
  const server = new Map();
  let sequence = 0;

  const validate = (definition) => {
    if (calls.rules.failCreate) throw calls.rules.failCreate;
    if (calls.rules.rejectNames.has(definition.name)) throw formError();
    if (hasLocale(definition, calls.rules.rejectLocales)) throw formError('name_localizations');
  };

  const guilds = { [GUILD]: { id: GUILD, raw: { guild_tag: 'ABC' } } };

  const client = {
    app,
    calls,
    members,
    guilds: { get: (id) => guilds[id] },
    slash: new Map(),
    user: { id: BOT },
    rest: {
      guilds: {
        get: async () => ({ owner_id: 'O' }),
        roles: async () => ROLES,
        member: async (guildId, id) => {
          if (!members[id]) throw apiError(404);
          return members[id];
        },
        timeout: async (...args) => calls.timeout.push(args),
        clearTimeout: async (...args) => calls.clearTimeout.push(args),
        addMemberRole: async (guildId, userId, roleId, options) => {
          if (calls.roleErrors.has(roleId)) throw calls.roleErrors.get(roleId);
          calls.addRole.push([guildId, userId, roleId, options]);
        },
        removeMemberRole: async (guildId, userId, roleId, options) => {
          if (calls.removeErrors.has(roleId)) throw calls.removeErrors.get(roleId);
          calls.removeRole.push([guildId, userId, roleId, options]);
        },
        ban: async (...args) => {
          if (calls.banError) throw calls.banError;
          calls.ban.push(args);
        },
      },
      commands: {
        list: async () => [...server.values()],
        create: async (definition) => {
          validate(definition);
          const saved = { ...definition, id: String((sequence += 1)) };
          server.set(saved.id, saved);
          calls.writes.push(['create', definition]);
          return saved;
        },
        edit: async (id, definition) => {
          validate(definition);
          const saved = { ...definition, id };
          server.set(id, saved);
          calls.writes.push(['edit', definition]);
          return saved;
        },
        delete: async (id) => {
          server.delete(id);
          calls.writes.push(['delete', id]);
        },
      },
    },
    server,
    command(builder, handler) {
      client.slash.set(builder.toJSON().name, handler);
      return client;
    },
    permissionsFor: () => Permission.All,
    registerCommands: async (options) => {
      calls.register.push(options);
      if (calls.registerError) throw calls.registerError;
      return calls.registerResult;
    },
    on(name, listener) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(listener);
      return client;
    },
    off(name, listener) {
      listeners.get(name)?.delete(listener);
      return client;
    },
    emit(name, ...args) {
      for (const listener of [...(listeners.get(name) ?? [])]) listener(...args);
    },
    listenerCount: (name) => (listeners.get(name)?.size ?? 0) - (baseline.get(name) ?? 0),
  };

  const interactions = new Interactions(client, app);
  await interactions.initialize();
  for (const [name, set] of listeners) baseline.set(name, set.size);
  return { app, client, interactions, calls, members, logs, errors, server, guilds };
}

export function actorFor(world, id, permissions = Permission.All) {
  return {
    id,
    displayName: 'Ali',
    roles: world.members[id].roles,
    hasPermission: (needed) => (permissions & needed) === needed,
  };
}

export function createMessage(world, content, actorId = 'A', permissions = Permission.All) {
  const replies = [];
  const edits = [];
  const sent = { delete: async () => {}, edit: async (payload) => edits.push(payload) };
  return {
    id: '500',
    content,
    replies,
    edits,
    author: { id: actorId, bot: false, displayName: 'Ali', avatarURL: () => null },
    fromSelf: false,
    guildId: GUILD,
    channelId: '200',
    channel: { send: async (payload) => (replies.push(payload), sent) },
    member: actorFor(world, actorId, permissions),
    delete: async () => {},
    reply: async (payload) => (replies.push(payload), sent),
  };
}

export async function run(world, content, actorId, permissions) {
  const message = createMessage(world, content, actorId, permissions);
  await world.interactions.prefix.handleMessage(message);
  return message.replies.at(-1);
}

export const settle = async () => {
  for (let index = 0; index < 8; index += 1) await new Promise((resolve) => setImmediate(resolve));
};

export function click(customId, { user = 'A', values = [] } = {}) {
  const log = { updates: [], replies: [], modals: [], deferred: 0 };
  return {
    customId,
    values,
    log,
    user: { id: user },
    update: async (payload) => log.updates.push(payload),
    deferUpdate: async () => {
      log.deferred += 1;
    },
    showModal: async (form) => log.modals.push(form),
    reply: async (payload) => log.replies.push(payload),
  };
}

export function submit(customId, reason, { user = 'A' } = {}) {
  const log = { deferred: 0, deleted: 0, replies: [] };
  return {
    customId,
    log,
    user: { id: user },
    fields: { getTextInputValue: () => reason },
    reply: async (payload) => log.replies.push(payload),
    deferReply: async () => {
      log.deferred += 1;
    },
    deleteReply: async () => {
      log.deleted += 1;
    },
  };
}
