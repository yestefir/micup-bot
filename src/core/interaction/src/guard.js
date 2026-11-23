import { hasPermissions, permissionNames } from 'micup.ts';

function labels(context, bits) {
  return permissionNames(bits)
    .map((name) => {
      const key = `permissions.${name}`;
      const text = context.t(key);
      return text === key ? name : text;
    })
    .join(', ');
}

export function checkAccess(command, { client, guildId, channelId, member, context }) {
  if (command.guildOnly && !guildId) return context.t('errors.guildOnly');

  if (command.permission) {
    const allowed = member?.hasPermission(command.permission, channelId) ?? false;
    if (!allowed) {
      return context.t('errors.missingPermission', { permission: labels(context, command.permission) });
    }
  }

  if (command.botPermission && guildId) {
    const bits = client.permissionsFor(guildId, client.user.id, channelId);
    if (typeof bits === 'bigint' && !hasPermissions(bits, command.botPermission)) {
      return context.t('errors.botMissingPermission', { permission: labels(context, command.botPermission) });
    }
  }

  return null;
}
