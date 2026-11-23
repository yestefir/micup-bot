import { lacksManageRoles } from '../roles/permission.js';

const REASON = 'Level reward';

export async function giveLevelRewards({ app, client, member, guildId, from, to }) {
  const earned = app.levels.rewards(guildId).filter((reward) => reward.level > from && reward.level <= to);
  const outcome = { given: [], failed: [] };
  if (!member || earned.length === 0) return outcome;

  const missing = earned.map((reward) => reward.roleId).filter((roleId) => !member.hasRole(roleId));
  if (missing.length === 0) return outcome;

  if (lacksManageRoles(client, guildId)) {
    app.logger.warn(`[levels] the bot lacks the Manage Roles permission in ${guildId}, ${member.id} got no reward roles`);
    outcome.failed = missing;
    return outcome;
  }

  const results = await Promise.allSettled(missing.map((roleId) => member.addRole(roleId, { reason: REASON })));
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') outcome.given.push(missing[index]);
    else {
      outcome.failed.push(missing[index]);
      app.logger.warn(`[levels] could not give reward role ${missing[index]} to ${member.id} in ${guildId}: ${result.reason?.message ?? result.reason}`);
    }
  });
  return outcome;
}
