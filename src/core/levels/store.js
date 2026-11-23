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
