export function parseInteger(token) {
  if (typeof token !== 'string' || !/^-?\d+$/.test(token)) return null;
  return Number(token);
}

export function parseUserId(token) {
  if (typeof token !== 'string') return null;
  const mention = token.match(/^<@!?([^>\s]+)>$/);
  if (mention) return mention[1];
  if (/^\d{5,}$/.test(token)) return token;
  return null;
}
