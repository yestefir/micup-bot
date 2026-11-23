import { randomUUID } from 'node:crypto';
import { modal, paragraphInput } from 'micup.ts/easy';
import panelConfig from '../../config/general/panel.json' with { type: 'json' };
import { createSession } from '../interaction/session.js';
import { findEditable, settingsPanel } from './panel.js';
import { isLocked } from './requirements.js';
import { buildView, groupByCategory, requirementNotice } from './view.js';

const CHANGING_ACTIONS = new Set(['reset', 'toggle', 'roles', 'choice', 'role', 'channel', 'edit']);
const MODAL_LABEL_LIMIT = 45;
const MODAL_TITLE_LIMIT = 45;
const DEFAULT_TEXT_LENGTH = 200;
const INTEGER_LENGTH = 12;

const clip = (text, max) => Array.from(text).slice(0, max).join('');
const wrap = (index, step, length) => (index + step + length) % length;

export async function openSettingsPanel(context, { actor }) {
  const { client, guildId, settings, t } = context;
  const sessionId = randomUUID().slice(0, 8);
  const prefix = `settings:${sessionId}:`;
  let page = 0;
  const positions = new Map();

  const groups = () =>
    groupByCategory(
      settings.definitions
        .filter((definition) => definition.editable)
        .map((definition) => ({ definition, value: settings.get(guildId, definition.key) })),
    );

  let locked = false;

  const position = (list) => Math.min(positions.get(list[page].key) ?? 0, list[page].items.length - 1);
  const view = (options) => {
    const list = groups();
    return buildView(context, prefix, list, page, position(list), { ...options, locked });
  };
  const refreshLock = async () => {
    const list = groups();
    locked = await isLocked(context, list[page].items[position(list)].definition);
  };
  const payload = () => {
    const { text, options } = view();
    return { embeds: [context.embed('info', text, options)], components: options.components };
  };

  const first = view();
  const panel = await context.send('info', first.text, first.options);

  const closedView = () => {
    const { text, options } = view({ interactive: false });
    return [text, options];
  };

  const form = (definition) => {
    const current = settings.get(guildId, definition.key);
    const input = {
      ...paragraphInput('value', clip(definition.key, MODAL_LABEL_LIMIT)),
      required: true,
      max_length: definition.maxLength ?? (definition.type === 'integer' ? INTEGER_LENGTH : DEFAULT_TEXT_LENGTH),
    };
    if (definition.minLength) input.min_length = definition.minLength;
    if (current !== null && current !== undefined) input.value = String(current);
    return modal(`${prefix}modal:${definition.key}`, clip(t('settings.panel.modalTitle'), MODAL_TITLE_LIMIT), input);
  };

  const rejectWith = (interaction, text) =>
    interaction.reply({ embeds: [context.embed('error', text)], ephemeral: true });

  const focus = (key) => {
    const list = groups();
    const target = list.findIndex((group) => group.items.some((item) => item.definition.key === key));
    if (target === -1) return;
    page = target;
    positions.set(list[target].key, list[target].items.findIndex((item) => item.definition.key === key));
  };

  const handle = async (interaction, rest) => {
    if (session.finished) return;

    if (interaction.user.id !== actor.id) {
      await rejectWith(interaction, t('settings.panel.notYours'));
      return;
    }
    session.touch();

    const separator = rest.indexOf(':');
    const action = separator === -1 ? rest : rest.slice(0, separator);
    const argument = separator === -1 ? '' : rest.slice(separator + 1);
    const list = groups();
    const group = list[page];
    const current = group.items[position(list)].definition;

    const change = async (outcome) => {
      if (outcome.type === 'error') {
        await rejectWith(interaction, outcome.text);
        return;
      }
      await interaction.update(payload());
    };

    if (CHANGING_ACTIONS.has(action) && (await isLocked(context, current))) {
      locked = true;
      await rejectWith(interaction, requirementNotice(context, current) ?? t('errors.generic'));
      return;
    }

    if (action === 'up' || action === 'down') {
      positions.set(group.key, wrap(position(list), action === 'up' ? -1 : 1, group.items.length));
      await refreshLock();
      await interaction.update(payload());
    } else if (action === 'left' || action === 'right') {
      page = wrap(page, action === 'left' ? -1 : 1, list.length);
      await refreshLock();
      await interaction.update(payload());
    } else if (action === 'reset') {
      await change(settingsPanel.reset(context, current.key));
    } else if (action === 'toggle') {
      await change(settingsPanel.set(context, current.key, String(!settings.get(guildId, current.key))));
    } else if (action === 'roles') {
      await change(settingsPanel.set(context, current.key, [...interaction.values]));
    } else if (action === 'choice' || action === 'role' || action === 'channel') {
      await change(settingsPanel.set(context, current.key, interaction.values[0]));
    } else if (action === 'edit') {
      await interaction.showModal(form(current));
    } else if (action === 'modal') {
      const target = findEditable(context, argument);
      if (target && (await isLocked(context, target))) {
        await rejectWith(interaction, requirementNotice(context, target) ?? t('errors.generic'));
        return;
      }
      const raw = (interaction.fields.getTextInputValue('value') ?? '').replace(/\s*[\r\n]+\s*/g, ' ').trim();
      const outcome = target
        ? settingsPanel.set(context, target.key, raw)
        : { type: 'error', text: t('settings.msg.unknownKey', { key: argument }) };
      if (outcome.type === 'error') {
        await rejectWith(interaction, outcome.text);
        return;
      }
      focus(target.key);
      await refreshLock();
      await interaction.deferReply({ ephemeral: true });
      await interaction.deleteReply().catch(() => {});
      const next = view();
      await panel.edit('info', next.text, next.options);
    } else if (action === 'close') {
      session.finish();
      const [text, options] = closedView();
      await interaction.update({ embeds: [context.embed('info', text, options)], components: [] });
    }
  };

  const session = createSession({
    client,
    prefix,
    idleMs: panelConfig.idleSeconds * 1000,
    handle,
    logger: context.app.logger,
    expire: async () => {
      const [text, options] = closedView();
      await panel.edit('info', text, options);
    },
  });

  session.start();
}
