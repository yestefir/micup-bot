import { VoiceRoom } from '@micup.ts/voice';
import { ChannelType, hasPermissions, Permission } from 'micup.ts';

export const VOICE_CHANNEL_SETTING = 'voice.channel';
const VOICE_PERMISSIONS = Permission.ViewChannel | Permission.Connect;

export class VoiceChannelError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export class VoiceChannels {
  #active = new Map();
  #pending = new Map();
  #closing = false;

  constructor({ settings, logger }, connectRoom = (grant, options) => VoiceRoom.connect(grant, options)) {
    this.settings = settings;
    this.logger = logger;
    this.connectRoom = connectRoom;
  }

  change(client, guildId, raw) {
    return this.#run(guildId, async () => {
      const channelId = raw === null ? null : this.settings.parse(VOICE_CHANNEL_SETTING, raw);
      const previous = this.settings.get(guildId, VOICE_CHANNEL_SETTING);
      try {
        await this.#apply(client, guildId, channelId);
        if (channelId === null) this.settings.reset(guildId, VOICE_CHANNEL_SETTING);
        else this.settings.set(guildId, VOICE_CHANNEL_SETTING, channelId);
      } catch (error) {
        if (this.#active.get(guildId)?.channelId !== (previous ?? undefined)) {
          await this.#apply(client, guildId, previous).catch(() => this.#warn(guildId, 'restore failed'));
        }
        throw error;
      }
    });
  }

  restore(client, guildId) {
    if (this.#closing) return;
    return this.#run(guildId, async () => {
      const channelId = this.settings.get(guildId, VOICE_CHANNEL_SETTING);
      if (channelId) await this.#apply(client, guildId, channelId);
    }).catch(() => this.#warn(guildId, 'restore failed'));
  }

  async restoreConfigured(client) {
    if (this.#closing) return;
    for (const guildId of this.settings.scopesFor(VOICE_CHANNEL_SETTING)) {
      const guild = client.guilds.get(guildId);
      if (guild && !guild.raw?.unavailable && client.sessionFor(guildId)?.ready) {
        await this.restore(client, guildId);
      }
    }
  }

  forget(guildId) {
    if (this.#closing) return;
    return this.#run(guildId, async () => {
      const entry = this.#active.get(guildId);
      if (!entry) return;
      this.#active.delete(guildId);
      await entry.room.close().catch(() => this.#warn(guildId, 'room cleanup failed'));
    });
  }

  async close() {
    this.#closing = true;
    await Promise.allSettled(this.#pending.values());
    await Promise.all([...this.#active].map(async ([guildId, entry]) => {
      try {
        await this.#disconnect(guildId, entry);
      } catch {
        await entry.room.close().catch(() => {});
        this.#warn(guildId, 'shutdown cleanup failed');
      }
    }));
  }

  #run(guildId, task) {
    if (this.#closing) return Promise.reject(new VoiceChannelError('unavailable'));
    const next = (this.#pending.get(guildId) ?? Promise.resolve()).catch(() => {}).then(task);
    this.#pending.set(guildId, next);
    return next.finally(() => {
      if (this.#pending.get(guildId) === next) this.#pending.delete(guildId);
    });
  }

  async #apply(client, guildId, channelId) {
    const current = this.#active.get(guildId);
    const session = client.sessionFor(guildId);
    if (channelId === null) {
      if (current) {
        await this.#disconnect(guildId, current);
      } else if (session?.ready) {
        const grant = session.voice(guildId);
        if (grant) await session.leaveVoice(guildId, grant.connection_id);
      }
      return;
    }

    if (!session?.ready) throw new VoiceChannelError('unavailable');
    if (current?.channelId === channelId && current.room.connected &&
        current.session === session && session.voice(guildId)?.connection_id === current.connectionId) return;

    const channel = client.channels.get(channelId) ?? await client.channels.fetch(channelId).catch((error) => {
      if (error.status === 404 || error.status === 403) throw new VoiceChannelError('invalidChannel');
      throw error;
    });
    if (channel?.type !== ChannelType.GuildVoice || channel.guildId !== guildId) {
      throw new VoiceChannelError('invalidChannel');
    }
    const permissions = client.permissionsFor(guildId, client.user.id, channelId);
    if (typeof permissions === 'bigint' && !hasPermissions(permissions, VOICE_PERMISSIONS)) {
      throw new VoiceChannelError('missingPermissions');
    }

    if (current) await this.#disconnect(guildId, current);
    const grant = await session.joinVoice(guildId, channelId, { selfMute: true, selfDeaf: true }).catch((error) => {
      if (error.code === 'VOICE_P2P_CONSENT_REQUIRED' || error.code === 'VOICE_P2P_UNAVAILABLE') {
        throw new VoiceChannelError('unsupportedChannel');
      }
      throw error;
    });
    try {
      if (grant.p2p || grant.e2ee_key) throw new VoiceChannelError('unsupportedChannel');
      const room = await this.connectRoom(grant, { publishOnConnect: false });
      const entry = { room, session, channelId, connectionId: grant.connection_id };
      this.#active.set(guildId, entry);
      room.on('disconnected', () => {
        if (this.#closing) return;
        return this.#run(guildId, async () => {
          if (this.#active.get(guildId) === entry) await this.#disconnect(guildId, entry);
        }).catch(() => this.#warn(guildId, 'disconnect cleanup failed'));
      });
    } catch (error) {
      await session.leaveVoice(guildId, grant.connection_id).catch(() => this.#warn(guildId, 'join cleanup failed'));
      throw error;
    }
  }

  async #disconnect(guildId, entry) {
    if (entry.session.ready) await entry.session.leaveVoice(guildId, entry.connectionId);
    this.#active.delete(guildId);
    await entry.room.close().catch(() => this.#warn(guildId, 'room cleanup failed'));
  }

  #warn(guildId, text) {
    this.logger.warn('[voice] ' + text + ' in ' + guildId);
  }
}
