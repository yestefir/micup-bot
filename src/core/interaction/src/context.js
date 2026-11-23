import { GLOBAL } from '../../settings/settings.js';

function resolveLanguage(app, guildId, locale) {
  if (guildId && app.settings.isSet(guildId, 'language')) return app.settings.get(guildId, 'language');
  return app.i18n.resolve(locale) ?? app.settings.get(guildId ?? GLOBAL, 'language');
}

export function createContext(app, client, { guildId, locale } = {}) {
  const context = {
    app,
    client,
    guildId,
    i18n: app.i18n,
    settings: app.settings,
    config: app.config,
    lang: resolveLanguage(app, guildId, locale),
    prefix: app.settings.get(guildId ?? GLOBAL, 'prefix'),
    t(key, values) {
      return app.i18n.t(context.lang, key, values);
    },
  };
  return context;
}
