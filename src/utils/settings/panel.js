import { SettingError } from '../../core/settings/settings.js';

const result = (type, text) => ({ type, text });

export function findEditable(context, key) {
  const wanted = String(key ?? '').toLowerCase();
  return context.settings.definitions.find((definition) => definition.editable && definition.key.toLowerCase() === wanted);
}

const unknown = (context, key) => result('error', context.t('settings.msg.unknownKey', { key }));

export const settingsPanel = {
  set(context, key, raw) {
    const definition = findEditable(context, key);
    if (!definition) return unknown(context, key);
    try {
      const value = context.settings.set(context.guildId, definition.key, raw);
      if (definition.key === 'language') context.lang = value;
      return result('success', '');
    } catch (error) {
      if (!(error instanceof SettingError)) throw error;
      return result('error', context.t(`errors.setting.${error.code}`, error.params));
    }
  },

  reset(context, key) {
    const definition = findEditable(context, key);
    if (!definition) return unknown(context, key);
    context.settings.reset(context.guildId, definition.key);
    if (definition.key === 'language') context.lang = context.settings.get(context.guildId, 'language');
    return result('success', '');
  },
};
