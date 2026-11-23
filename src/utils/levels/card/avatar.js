const TTL_MS = 10 * 60 * 1000;
const MAX_BYTES = 3 * 1024 * 1024;
const TIMEOUT_MS = 3000;
const MAX_ENTRIES = 200;

const cache = new Map();

export function avatarUrl(user) {
  try {
    return user.avatarURL({ format: 'png', size: 256 });
  } catch {
    return null;
  }
}

export async function fetchAvatar(url, { fetcher = fetch, now = Date.now() } = {}) {
  if (!url) return null;

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;

  const cached = cache.get(url);
  if (cached && now - cached.at < TTL_MS) return cached.buffer;

  try {
    const response = await fetcher(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) return null;
    if (!(response.headers.get('content-type') ?? '').startsWith('image/')) return null;
    if (Number(response.headers.get('content-length') ?? 0) > MAX_BYTES) return null;

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0 || buffer.length > MAX_BYTES) return null;

    cache.delete(url);
    cache.set(url, { buffer, at: now });
    if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value);
    return buffer;
  } catch {
    return null;
  }
}

export function clearAvatarCache() {
  cache.clear();
}
