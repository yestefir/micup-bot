export function xpToNext(level) {
  return 5 * level * level + 50 * level + 100;
}

export function totalXpForLevel(level) {
  let total = 0;
  for (let current = 0; current < level; current += 1) total += xpToNext(current);
  return total;
}

export function levelFromXp(xp) {
  let level = 0;
  let threshold = xpToNext(0);
  while (xp >= threshold) {
    level += 1;
    threshold += xpToNext(level);
  }
  return level;
}

export function progress(xp) {
  const level = levelFromXp(xp);
  const base = totalXpForLevel(level);
  const needed = xpToNext(level);
  const into = xp - base;
  return { level, into, needed, ratio: into / needed };
}
