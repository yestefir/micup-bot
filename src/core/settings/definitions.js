export function defineSettings({ settings, i18n, config }) {
  settings.define('prefix', {
    category: 'general',
    type: 'string',
    default: config.prefix,
    minLength: 1,
    maxLength: 5,
    validate: (value) => !/\s/.test(value),
  });

  settings.define('language', {
    category: 'general',
    type: 'string',
    default: config.defaultLanguage,
    normalize: (value) => i18n.resolve(value) ?? value,
    choices: () => i18n.codes,
    label: (value) => `${i18n.name(value)} (${value})`,
  });

  settings.define('levels.enabled', { category: 'levels', type: 'boolean', default: true });

  settings.define('levels.xpMin', { category: 'levels', type: 'integer', default: 15, min: 1, max: 100 });

  settings.define('levels.xpMax', { category: 'levels', type: 'integer', default: 25, min: 1, max: 100 });

  settings.define('levels.cooldownSeconds', { category: 'levels', type: 'integer', default: 60, min: 0, max: 3600 });

  settings.define('levels.announce', {
    category: 'levels',
    type: 'string',
    default: 'message',
    choices: ['message', 'off'],
  });

  settings.define('levels.channel', { category: 'levels', type: 'channel', default: null });

  settings.define('mute.sessionSeconds', {
    category: 'moderation',
    type: 'integer',
    default: 15,
    min: 5,
    max: 120,
  });

  settings.define('purge.maxAmount', {
    category: 'moderation',
    type: 'integer',
    default: 100,
    min: 1,
    max: 1000,
  });

  settings.define('moderation.logChannel', { category: 'moderation', type: 'channel', default: null });

  settings.define('ban.sessionSeconds', {
    category: 'moderation',
    type: 'integer',
    default: 15,
    min: 5,
    max: 120,
  });

  settings.define('autorole.roles', {
    category: 'autorole',
    type: 'roles',
    default: [],
    maxItems: 10,
  });

  settings.define('guildtag.roles', {
    category: 'guildtag',
    requires: 'guildTag',
    type: 'roles',
    default: [],
    maxItems: 10,
  });

  settings.define('guildtag.removeRoles', { category: 'guildtag', requires: 'guildTag', type: 'boolean', default: true });

  settings.define('guildtag.logChannel', { category: 'guildtag', requires: 'guildTag', type: 'channel', default: null });
}
