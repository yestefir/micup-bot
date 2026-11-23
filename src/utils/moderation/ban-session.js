import { randomUUID } from 'node:crypto';
import {
  actionRow,
  dangerButton,
  modal,
  paragraphInput,
  primaryButton,
  secondaryButton,
  selectOption,
  selectRow,
  stringSelect,
} from 'micup.ts/easy';
import moderationConfig from '../../config/general/moderation.json' with { type: 'json' };
import { formatDuration, parseDuration } from '../args/duration.js';
import { createSession } from '../interaction/session.js';
import { guarded, moderation, result } from './actions.js';
import { checkTarget } from './hierarchy.js';

const MAX_DELETE_SECONDS = 7 * 24 * 60 * 60;

export const DELETE_WINDOWS = moderationConfig.banDeleteWindows.map((entry) => {
  if (entry === 'none') return 0;
  const milliseconds = parseDuration(entry);
  const seconds = milliseconds === null ? null : milliseconds / 1000;
  if (seconds === null || seconds > MAX_DELETE_SECONDS) throw new Error(`Invalid ban delete window in moderation.json: ${entry}`);
  return seconds;
});

export async function startBanSession(context, { actor, targetId }) {
  const { client, guildId, t } = context;
  const active = context.app.banSessions;
  const key = `${guildId}:${targetId}`;

  if (active.has(key)) {
    await context.warning(t('ban.panel.busy'));
    return;
  }

  active.add(key);
  const idleMs = context.settings.get(guildId, 'ban.sessionSeconds') * 1000;
  const seconds = idleMs / 1000;
  const prefix = `ban:${randomUUID().slice(0, 8)}:`;
  const title = `🔨 ${t('ban.panel.title')}`;
  const state = { deleteSeconds: null };

  const labelFor = (windowSeconds) => (windowSeconds === 0 ? t('ban.panel.deleteNone') : formatDuration(windowSeconds * 1000));
  const cancelButton = dangerButton(`${prefix}cancel`, t('ban.panel.cancelButton'));

  const view = (deleteSeconds) =>
    deleteSeconds === null
      ? {
          text: t('ban.panel.chooseDelete', { user: `<@${targetId}>`, seconds }),
          components: [
            selectRow(stringSelect(`${prefix}delete`, ...DELETE_WINDOWS.map((window) => selectOption(labelFor(window), String(window))))),
            actionRow(cancelButton),
          ],
        }
      : {
          text: t('ban.panel.chooseReason', { deleted: labelFor(deleteSeconds), seconds }),
          components: [
            actionRow(
              primaryButton(`${prefix}reason`, t('ban.panel.reasonButton')),
              secondaryButton(`${prefix}none`, t('ban.panel.noReasonButton')),
              cancelButton,
            ),
          ],
        };

  const payloadFor = (deleteSeconds) => {
    const { text, components } = view(deleteSeconds);
    return { embeds: [context.embed('warning', text, { title })], components };
  };

  let panel;
  try {
    const blocked = await guarded(context, async () => {
      const code = await checkTarget({ client, guildId, actor, targetId });
      return code ? result('error', t(`moderation.msg.${code}`)) : null;
    });

    if (blocked) {
      active.delete(key);
      await context.send(blocked.type, blocked.text);
      return;
    }

    const first = view(null);
    panel = await context.send('warning', first.text, { title, components: first.components });
  } catch (error) {
    active.delete(key);
    throw error;
  }

  const end = () => {
    const ended = session.finish();
    if (ended) active.delete(key);
    return ended;
  };

  const complete = async (reason) => {
    end();
    const outcome = await moderation.applyBan(context, { actor, targetId, reason, deleteSeconds: state.deleteSeconds });
    await panel.edit(outcome.type, outcome.text, { fields: outcome.fields, components: [] });
  };

  const handle = async (interaction, action) => {
    if (session.finished) return;

    if (interaction.user.id !== actor.id) {
      await interaction.reply({ embeds: [context.embed('error', t('ban.panel.notYours'))], ephemeral: true });
      return;
    }

    const chosen = state.deleteSeconds !== null;
    if (action === 'delete' && chosen) return;
    if (action !== 'cancel' && action !== 'delete' && !chosen) return;
    session.touch();

    if (action === 'delete') {
      const window = Number(interaction.values[0]);
      if (!DELETE_WINDOWS.includes(window)) return;
      state.deleteSeconds = window;
      await interaction.update(payloadFor(window));
    } else if (action === 'reason') {
      const form = modal(`${prefix}modal`, t('ban.panel.modalTitle'), paragraphInput('reason', t('ban.panel.reasonLabel')));
      await interaction.showModal(form);
    } else if (action === 'none') {
      await interaction.deferUpdate();
      await complete(undefined);
    } else if (action === 'modal') {
      await interaction.deferReply({ ephemeral: true });
      await interaction.deleteReply().catch(() => {});
      const reason = interaction.fields.getTextInputValue('reason')?.trim();
      await complete(reason || undefined);
    } else if (action === 'cancel') {
      end();
      await interaction.update({ embeds: [context.embed('info', t('ban.panel.cancelled'), { title })], components: [] });
    }
  };

  const session = createSession({
    client,
    prefix,
    idleMs,
    handle,
    logger: context.app.logger,
    expire: async () => {
      active.delete(key);
      await panel.edit('info', t('ban.panel.expired'), { title, components: [] });
    },
  });

  session.start();
}
