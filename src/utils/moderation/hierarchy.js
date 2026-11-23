import { MicupAPIError } from 'micup.ts';

const rankOf = (roleIds, positions) => roleIds.reduce((top, id) => Math.max(top, positions.get(id) ?? 0), 0);

async function fetchMember(guilds, guildId, userId) {
  try {
    return await guilds.member(guildId, userId);
  } catch (error) {
    if (error instanceof MicupAPIError && error.notFound) return null;
    throw error;
  }
}

export async function checkTarget({
  client,
  guildId,
  actor,
  targetId,
  requireMember = false,
  rejectMuted = false,
  rejectBots = false,
}) {
  if (targetId === actor.id) return 'self';
  if (targetId === client.user.id) return 'bot';

  const { guilds } = client.rest;
  const [guild, roles, target, self] = await Promise.all([
    guilds.get(guildId),
    guilds.roles(guildId),
    fetchMember(guilds, guildId, targetId),
    guilds.member(guildId, client.user.id),
  ]);

  if (!target) return requireMember ? 'notMember' : null;
  if (rejectBots && target.user?.bot === true) return 'targetBot';
  if (targetId === guild.owner_id) return 'owner';

  const positions = new Map(roles.map((role) => [role.id, role.position]));
  const targetRank = rankOf(target.roles, positions);
  if (actor.id !== guild.owner_id && rankOf(actor.roles, positions) <= targetRank) return 'actorHierarchy';
  if (rankOf(self.roles, positions) <= targetRank) return 'botHierarchy';

  const mutedUntil = target.communication_disabled_until;
  if (rejectMuted && mutedUntil && Date.parse(mutedUntil) > Date.now()) return 'alreadyMuted';
  return null;
}
