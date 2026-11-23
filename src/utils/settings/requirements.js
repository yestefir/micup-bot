const TTL_MS = 60_000;

const checks = {
  async guildTag(client, guildId) {
    if (client.guilds.get(guildId)?.raw?.guild_tag) return true;
    try {
      const guild = await client.rest.guilds.get(guildId);
      return Boolean(guild?.guild_tag);
    } catch {
      return true;
    }
  },
};

export const knownRequirements = Object.freeze(Object.keys(checks));

export async function requirementMet(context, name, { now = Date.now() } = {}) {
  const check = checks[name];
  if (!check) return true;

  const key = `${context.guildId}:${name}`;
  const cache = context.app.requirementCache;
  const cached = cache.get(key);
  if (cached && now - cached.at < TTL_MS) return cached.met;

  const met = await check(context.client, context.guildId);
  cache.set(key, { met, at: now });
  return met;
}

export async function isLocked(context, definition) {
  return definition.requires ? !(await requirementMet(context, definition.requires)) : false;
}
