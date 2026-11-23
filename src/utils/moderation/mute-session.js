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
import { auditReason, guarded, moderation, result } from './actions.js';
import { checkTarget } from './hierarchy.js';

const DURATIONS = moderationConfig.muteDurations.map((text) => {
  const milliseconds = parseDuration(text);
  if (milliseconds === null) throw new Error(`Invalid mute duration in moderation.json: ${text}`);
  return milliseconds;
});

export async function startMuteSession(context, { actor, targetId }) {
  const { client, guildId, t } = context;
  const active = context.app.muteSessions;
  const key = `${guildId}:${targetId}`;

  if (active.has(key)) {
    await context.warning(t('mute.panel.busy'));
    return;
  }

  active.add(key);
  const sessionMs = context.settings.get(guildId, 'mute.sessionSeconds') * 1000;
  const seconds = sessionMs / 1000;
  const sessionId = randomUUID().slice(0, 8);
  const prefix = `mute:${sessionId}:`;
  const title = `🔇 ${t('mute.panel.title')}`;

  const holdTimeout = () =>
    client.rest.guilds.timeout(guildId, targetId, sessionMs, { reason: auditReason(actor, 'mute pending') });
  const releaseTimeout = () =>
    client.rest.guilds.clearTimeout(guildId, targetId, { reason: auditReason(actor, 'mute cancelled') }).catch(() => {});

  const durationRow = () =>
    selectRow(
      stringSelect(
        `${prefix}duration`,
        ...DURATIONS.map((milliseconds) => selectOption(formatDuration(milliseconds), String(milliseconds))),
      ),
    );
  const cancelButton = dangerButton(`${prefix}cancel`, t('mute.panel.cancelButton'));

  const view = (durationMs) =>
    durationMs === null
      ? {
          text: t('mute.panel.chooseDuration', { user: `<@${targetId}>`, seconds }),
          components: [durationRow(), actionRow(cancelButton)],
        }
      : {
          text: t('mute.panel.chooseReason', { duration: formatDuration(durationMs), seconds }),
          components: [
            actionRow(
              primaryButton(`${prefix}reason`, t('mute.panel.reasonButton')),
              secondaryButton(`${prefix}none`, t('mute.panel.noReasonButton')),
              cancelButton,
            ),
          ],
        };

  const payloadFor = (durationMs) => {
    const { text, components } = view(durationMs);
    return { embeds: [context.embed('info', text, { title })], components };
  };

  let panel;
  try {
    const blocked = await guarded(context, async () => {
      const code = await checkTarget({
        client,
        guildId,
        actor,
        targetId,
        requireMember: true,
        rejectMuted: true,
        rejectBots: true,
      });
      if (code) return result('error', t(`moderation.msg.${code}`));
      await holdTimeout();
      return null;
    });

    if (blocked) {
      active.delete(key);
      await context.send(blocked.type, blocked.text);
      return;
    }

    const first = view(null);
    try {
      panel = await context.send('info', first.text, { title, components: first.components });
    } catch (error) {
      await releaseTimeout();
      throw error;
    }
  } catch (error) {
    active.delete(key);
    throw error;
  }

  const session = { durationMs: null, finished: false, timer: null, queue: Promise.resolve() };

  const run = (task) => {
    session.queue = session.queue.then(task).catch((error) => {
      context.app.logger.error('[mute] session error:', error);
    });
  };

  const finish = () => {
    session.finished = true;
    clearTimeout(session.timer);
    client.off('interactionCreate', listener);
    active.delete(key);
  };

  const touch = () => {
    clearTimeout(session.timer);
    session.timer = setTimeout(() => run(expire), sessionMs);
    session.timer.unref?.();
  };

  const expire = async () => {
    if (session.finished) return;
    finish();
    await releaseTimeout();
    await panel.edit('warning', t('mute.panel.expired'), { title, components: [] });
  };

  const complete = async (reason) => {
    finish();
    const outcome = await moderation.applyMute(context, {
      actor,
      targetId,
      durationMs: session.durationMs,
      reason,
    });
    if (outcome.type !== 'success') await releaseTimeout();
    await panel.edit(outcome.type, outcome.text, { fields: outcome.fields, components: [] });
  };

  const handle = async (interaction, action) => {
    if (session.finished) return;

    if (interaction.user.id !== actor.id) {
      await interaction.reply({ embeds: [context.embed('error', t('mute.panel.notYours'))], ephemeral: true });
      return;
    }

    const chosen = session.durationMs !== null;
    if (action === 'duration' && chosen) return;
    if (action !== 'cancel' && action !== 'duration' && !chosen) return;
    touch();

    if (action === 'duration') {
      const durationMs = Number(interaction.values[0]);
      if (!DURATIONS.includes(durationMs)) return;
      session.durationMs = durationMs;
      await interaction.update(payloadFor(durationMs));
      await holdTimeout();
    } else if (action === 'reason') {
      const form = modal(`${prefix}modal`, t('mute.panel.modalTitle'), paragraphInput('reason', t('mute.panel.reasonLabel')));
      await interaction.showModal(form);
      await holdTimeout();
    } else if (action === 'none') {
      await interaction.deferUpdate();
      await complete(undefined);
    } else if (action === 'modal') {
      await interaction.deferReply({ ephemeral: true });
      await interaction.deleteReply().catch(() => {});
      const reason = interaction.fields.getTextInputValue('reason')?.trim();
      await complete(reason || undefined);
    } else if (action === 'cancel') {
      finish();
      try {
        const next = context.embed('warning', t('mute.panel.cancelled'), { title });
        await interaction.update({ embeds: [next], components: [] });
      } finally {
        await releaseTimeout();
      }
    }
  };

  function listener(interaction) {
    const id = interaction.customId;
    if (typeof id !== 'string' || !id.startsWith(prefix)) return;
    run(() => handle(interaction, id.slice(prefix.length)));
  }

  client.on('interactionCreate', listener);
  touch();
}
