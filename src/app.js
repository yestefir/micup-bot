import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import main from './config/general/main.json' with { type: 'json' };
import paths from './config/database/path.json' with { type: 'json' };
import { defineSettings } from './core/settings/definitions.js';
import { GuildTagStore } from './core/guildtag/store.js';
import { I18n } from './core/i18n/i18n.js';
import { LevelStore } from './core/levels/store.js';
import { Settings } from './core/settings/settings.js';
import { renderLeaderboardCard, renderLevelUpCard, renderRankCard } from './utils/levels/card/render.js';

const SRC_ROOT = fileURLToPath(new URL('.', import.meta.url));
const PROJECT_ROOT = resolve(SRC_ROOT, '..');
const LOCALES_DIRECTORY = resolve(SRC_ROOT, 'locales');
const SOURCE_LANGUAGE = 'en-US';

function databasePathFor(overrides, key, memory) {
  if (overrides[`${key}Path`]) return overrides[`${key}Path`];
  return memory ? ':memory:' : resolve(PROJECT_ROOT, paths[key]);
}

export function createApp(overrides = {}) {
  const databasePath = overrides.databasePath ?? resolve(PROJECT_ROOT, paths.settings);
  const memory = databasePath === ':memory:';

  const config = {
    token: process.env.MICUP_BOT_TOKEN,
    guildId: process.env.MICUP_GUILD_ID || main.guildId || undefined,
    prefix: process.env.DEFAULT_PREFIX || main.prefix,
    defaultLanguage: process.env.DEFAULT_LANGUAGE || main.defaultLanguage,
    ...overrides,
    databasePath,
    levelsPath: databasePathFor(overrides, 'levels', memory),
    guildTagPath: databasePathFor(overrides, 'guildTag', memory),
  };

  const i18n = new I18n(LOCALES_DIRECTORY, SOURCE_LANGUAGE);
  const settings = new Settings(config.databasePath);
  const app = {
    config,
    logger: console,
    srcRoot: SRC_ROOT,
    i18n,
    settings,
    levels: new LevelStore(config.levelsPath),
    guildTags: new GuildTagStore(config.guildTagPath),
    guildTagQueue: new Map(),
    requirementCache: new Map(),
    cards: { rank: renderRankCard, levelUp: renderLevelUpCard, leaderboard: renderLeaderboardCard },
    muteSessions: new Set(),
    banSessions: new Set(),
    describe: (key) => i18n.t(i18n.fallback, key),
  };

  defineSettings(app);
  return app;
}
