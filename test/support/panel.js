import { INVISIBLE } from '../../src/utils/settings/view.js';
import { GUILD, body, click, createMessage, settle, submit } from './fakes.js';

export const row = (key, value, arrow, width) => `${arrow ? '→' : ' '} ${key.padEnd(width)}  ${value}`;

export async function openPanel(world, { actor = 'A', content = '!settings', permissions } = {}) {
  const message = createMessage(world, content, actor, permissions);
  await world.interactions.prefix.handleMessage(message);
  await settle();
  const panel = message.replies[0];
  const sessionId = panel?.components?.[0]?.components?.[0]?.custom_id?.split(':')[1];

  const press = async (action, options) => {
    const interaction = click(`settings:${sessionId}:${action}`, options);
    world.client.emit('interactionCreate', interaction);
    await settle();
    return interaction;
  };
  const send = async (key, value, options) => {
    const interaction = submit(`settings:${sessionId}:modal:${key}`, value, options);
    world.client.emit('interactionCreate', interaction);
    await settle();
    return interaction;
  };
  const step = async (action, times = 1) => {
    let last;
    for (let index = 0; index < times; index += 1) last = await press(action);
    return last.log.updates[0];
  };

  return {
    message,
    panel,
    sessionId,
    press,
    send,
    down: (times) => step('down', times),
    up: (times) => step('up', times),
    right: (times) => step('right', times),
    left: (times) => step('left', times),
  };
}

export const tabsOf = (payload) => body(payload).split('\n')[0];
export const rawLines = (payload) => body(payload).split('\n').slice(2, -1);
export const lines = (payload) => rawLines(payload).filter((line) => line !== INVISIBLE);
export const PADDED = (text) => `${text}\n${INVISIBLE}`;
export const controls = (payload) => payload.components.map((components) => components.components);
export const actionsOf = (components) => components.map((component) => component.custom_id.split(':').slice(2).join(':'));
export const field = (payload, index) => payload.embeds[0].fields[index];
export const footerOf = (payload) => payload.embeds[0].footer.text;
export const valueOf = (world, key) => world.app.settings.get(GUILD, key);

export const PAGE_NAMES = {
  tr: ['Genel', 'Seviye', 'Moderasyon', 'Otomatik rol', 'Sunucu etiketi'],
  'en-US': ['General', 'Levels', 'Moderation', 'Auto role', 'Server tag'],
};

export const PAGE_COUNT = PAGE_NAMES.tr.length;

export const tabs = (active, { lang = 'tr', extra = [] } = {}) =>
  [...PAGE_NAMES[lang], ...extra].map((name, index) => (index === active ? `**${name}**` : name)).join('  ·  ');
