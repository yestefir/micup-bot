export function pingView(context, createdAt) {
  const ms = Math.max(0, Date.now() - new Date(createdAt).getTime());
  return { type: 'info', text: context.t('ping.msg.pong', { ms }) };
}
