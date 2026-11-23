import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export class LevelStore {
  #db;

  constructor(file = ':memory:') {
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
    this.#db = new DatabaseSync(file);
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS levels (
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        xp INTEGER NOT NULL DEFAULT 0,
        messages INTEGER NOT NULL DEFAULT 0,
        last_gain INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (guild_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS levels_ranking ON levels (guild_id, xp DESC, user_id ASC);
      CREATE TABLE IF NOT EXISTS level_rewards (
        guild_id TEXT NOT NULL,
        level INTEGER NOT NULL,
        role_id TEXT NOT NULL,
        PRIMARY KEY (guild_id, level)
      );
      CREATE TABLE IF NOT EXISTS xp_ignored_channels (
        guild_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        PRIMARY KEY (guild_id, channel_id)
      );
    `);
  }

  get(guildId, userId) {
    const row = this.#db
      .prepare('SELECT xp, messages, last_gain AS lastGain FROM levels WHERE guild_id = ? AND user_id = ?')
      .get(guildId, userId);
    return row ? { xp: row.xp, messages: row.messages, lastGain: row.lastGain } : null;
  }

  addMessageXp(guildId, userId, amount, now) {
    const row = this.#db
      .prepare(
        `INSERT INTO levels (guild_id, user_id, xp, messages, last_gain) VALUES (?, ?, ?, 1, ?)
         ON CONFLICT(guild_id, user_id) DO UPDATE SET
           xp = xp + excluded.xp,
           messages = messages + 1,
           last_gain = excluded.last_gain
         RETURNING xp`,
      )
      .get(guildId, userId, amount, now);
    return row.xp;
  }

  adjustXp(guildId, userId, delta) {
    return this.#db
      .prepare(
        `INSERT INTO levels (guild_id, user_id, xp) VALUES (?, ?, MAX(0, ?))
         ON CONFLICT(guild_id, user_id) DO UPDATE SET xp = MAX(0, xp + ?)
         RETURNING xp`,
      )
      .get(guildId, userId, delta, delta).xp;
  }

  resetXp(guildId, userId) {
    return this.#db.prepare("DELETE FROM levels WHERE guild_id = ? AND user_id = ?").run(guildId, userId).changes > 0;
  }

  setReward(guildId, level, roleId) {
    this.#db
      .prepare("INSERT INTO level_rewards (guild_id, level, role_id) VALUES (?, ?, ?) ON CONFLICT(guild_id, level) DO UPDATE SET role_id = excluded.role_id")
      .run(guildId, level, roleId);
  }

  removeReward(guildId, level) {
    return this.#db.prepare("DELETE FROM level_rewards WHERE guild_id = ? AND level = ?").run(guildId, level).changes > 0;
  }

  rewards(guildId) {
    return this.#db
      .prepare("SELECT level, role_id AS roleId FROM level_rewards WHERE guild_id = ? ORDER BY level")
      .all(guildId)
      .map((row) => ({ level: row.level, roleId: row.roleId }));
  }

  isIgnored(guildId, channelId) {
    return this.#db.prepare("SELECT 1 AS found FROM xp_ignored_channels WHERE guild_id = ? AND channel_id = ?").get(guildId, channelId) !== undefined;
  }

  toggleIgnored(guildId, channelId) {
    if (this.isIgnored(guildId, channelId)) {
      this.#db.prepare("DELETE FROM xp_ignored_channels WHERE guild_id = ? AND channel_id = ?").run(guildId, channelId);
      return false;
    }
    this.#db.prepare("INSERT INTO xp_ignored_channels (guild_id, channel_id) VALUES (?, ?)").run(guildId, channelId);
    return true;
  }

  ignored(guildId) {
    return this.#db
      .prepare("SELECT channel_id AS channelId FROM xp_ignored_channels WHERE guild_id = ? ORDER BY channel_id")
      .all(guildId)
      .map((row) => row.channelId);
  }

  deleteGuild(guildId) {
    for (const table of ["levels", "level_rewards", "xp_ignored_channels"]) {
      this.#db.prepare(`DELETE FROM ${table} WHERE guild_id = ?`).run(guildId);
    }
  }

  rankOf(guildId, userId) {
    const current = this.get(guildId, userId);
    if (!current) return null;
    const row = this.#db
      .prepare(
        `SELECT COUNT(*) + 1 AS position FROM levels
         WHERE guild_id = ? AND (xp > ? OR (xp = ? AND user_id < ?))`,
      )
      .get(guildId, current.xp, current.xp, userId);
    return row.position;
  }

  top(guildId, limit, offset = 0) {
    return this.#db
      .prepare(
        `SELECT user_id AS userId, xp, messages FROM levels
         WHERE guild_id = ? ORDER BY xp DESC, user_id ASC LIMIT ? OFFSET ?`,
      )
      .all(guildId, limit, offset)
      .map((row) => ({ userId: row.userId, xp: row.xp, messages: row.messages }));
  }

  count(guildId) {
    return this.#db.prepare('SELECT COUNT(*) AS total FROM levels WHERE guild_id = ?').get(guildId).total;
  }

  close() {
    this.#db.close();
  }
}
