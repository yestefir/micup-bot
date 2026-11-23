import { MicupAPIError } from 'micup.ts';
import { localizeCommand } from 'micup.ts/easy';

const LOCALIZATION_SUFFIX = '_localizations';
const BODY_PREVIEW = 800;

export const isFormError = (error) => error instanceof MicupAPIError && error.code === 'INVALID_FORM_BODY';

const isLocalizationMap = (key, value) => key.endsWith(LOCALIZATION_SUFFIX) && value && typeof value === 'object';

function collectLocales(node, found = new Set()) {
  if (Array.isArray(node)) {
    for (const item of node) collectLocales(item, found);
  } else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (isLocalizationMap(key, value)) for (const locale of Object.keys(value)) found.add(locale);
      else collectLocales(value, found);
    }
  }
  return found;
}

function restrictLocales(node, allowed) {
  if (Array.isArray(node)) return node.map((item) => restrictLocales(item, allowed));
  if (!node || typeof node !== 'object') return node;
  const copy = {};
  for (const [key, value] of Object.entries(node)) {
    if (isLocalizationMap(key, value)) {
      const kept = Object.fromEntries(Object.entries(value).filter(([locale]) => allowed.has(locale)));
      if (Object.keys(kept).length > 0) copy[key] = kept;
    } else {
      copy[key] = restrictLocales(value, allowed);
    }
  }
  return copy;
}

const keyOf = (command) => `${command.type ?? 1}:${command.name}`;

export function describeErrors(error) {
  return error.errors.length > 0 ? error.errors.map((item) => `${item.path}: ${item.code}`).join(', ') : error.message;
}

export async function registerOneByOne({ client, app, definitions, guildId }) {
  const scope = { guildId };
  const { logger } = app;
  const catalog = app.i18n.catalog();
  const existing = await client.rest.commands.list(scope);
  const known = new Map(existing.map((command) => [keyOf(command), command]));
  const summary = { registered: [], partial: {}, failed: [], deleted: [] };

  const submit = async (definition) => {
    const found = known.get(keyOf(definition));
    const saved = found
      ? await client.rest.commands.edit(found.id, definition, scope)
      : await client.rest.commands.create(definition, scope);
    known.set(keyOf(definition), saved ?? found);
  };

  for (const plain of definitions) {
    const full = localizeCommand(plain, catalog);

    try {
      await submit(full);
      summary.registered.push(plain.name);
      continue;
    } catch (error) {
      if (!isFormError(error)) throw error;
    }

    try {
      await submit(plain);
    } catch (error) {
      if (!isFormError(error)) throw error;
      summary.failed.push(plain.name);
      logger.error(
        `[slash] "${plain.name}" is rejected even without localizations (${describeErrors(error)}): ${JSON.stringify(plain).slice(0, BODY_PREVIEW)}`,
      );
      continue;
    }

    let accepted = new Set();
    const rejected = [];
    for (const locale of collectLocales(full)) {
      const candidate = new Set([...accepted, locale]);
      try {
        await submit(restrictLocales(full, candidate));
        accepted = candidate;
      } catch (error) {
        if (!isFormError(error)) throw error;
        rejected.push(locale);
      }
    }

    summary.registered.push(plain.name);
    if (rejected.length > 0) summary.partial[plain.name] = rejected;
  }

  const wanted = new Set(definitions.map(keyOf));
  for (const command of existing) {
    if (wanted.has(keyOf(command))) continue;
    await client.rest.commands.delete(command.id, scope);
    summary.deleted.push(command.name);
  }

  return summary;
}
