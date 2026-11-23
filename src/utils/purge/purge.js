import { compareSnowflakes } from 'micup.ts';

const PAGE_SIZE = 100;
const MAX_SCANNED_PAGES = 10;

function oldest(messages) {
  return messages.reduce((current, message) => (compareSnowflakes(message.id, current.id) < 0 ? message : current));
}

async function collect(channel, amount, userId, before) {
  const ids = [];
  let cursor = before;
  for (let page = 0; page < MAX_SCANNED_PAGES && ids.length < amount; page += 1) {
    const limit = userId ? PAGE_SIZE : Math.min(PAGE_SIZE, amount - ids.length);
    const batch = await channel.fetchMessages({ limit, before: cursor });
    if (batch.length === 0) break;
    for (const message of batch) {
      if (ids.length >= amount) break;
      if (!userId || message.author.id === userId) ids.push(message.id);
    }
    cursor = oldest(batch).id;
    if (batch.length < limit) break;
  }
  return ids;
}

export async function purgeMessages({ channel, amount, userId, before }) {
  const ids = await collect(channel, amount, userId, before);
  for (let start = 0; start < ids.length; start += PAGE_SIZE) {
    await channel.bulkDelete(ids.slice(start, start + PAGE_SIZE));
  }
  return ids.length;
}
