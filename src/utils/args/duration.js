const UNITS = {
  s: 1000,
  sn: 1000,
  m: 60 * 1000,
  dk: 60 * 1000,
  h: 60 * 60 * 1000,
  sa: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  g: 24 * 60 * 60 * 1000,
  w: 7 * 24 * 60 * 60 * 1000,
  hf: 7 * 24 * 60 * 60 * 1000,
};

export const MAX_DURATION_MS = 365 * UNITS.d;

const WHOLE = /^(?:\d+(?:sn|dk|sa|hf|s|m|h|d|g|w))+$/;
const PART = /(\d+)(sn|dk|sa|hf|s|m|h|d|g|w)/g;

export function parseDuration(text) {
  if (typeof text !== 'string') return null;
  const lowered = text.trim().toLowerCase();
  if (!WHOLE.test(lowered)) return null;
  let total = 0;
  for (const [, amount, unit] of lowered.matchAll(PART)) total += Number(amount) * UNITS[unit];
  if (!Number.isSafeInteger(total) || total <= 0 || total > MAX_DURATION_MS) return null;
  return total;
}

export function formatDuration(milliseconds) {
  const parts = [];
  let rest = Math.floor(milliseconds / 1000);
  for (const [label, size] of [['d', 86400], ['h', 3600], ['m', 60], ['s', 1]]) {
    const amount = Math.floor(rest / size);
    rest -= amount * size;
    if (amount > 0) parts.push(`${amount}${label}`);
  }
  return parts.join(' ') || '0s';
}
