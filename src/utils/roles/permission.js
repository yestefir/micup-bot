import { Permission, hasPermissions } from 'micup.ts';

export function lacksManageRoles(client, guildId) {
  const permissions = client.permissionsFor(guildId, client.user.id);
  return typeof permissions === 'bigint' && !hasPermissions(permissions, Permission.ManageRoles);
}
