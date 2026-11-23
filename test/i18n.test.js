import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { localizeCommand } from 'micup.ts/easy';
import { loadModules } from '../src/utils/files/walk.js';
import { resolve } from 'node:path';

const app = createApp({ databasePath: ':memory:' });
const { i18n } = app;

test('every language has exactly the keys of the fallback (aliases optional)', () => {
  const isRequired = (key) => !key.endsWith('.aliases');
  for (const code of i18n.codes) {
    assert.deepEqual(i18n.missingKeys(code).filter(isRequired), [], `${code} is missing keys`);
    assert.deepEqual(i18n.extraKeys(code).filter(isRequired), [], `${code} has unknown keys`);
  }
});

test('placeholders match the fallback in every language', () => {
  const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
  const reference = i18n.languages.get(i18n.fallback).messages;
  for (const { code, messages } of i18n.languages.values()) {
    for (const [key, text] of Object.entries(messages)) {
      if (!(key in reference)) continue;
      assert.deepEqual(placeholders(text), placeholders(reference[key]), `${code}:${key}`);
    }
  }
});

const MICUP_LOCALES = new Set([
  'ar', 'bg', 'cs', 'da', 'de', 'el', 'en-US', 'es-ES', 'es-419', 'fi', 'fr', 'he', 'hi', 'hr', 'hu', 'id', 'it', 'ja', 'ko', 'lt',
  'nl', 'no', 'pl', 'pt-BR', 'ro', 'ru', 'sv-SE', 'th', 'tr', 'uk', 'vi', 'zh-CN', 'zh-TW',
]);

test('every language file is named with a locale code Micup accepts', () => {
  for (const code of i18n.codes) assert.ok(MICUP_LOCALES.has(code), `${code} is not a Micup locale`);
});

test('resolve maps locales to supported languages', () => {
  assert.equal(i18n.resolve('tr'), 'tr');
  assert.equal(i18n.resolve('en-US'), 'en-US');
  assert.equal(i18n.resolve('en'), 'en-US');
  assert.equal(i18n.resolve('en-GB'), 'en-US');
  assert.equal(i18n.resolve('es'), 'es-ES');
  assert.equal(i18n.resolve('RU_ru'), 'ru');
  assert.equal(i18n.resolve('ja'), undefined);
});

test('t falls back to the default language and fills placeholders', () => {
  assert.equal(i18n.t('en-US', 'purge.msg.done', { count: 3 }), 'Messages deleted: 3');
  assert.equal(i18n.t('xx', 'purge.msg.done', { count: 3 }), 'Messages deleted: 3');
  assert.equal(i18n.t('en-US', 'no.such.key'), 'no.such.key');
});

test('names include the localized names and aliases of every language', () => {
  const names = i18n.names('purge');
  for (const expected of ['sil', 'temizle', 'purge', 'clear', 'borrar', 'очистить']) {
    assert.ok(names.includes(expected), expected);
  }
});

test('slash commands pass SDK localization validation', async () => {
  const catalog = i18n.catalog();
  const modules = await loadModules(resolve(app.srcRoot, 'commands/slash'));
  assert.ok(modules.length >= 2);
  for (const { module } of modules) {
    const json = module.data(app).toJSON();
    const localized = localizeCommand(json, catalog, { strict: true });
    assert.equal(localized.name, json.name);
    assert.ok(Object.keys(localized.name_localizations ?? {}).length >= 5, `${json.name} localizations`);
  }
});
