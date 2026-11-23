export function pingView(context, createdAt) {
  const sent = new Date(createdAt).getTime();
  const ms = Number.isFinite(sent) ? Math.max(0, Date.now() - sent) : 0;
  return { type: 'info', text: context.t('ping.msg.pong', { ms }) };
}
