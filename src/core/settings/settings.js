import { DatabaseSync } from 'node:sqlite';
import { EventEmitter } from 'node:events';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const GLOBAL = 'global';

export class SettingError extends Error {
  constructor(code, params = {}) {
    super(code);
    this.name = 'SettingError';
    this.code = code;
    this.params = params;
  }
}

const TRUE_TOKENS = new Set(['true', 'on', 'yes', '1']);
const FALSE_TOKENS = new Set(['false', 'off', 'no', '0']);
const TYPES = new Set(['string', 'integer', 'boolean', 'role', 'channel', 'roles']);
const NULLABLE_TYPES = new Set(['role', 'channel']);
const SINGLE_ID_TYPES = new Set(['role', 'channel']);
const MAX_LIST_ITEMS = 25;

const resolveChoices = (definition) =>
  typeof definition.choices === 'function' ? definition.choices() : definition.choices;

function coerceInteger(definition, value) {
  let typed;
  if (typeof value === 'number' && Number.isInteger(value)) typed = value;
  else if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) typed = Number(value.trim());
  else throw new SettingError('invalidInteger');
  if (definition.min !== undefined && typed < definition.min) throw new SettingError('tooSmall', { min: definition.min });
  if (definition.max !== undefined && typed > definition.max) throw new SettingError('tooLarge', { max: definition.max });
  return typed;
}

function coerceBoolean(value) {
  if (typeof value === 'boolean') return value;
  const token = String(value).trim().toLowerCase();
  if (TRUE_TOKENS.has(token)) return true;
  if (FALSE_TOKENS.has(token)) return false;
  throw new SettingError('invalidBoolean');
}

const MENTIONS = { role: /^<@&(\d{5,})>$/, channel: /^<#(\d{5,})>$/ };

function coerceId(type, value) {
  const text = String(value).trim();
  const mention = text.match(MENTIONS[type]);
  const id = mention ? mention[1] : text;
  if (!/^\d{5,}$/.test(id)) throw new SettingError('invalidId');
  return id;
}

function coerceRoleList(definition, value) {
  const items = Array.isArray(value) ? value : String(value).split(/[\s,]+/).filter(Boolean);
  const ids = [...new Set(items.map((item) => coerceId('role', item)))];
  const max = definition.maxItems ?? MAX_LIST_ITEMS;
  if (ids.length > max) throw new SettingError('tooMany', { max });
  return ids;
}

function coerceString(definition, value) {
  const text = String(value);
  if (definition.minLength !== undefined && text.length < definition.minLength) {
    throw new SettingError('tooShort', { min: definition.minLength });
  }
  if (definition.maxLength !== undefined && text.length > definition.maxLength) {
    throw new SettingError('tooLong', { max: definition.maxLength });
  }
  if (definition.validate && !definition.validate(text)) throw new SettingError('invalid');
  return text;
}

function coerce(definition, value) {
  let typed;
  if (definition.type === 'integer') typed = coerceInteger(definition, value);
  else if (definition.type === 'boolean') typed = coerceBoolean(value);
  else if (SINGLE_ID_TYPES.has(definition.type)) typed = coerceId(definition.type, value);
  else if (definition.type === 'roles') typed = coerceRoleList(definition, value);
  else typed = coerceString(definition, value);

  if (definition.normalize) typed = definition.normalize(typed);

  const choices = resolveChoices(definition);
  if (choices) {
    const match = choices.find((choice) => String(choice).toLowerCase() === String(typed).toLowerCase());
    if (match === undefined) throw new SettingError('invalidChoice', { choices: choices.join(', ') });
    typed = match;
  }
  return typed;
}

export class Settings extends EventEmitter {
  #db;
  #definitions = new Map();
  #scopes = new Map();

  constructor(file = ':memory:') {
    super();
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
    this.#db = new DatabaseSync(file);
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        scope TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (scope, key)
      )
    `);
  }

  define(key, definition = {}) {
    if (this.#definitions.has(key)) throw new Error(`Setting already defined: ${key}`);
    const normalized = { type: 'string', editable: true, category: 'general', ...definition, key };
    if (typeof normalized.category !== 'string' || normalized.category === '') {
      throw new Error(`Setting ${key} needs a category name`);
    }
    if (!TYPES.has(normalized.type)) throw new Error(`Unknown setting type for ${key}: ${normalized.type}`);
    if (normalized.default === undefined) throw new Error(`Setting ${key} needs a default`);
    if (normalized.type === 'roles' && !Array.isArray(normalized.default)) {
      throw new Error(`Setting ${key} needs a list as its default`);
    }
    if (normalized.default === null) {
      if (!NULLABLE_TYPES.has(normalized.type)) throw new Error(`Setting ${key} cannot default to null`);
    } else {
      normalized.default = coerce(normalized, normalized.default);
    }
    this.#definitions.set(key, normalized);
    return normalized;
  }

  definition(key) {
    return this.#definitions.get(key);
  }

  has(key) {
    return this.#definitions.has(key);
  }

  get definitions() {
    return [...this.#definitions.values()];
  }

  parse(key, raw) {
    return coerce(this.#require(key), raw);
  }

  get(scope, key) {
    const definition = this.#require(key);
    const values = this.#load(scope);
    const value = values.has(key) ? values.get(key) : definition.default;
    return Array.isArray(value) ? [...value] : value;
  }

  isSet(scope, key) {
    this.#require(key);
    return this.#load(scope).has(key);
  }

  set(scope, key, value) {
    const definition = this.#require(key);
    const typed = coerce(definition, value);
    const previous = this.get(scope, key);
    this.#db
      .prepare(
        `INSERT INTO settings (scope, key, value, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(scope, key, JSON.stringify(typed), Date.now());
    this.#load(scope).set(key, typed);
    this.emit('change', { scope, key, value: this.get(scope, key), previous });
    return this.get(scope, key);
  }

  reset(scope, key) {
    const definition = this.#require(key);
    const values = this.#load(scope);
    if (!values.has(key)) return false;
    const stored = values.get(key);
    const previous = Array.isArray(stored) ? [...stored] : stored;
    this.#db.prepare('DELETE FROM settings WHERE scope = ? AND key = ?').run(scope, key);
    values.delete(key);
    this.emit('change', { scope, key, value: this.get(scope, key), previous });
    return true;
  }

  entries(scope, { editableOnly = false } = {}) {
    return this.definitions
      .filter((definition) => !editableOnly || definition.editable)
      .map((definition) => ({
        key: definition.key,
        value: this.get(scope, definition.key),
        isDefault: !this.isSet(scope, definition.key),
        definition,
      }));
  }

  close() {
    this.#db.close();
  }

  #require(key) {
    const definition = this.#definitions.get(key);
    if (!definition) throw new Error(`Unknown setting: ${key}`);
    return definition;
  }

  #load(scope) {
    let values = this.#scopes.get(scope);
    if (!values) {
      values = new Map();
      const rows = this.#db.prepare('SELECT key, value FROM settings WHERE scope = ?').all(scope);
      for (const row of rows) values.set(row.key, JSON.parse(row.value));
      this.#scopes.set(scope, values);
    }
    return values;
  }
}
