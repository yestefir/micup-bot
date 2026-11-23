import { TYPES, autoDeleteFor, createEmbed, defaultTitle } from './embed.js';

export function imageFile(buffer, options = {}) {
  const file = { name: options.name ?? 'card.png', data: new Blob([buffer], { type: 'image/png' }) };
  if (options.alt) file.description = options.alt;
  return file;
}

export function messageTarget(message) {
  const deliver = async (payload, reply) => {
    if (!reply) return message.channel.send(payload);
    try {
      return await message.reply(payload);
    } catch {
      return message.channel.send(payload);
    }
  };

  const expire = (sent, ttl) => {
    if (ttl > 0) setTimeout(() => sent.delete().catch(() => {}), ttl).unref();
  };

  return {
    kind: 'message',
    async send(payload, { reply = true, ttl = 0 } = {}) {
      const sent = await deliver(payload, reply);
      expire(sent, ttl);
      return sent;
    },
    async sendImage(file, { reply = true, ttl = 0 } = {}) {
      const sent = await deliver({ files: [file] }, reply);
      expire(sent, ttl);
      return sent;
    },
    edit(sent, payload) {
      return sent.edit(payload);
    },
  };
}

export function interactionTarget(interaction) {
  return {
    kind: 'interaction',
    async send(payload, { ephemeral = true } = {}) {
      if (interaction.deferred) return interaction.editReply(payload);
      if (interaction.replied) return interaction.followUp({ ...payload, ephemeral });
      return interaction.reply({ ...payload, ephemeral });
    },
    async sendImage(file) {
      if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ ephemeral: false });
      const sent = await interaction.followUp({ files: [file], ephemeral: false });
      if (interaction.deferred) {
        await interaction.deleteReply().catch(() => interaction.editReply(file.description ?? '·').catch(() => {}));
      }
      return sent;
    },
    edit(sent, payload) {
      return interaction.editReply(payload);
    },
  };
}

export function attachResponder(context, target) {
  const embedFor = (type, text, options = {}) => {
    const title = options.title === false ? undefined : (options.title ?? defaultTitle(type, context.t));
    return createEmbed({
      type,
      title,
      description: text,
      fields: options.fields,
      footer: options.footer,
      timestamp: options.timestamp,
    });
  };

  const payloadFor = (type, text, options = {}) => {
    const payload = { embeds: [embedFor(type, text, options)] };
    if (options.components !== undefined) payload.components = options.components;
    return payload;
  };

  context.embed = embedFor;

  context.send = async (type, text, options = {}) => {
    const delivery = { ...options };
    if (target.kind === 'message' && delivery.ttl === undefined) delivery.ttl = autoDeleteFor(type);
    const sent = await target.send(payloadFor(type, text, options), delivery);
    return {
      sent,
      edit: (nextType, nextText, nextOptions = {}) => target.edit(sent, payloadFor(nextType, nextText, nextOptions)),
    };
  };

  context.sendImage = (buffer, options = {}) => target.sendImage(imageFile(buffer, options), options);

  for (const type of TYPES) {
    context[type] = (text, options) => context.send(type, text, options);
  }
  return context;
}
