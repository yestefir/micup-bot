import { lacksManageRoles } from '../roles/permission.js';

const REASON = 'Auto role';

export async function giveAutoRoles({ app, client, member }) {
  const outcome = { given: [], failed: [], skipped: [] };
  const { logger, settings } = app;
  const guildId = member.guildId;

  if (member.bot) return outcome;

  const configured = settings.get(guildId, 'autorole.roles');
  if (configured.length === 0) return outcome;

  const missing = configured.filter((roleId) => !member.hasRole(roleId));
  outcome.skipped = configured.filter((roleId) => member.hasRole(roleId));
  if (missing.length === 0) return outcome;

  if (lacksManageRoles(client, guildId)) {
    logger.warn(`[autorole] the bot lacks the Manage Roles permission in ${guildId}, ${member.id} got no roles`);
    outcome.failed = missing;
    return outcome;
  }

  const results = await Promise.allSettled(missing.map((roleId) => member.addRole(roleId, { reason: REASON })));
  results.forEach((result, index) => {
    const roleId = missing[index];
    if (result.status === 'fulfilled') {
      outcome.given.push(roleId);
      return;
    }
    outcome.failed.push(roleId);
    logger.warn(`[autorole] could not give role ${roleId} to ${member.id} in ${guildId}: ${result.reason?.message ?? result.reason}`);
  });

  return outcome;
}
