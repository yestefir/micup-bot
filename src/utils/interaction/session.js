export function createSession({ client, prefix, idleMs, handle, expire, logger }) {
  let finished = false;
  let timer = null;
  let queue = Promise.resolve();

  const run = (task) => {
    queue = queue.then(task).catch((error) => {
      logger.error('[session] error:', error);
    });
  };

  const finish = () => {
    if (finished) return false;
    finished = true;
    clearTimeout(timer);
    client.off('interactionCreate', listener);
    return true;
  };

  const touch = () => {
    clearTimeout(timer);
    timer = setTimeout(() => run(async () => {
      if (finish()) await expire();
    }), idleMs);
    timer.unref?.();
  };

  function listener(interaction) {
    const id = interaction.customId;
    if (typeof id !== 'string' || !id.startsWith(prefix)) return;
    run(() => handle(interaction, id.slice(prefix.length)));
  }

  return {
    start() {
      client.on('interactionCreate', listener);
      touch();
    },
    touch,
    finish,
    get finished() {
      return finished;
    },
  };
}
