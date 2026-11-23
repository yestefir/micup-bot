import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { MessageCatalog } from 'micup.ts';

function flatten(object, prefix = '', out = {}) {
  for (const [key, value] of Object.entries(object)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object') flatten(value, path, out);
    else out[path] = String(value);
  }
  return out;
}

export class I18n {
  constructor(directory, fallback) {
    this.fallback = fallback;
    this.languages = new Map();
    const files = readdirSync(directory).filter((file) => file.endsWith('.json')).sort();
    for (const file of files) {
      const code = basename(file, '.json');
      const messages = flatten(JSON.parse(readFileSync(join(directory, file), 'utf8')));
      this.languages.set(code, { code, name: messages.language ?? code, messages });
    }
    if (!this.languages.has(fallback)) throw new Error(`Missing fallback language file: ${fallback}.json`);
  }

  get codes() {
    return [...this.languages.keys()];
  }

  has(code) {
    return this.languages.has(code);
  }

  name(code) {
    return this.languages.get(code)?.name ?? code;
  }

  resolve(locale) {
    if (!locale) return undefined;
    const normalized = String(locale).toLowerCase().replace('_', '-');
    const byLowercase = new Map(this.codes.map((code) => [code.toLowerCase(), code]));
    const exact = byLowercase.get(normalized);
    if (exact) return exact;
    const base = normalized.split('-')[0];
    return byLowercase.get(base) ?? this.codes.find((code) => code.toLowerCase().split('-')[0] === base);
  }

  t(language, key, values) {
    const template =
      this.languages.get(language)?.messages[key] ??
      this.languages.get(this.fallback).messages[key] ??
      key;
    if (!values) return template;
    return template.replace(/\{(\w+)\}/g, (match, name) => (name in values ? String(values[name]) : match));
  }

  names(path) {
    const found = new Set();
    for (const { messages } of this.languages.values()) {
      const name = messages[`${path}.name`];
      if (name) found.add(name.toLowerCase());
      const aliases = messages[`${path}.aliases`];
      if (aliases) {
        for (const alias of aliases.split(',')) {
          const trimmed = alias.trim().toLowerCase();
          if (trimmed) found.add(trimmed);
        }
      }
    }
    return [...found];
  }

  missingKeys(code) {
    const reference = this.languages.get(this.fallback).messages;
    const target = this.languages.get(code).messages;
    return Object.keys(reference).filter((key) => !(key in target));
  }

  extraKeys(code) {
    const reference = this.languages.get(this.fallback).messages;
    const target = this.languages.get(code).messages;
    return Object.keys(target).filter((key) => !(key in reference));
  }

  catalog() {
    const fallbackMessages = this.languages.get(this.fallback).messages;
    const wanted = (key) => key in fallbackMessages && (key.endsWith('.name') || key.endsWith('.description'));
    const pick = (messages) => Object.fromEntries(Object.entries(messages).filter(([key]) => wanted(key)));
    const locales = {};
    for (const { code, messages } of this.languages.values()) locales[code] = pick(messages);
    return new MessageCatalog(this.fallback, locales);
  }
}
