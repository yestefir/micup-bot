const TTL_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 500;

const cache = new Map();

const stub = (id) => ({ id, displayName: id, avatarURL: () => null });

export async function resolveUsers(client, ids, { now = Date.now() } = {}) {
  const found = new Map();

  await Promise.all(
    [...new Set(ids)].map(async (id) => {
      const cached = cache.get(id);
      if (cached && now - cached.at < TTL_MS) {
        found.set(id, cached.user);
        return;
      }
      try {
        const user = await client.users.fetch(id);
        cache.delete(id);
        cache.set(id, { user, at: now });
        if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value);
        found.set(id, user);
      } catch {
        found.set(id, stub(id));
      }
    }),
  );

  return found;
}

export function clearUserCache() {
  cache.clear();
}
