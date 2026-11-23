import embedConfig from '../../config/general/embed.json' with { type: 'json' };

export const TYPES = Object.freeze(['success', 'error', 'warning', 'info']);

export function toColor(hex) {
  return Number.parseInt(String(hex).replace('#', ''), 16);
}

export function createEmbed({ type = 'info', title, description, fields, footer, timestamp } = {}) {
  if (!TYPES.includes(type)) throw new Error(`Unknown embed type: ${type}`);
  const embed = { color: toColor(embedConfig.colors[type]) };
  if (title) embed.title = title;
  if (description) embed.description = description;
  if (fields?.length) embed.fields = fields;
  if (footer) embed.footer = { text: footer };
  if (timestamp) embed.timestamp = timestamp;
  return embed;
}

export function defaultTitle(type, t) {
  return `${embedConfig.icons[type]} ${t(`status.${type}`)}`;
}

export function autoDeleteFor(type) {
  return embedConfig.autoDelete[type] ?? 0;
}
