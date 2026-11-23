import {
  ChannelType,
  actionRow,
  channelSelect,
  dangerButton,
  defaultChannel,
  defaultRole,
  primaryButton,
  roleSelect,
  secondaryButton,
  selectOption,
  selectRow,
  stringSelect,
} from 'micup.ts/easy';
import panelConfig from '../../config/general/panel.json' with { type: 'json' };

const MAX_SELECT_OPTIONS = 25;
const FIELD_LIMIT = 100;
const MENTION_LIST_LIMIT = 900;
const CHARACTERS_PER_LINE = 55;
const DESCRIPTION_LINES = 2;
const DEFAULT_CHANNEL_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement];

export const INVISIBLE = '⠀';

const clip = (text, max) => {
  const characters = Array.from(text);
  return characters.length > max ? `${characters.slice(0, max - 1).join('')}…` : text;
};
const plain = (text) => String(text).replaceAll('`', "'");

export function choicesOf(definition) {
  const choices = typeof definition.choices === 'function' ? definition.choices() : definition.choices;
  return choices ?? [];
}

export function controlFor(definition) {
  if (definition.type === 'roles') return 'roles';
  if (definition.type === 'role') return 'role';
  if (definition.type === 'channel') return 'channel';
  if (definition.type === 'boolean') return 'toggle';
  if (choicesOf(definition).length > 0) return 'choice';
  return 'edit';
}

export function choiceLabel(context, definition, value) {
  if (definition.label) return definition.label(value);
  const key = `settings.choices.${definition.key}.${value}`;
  const text = context.t(key);
  return text === key ? String(value) : text;
}

export function describeSetting(context, definition) {
  const key = `settings.items.${definition.key}`;
  const text = context.t(key);
  return text === key ? null : text;
}

export function shortValue(context, definition, value) {
  if (definition.type === 'roles') {
    return value?.length > 0 ? context.t('settings.panel.rolesCount', { count: value.length }) : '—';
  }
  if (value === null || value === undefined || value === '') return '—';
  if (definition.type === 'boolean') return context.t(value ? 'settings.panel.on' : 'settings.panel.off');
  if (controlFor(definition) === 'choice') return clip(plain(choiceLabel(context, definition, value)), panelConfig.valueWidth);
  return clip(plain(value), panelConfig.valueWidth);
}

function mentionList(ids) {
  const mentions = [];
  let length = 0;
  for (const id of ids) {
    const mention = `<@&${id}>`;
    if (length + mention.length + 1 > MENTION_LIST_LIMIT) break;
    mentions.push(mention);
    length += mention.length + 1;
  }
  return mentions.join(' ');
}

export function richValue(context, definition, value) {
  if (definition.type === 'roles') {
    return value?.length > 0 ? mentionList(value) : `*${context.t('settings.panel.notSet')}*`;
  }
  if (value === null || value === undefined || value === '') return `*${context.t('settings.panel.notSet')}*`;
  if (definition.type === 'boolean') return context.t(value ? 'settings.panel.on' : 'settings.panel.off');
  if (definition.type === 'role') return `<@&${value}>`;
  if (definition.type === 'channel') return `<#${value}>`;
  if (controlFor(definition) === 'choice') return choiceLabel(context, definition, value);
  return `\`${clip(plain(value), FIELD_LIMIT)}\``;
}

export function listBlock(context, items, selected, height = 0) {
  const rows = panelConfig.visibleRows;
  const start = Math.max(0, Math.min(selected - Math.floor(rows / 2), items.length - rows));
  const visible = items.slice(start, start + rows);
  const width = Math.max(...visible.map((item) => item.definition.key.length));
  const lines = visible.map((item, offset) => {
    const marker = start + offset === selected ? '→' : ' ';
    return `${marker} ${item.definition.key.padEnd(width)}  ${shortValue(context, item.definition, item.value)}`;
  });
  while (lines.length < height) lines.push(INVISIBLE);
  return `\`\`\`\n${lines.join('\n')}\n\`\`\``;
}

export function listHeight(groups) {
  return Math.min(panelConfig.visibleRows, Math.max(...groups.map((group) => group.items.length)));
}

export function padDescription(text) {
  const lines = Math.ceil(Array.from(text).length / CHARACTERS_PER_LINE);
  return lines >= DESCRIPTION_LINES ? text : `${text}${`\n${INVISIBLE}`.repeat(DESCRIPTION_LINES - lines)}`;
}

export function groupByCategory(items) {
  const groups = new Map();
  for (const item of items) {
    const key = item.definition.category;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return [...groups].map(([key, list]) => ({ key, items: list }));
}

export function categoryName(context, key) {
  const path = `settings.categories.${key}`;
  const text = context.t(path);
  return text === path ? key : text;
}

function controlRow(context, prefix, definition, value) {
  const t = context.t;
  const control = controlFor(definition);

  if (control === 'toggle') {
    return actionRow(primaryButton(`${prefix}toggle`, t(value ? 'settings.panel.turnOff' : 'settings.panel.turnOn')));
  }

  if (control === 'choice') {
    const options = choicesOf(definition)
      .slice(0, MAX_SELECT_OPTIONS)
      .map((choice) =>
        selectOption(choiceLabel(context, definition, choice), String(choice), String(choice) === String(value) ? { default: true } : {}),
      );
    return selectRow(stringSelect(`${prefix}choice`, ...options));
  }

  if (control === 'roles') {
    const menu = {
      ...roleSelect(`${prefix}roles`),
      placeholder: t('settings.panel.pickRoles'),
      min_values: 1,
      max_values: Math.min(definition.maxItems ?? MAX_SELECT_OPTIONS, MAX_SELECT_OPTIONS),
    };
    if (value?.length > 0) menu.default_values = value.slice(0, MAX_SELECT_OPTIONS).map((id) => defaultRole(id));
    return selectRow(menu);
  }

  if (control === 'role') {
    const menu = { ...roleSelect(`${prefix}role`), placeholder: t('settings.panel.pickRole') };
    if (value) menu.default_values = [defaultRole(value)];
    return selectRow(menu);
  }

  if (control === 'channel') {
    const types = definition.channelTypes ?? DEFAULT_CHANNEL_TYPES;
    const menu = { ...channelSelect(`${prefix}channel`, ...types), placeholder: t('settings.panel.pickChannel') };
    if (value) menu.default_values = [defaultChannel(value)];
    return selectRow(menu);
  }

  return actionRow(primaryButton(`${prefix}edit`, t('settings.panel.edit')));
}

function controlRows(context, prefix, definition, value) {
  return [
    controlRow(context, prefix, definition, value),
    actionRow(secondaryButton(`${prefix}reset`, context.t('settings.panel.reset'))),
  ];
}

function navigationRow(context, prefix, multiplePages) {
  const buttons = [secondaryButton(`${prefix}up`, '▲'), secondaryButton(`${prefix}down`, '▼')];
  if (multiplePages) {
    buttons.unshift(secondaryButton(`${prefix}left`, '◀'));
    buttons.push(secondaryButton(`${prefix}right`, '▶'));
  }
  buttons.push(dangerButton(`${prefix}close`, context.t('settings.panel.close')));
  return actionRow(...buttons);
}

function tabs(context, groups, page) {
  return groups
    .map((group, index) => {
      const name = categoryName(context, group.key);
      return index === page ? `**${name}**` : name;
    })
    .join('  ·  ');
}

export function requirementNotice(context, definition) {
  const key = `settings.requirements.${definition.requires}`;
  const text = context.t(key);
  return text === key ? null : text;
}

function lockRows(rows) {
  return rows.map((row) => ({ ...row, components: row.components.map((component) => ({ ...component, disabled: true })) }));
}

export function buildView(context, prefix, groups, page, selected, { interactive = true, locked = false } = {}) {
  const { items } = groups[page];
  const item = items[selected];
  const { definition } = item;
  const description = locked ? `⚠️ ${requirementNotice(context, definition) ?? ''}`.trim() : describeSetting(context, definition);
  const rows = interactive ? controlRows(context, prefix, definition, item.value) : [];

  const fields = [
    { name: definition.key, value: padDescription(description ?? '—') },
    { name: context.t('settings.panel.value'), value: richValue(context, definition, item.value), inline: true },
    { name: context.t('settings.panel.default'), value: richValue(context, definition, definition.default), inline: true },
  ];

  const options = {
    title: `⚙️ ${context.t('settings.panel.title')}`,
    fields,
    footer: `${context.t('settings.panel.page', { page: page + 1, pages: groups.length })} · ${selected + 1}/${items.length}`,
    components: interactive
      ? [navigationRow(context, prefix, groups.length > 1), ...(locked ? lockRows(rows) : rows)]
      : [],
  };

  const list = listBlock(context, items, selected, listHeight(groups));
  return { text: `${tabs(context, groups, page)}\n${list}`, options };
}
