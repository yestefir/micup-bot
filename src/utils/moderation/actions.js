import { MicupAPIError } from 'micup.ts';
import { formatDuration } from '../args/duration.js';
import { postModLog } from './log.js';

const MAX_AUDIT_REASON = 400;

export const result = (type, text, fields) => ({ type, text, fields });

export function auditReason(actor, reason) {
  return `${actor.displayName}: ${reason ?? '-'}`.slice(0, MAX_AUDIT_REASON);
}

function details(context, actor, reason, extra = []) {
  return [
    ...extra,
    { name: context.t('moderation.msg.reason'), value: reason ?? context.t('moderation.msg.noReason'), inline: true },
    { name: context.t('moderation.msg.moderator'), value: `<@${actor.id}>`, inline: true },
  ];
}

export async function guarded(context, action) {
  try {
    return await action();
  } catch (error) {
    if (!(error instanceof MicupAPIError)) throw error;
    if (error.forbidden) return result('error', context.t('moderation.msg.forbidden'));
    if (error.notFound) return result('error', context.t('moderation.msg.notFound'));
    throw error;
  }
}

export const moderation = {
  applyMute(context, { actor, targetId, durationMs, reason }) {
    return guarded(context, async () => {
      await context.client.rest.guilds.timeout(context.guildId, targetId, durationMs, {
        reason: auditReason(actor, reason),
        timeoutReason: reason,
      });

      const duration = formatDuration(durationMs);
      const text = context.t('mute.msg.done', { user: `<@${targetId}>`, duration });
      const extra = [{ name: context.t('moderation.msg.duration'), value: duration, inline: true }];
      const fields = details(context, actor, reason, extra);
      await postModLog(context, { kind: 'mute', actor, targetId, fields });
      return result('success', text, fields);
    });
  },

  applyBan(context, { actor, targetId, reason, deleteSeconds = 0 }) {
    return guarded(context, async () => {
      const audit = auditReason(actor, reason);
      const input = { reason: audit };
      if (deleteSeconds > 0) input.delete_message_seconds = deleteSeconds;
      await context.client.rest.guilds.ban(context.guildId, targetId, input, { reason: audit });

      const cleaned = deleteSeconds > 0 ? formatDuration(deleteSeconds * 1000) : context.t('ban.panel.deleteNone');
      const text = context.t('ban.msg.done', { user: `<@${targetId}>` });
      const extra = [{ name: context.t('ban.msg.deleteField'), value: cleaned, inline: true }];
      const fields = details(context, actor, reason, extra);
      await postModLog(context, { kind: 'ban', actor, targetId, fields });
      return result('success', text, fields);
    });
  },
};
