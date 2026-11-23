import { MicupAPIError } from 'micup.ts';
import { createContext } from '../../core/interaction/src/context.js';
import { createEmbed } from '../message/embed.js';
import { lacksManageRoles } from '../roles/permission.js';

const REASON_GIVEN = 'Guild tag';
const REASON_TAKEN = 'Guild tag removed';

const mentions = (roleIds) => roleIds.map((id) => `<@&${id}>`).join(' ');
const messageOf = (reason) => reason?.message ?? String(reason);
const isMissing = (error) => error instanceof MicupAPIError && error.notFound;

function serial(app, key, task) {
  const previous = app.guildTagQueue.get(key) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(task);
  app.guildTagQueue.set(key, next);
  next.finally(() => {
    if (app.guildTagQueue.get(key) === next) app.guildTagQueue.delete(key);
  }).catch(() => {});
  return next;
}

async function giveRoles({ app, client, guildId, userId, roleIds }) {
  const outcome = { given: [], failed: [] };
  if (roleIds.length === 0) return outcome;

  if (lacksManageRoles(client, guildId)) {
    app.logger.warn(`[guildtag] the bot lacks the Manage Roles permission in ${guildId}, ${userId} got no roles`);
    outcome.failed = [...roleIds];
    return outcome;
  }

  const results = await Promise.allSettled(
    roleIds.map((roleId) => client.rest.guilds.addMemberRole(guildId, userId, roleId, { reason: REASON_GIVEN })),
  );
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      outcome.given.push(roleIds[index]);
      return;
    }
    outcome.failed.push(roleIds[index]);
    app.logger.warn(`[guildtag] could not give role ${roleIds[index]} to ${userId} in ${guildId}: ${messageOf(result.reason)}`);
  });
  return outcome;
}

async function takeRoles({ app, client, guildId, userId, roleIds }) {
  const outcome = { removed: [], failed: [] };
  if (roleIds.length === 0) return outcome;

  if (lacksManageRoles(client, guildId)) {
    app.logger.warn(`[guildtag] the bot lacks the Manage Roles permission in ${guildId}, ${userId} kept ${roleIds.length} roles`);
    outcome.failed = [...roleIds];
    return outcome;
  }

  const results = await Promise.allSettled(
    roleIds.map((roleId) => client.rest.guilds.removeMemberRole(guildId, userId, roleId, { reason: REASON_TAKEN })),
  );
  results.forEach((result, index) => {
    if (result.status === 'fulfilled' || isMissing(result.reason)) {
      outcome.removed.push(roleIds[index]);
      return;
    }
    outcome.failed.push(roleIds[index]);
    app.logger.warn(`[guildtag] could not take role ${roleIds[index]} from ${userId} in ${guildId}: ${messageOf(result.reason)}`);
  });
  return outcome;
}

async function postLog({ app, client, guildId, userId, kind, roles, failed, tag }) {
  const channelId = app.settings.get(guildId, 'guildtag.logChannel');
  if (!channelId) return;

  const context = createContext(app, client, { guildId });
  const fields = [];
  if (tag) fields.push({ name: context.t('guildtag.log.tag'), value: `**${tag}**`, inline: true });
  if (roles.length > 0) {
    const name = context.t(kind === 'adopted' ? 'guildtag.log.rolesGiven' : 'guildtag.log.rolesRemoved');
    fields.push({ name, value: mentions(roles) });
  }
  if (failed.length > 0) fields.push({ name: context.t('guildtag.log.rolesFailed'), value: mentions(failed) });

  const embed = createEmbed({
    type: kind === 'adopted' ? 'success' : 'warning',
    title: `🏷️ ${context.t(`guildtag.log.${kind}Title`)}`,
    description: context.t(`guildtag.log.${kind}`, { user: `<@${userId}>` }),
    fields,
    timestamp: new Date().toISOString(),
  });

  try {
    const channel = client.channels.get(channelId) ?? (await client.channels.fetch(channelId));
    if (!channel || channel.guildId !== guildId) throw new Error('the log channel does not belong to this server');
    await channel.send({ embeds: [embed], allowed_mentions: { parse: [] } });
  } catch (error) {
    app.logger.warn(`[guildtag] could not post the log in channel ${channelId}: ${messageOf(error)}`);
  }
}

async function heldRoles({ client, guildId, userId, known }) {
  if (known) return known;
  try {
    return (await client.rest.guilds.member(guildId, userId)).roles ?? [];
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

async function adopt({ app, client, guildId, user, knownRoles }) {
  const { settings, guildTags } = app;
  const guild = client.guilds.get(guildId);
  if (!guild) return null;

  const configured = settings.get(guildId, 'guildtag.roles');
  if (configured.length === 0 && !settings.get(guildId, 'guildtag.logChannel')) return null;

  const held = await heldRoles({ client, guildId, userId: user.id, known: knownRoles });
  if (held === null) return null;

  const missing = configured.filter((roleId) => !held.includes(roleId));
  const { given, failed } = await giveRoles({ app, client, guildId, userId: user.id, roleIds: missing });
  guildTags.record(guildId, user.id, given);
  await postLog({ app, client, guildId, userId: user.id, kind: 'adopted', roles: given, failed, tag: guild.raw?.guild_tag });
  return { given, failed };
}

async function release({ app, client, guildId, user }) {
  const { settings, guildTags } = app;
  const granted = guildTags.release(guildId, user.id) ?? [];
  const guild = client.guilds.get(guildId);
  if (!guild) return null;

  const removeRoles = settings.get(guildId, 'guildtag.removeRoles');
  const { removed, failed } = removeRoles
    ? await takeRoles({ app, client, guildId, userId: user.id, roleIds: granted })
    : { removed: [], failed: [] };
  await postLog({ app, client, guildId, userId: user.id, kind: 'removed', roles: removed, failed, tag: guild.raw?.guild_tag });
  return { removed, failed };
}

export function handleTagUpdate({ app, client, user, eventGuildId, roles }) {
  if (!user?.id || user.bot === true || !Object.hasOwn(user, 'tag_guild_id')) return Promise.resolve(null);

  return serial(app, user.id, async () => {
    const current = user.tag_guild_id || null;
    const report = (stage, guildId) => (error) =>
      app.logger.warn(`[guildtag] ${stage} failed for ${user.id} in ${guildId}: ${messageOf(error)}`);

    if (current && !app.guildTags.has(current, user.id)) {
      const knownRoles = eventGuildId === current ? roles : undefined;
      await adopt({ app, client, guildId: current, user, knownRoles }).catch(report('adopting the tag', current));
    }

    for (const guildId of app.guildTags.guildsOf(user.id)) {
      if (guildId === current) continue;
      await release({ app, client, guildId, user }).catch(report('removing the tag', guildId));
    }
  });
}
