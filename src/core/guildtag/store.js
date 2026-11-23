import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export class GuildTagStore {
  #db;

  constructor(file = ':memory:') {
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
    this.#db = new DatabaseSync(file);
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS guild_tag_members (
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        granted TEXT NOT NULL DEFAULT '[]',
        since INTEGER NOT NULL,
        PRIMARY KEY (guild_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS guild_tag_by_user ON guild_tag_members (user_id);
    `);
  }

  has(guildId, userId) {
    return this.#db.prepare('SELECT 1 AS found FROM guild_tag_members WHERE guild_id = ? AND user_id = ?').get(guildId, userId) !== undefined;
  }

  record(guildId, userId, granted = [], now = Date.now()) {
    this.#db
      .prepare(
        `INSERT INTO guild_tag_members (guild_id, user_id, granted, since) VALUES (?, ?, ?, ?)
         ON CONFLICT(guild_id, user_id) DO UPDATE SET granted = excluded.granted`,
      )
      .run(guildId, userId, JSON.stringify(granted), now);
  }

  granted(guildId, userId) {
    const row = this.#db.prepare('SELECT granted FROM guild_tag_members WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
    return row ? JSON.parse(row.granted) : null;
  }

  release(guildId, userId) {
    const granted = this.granted(guildId, userId);
    if (granted === null) return null;
    this.#db.prepare('DELETE FROM guild_tag_members WHERE guild_id = ? AND user_id = ?').run(guildId, userId);
    return granted;
  }

  guildsOf(userId) {
    return this.#db
      .prepare('SELECT guild_id AS guildId FROM guild_tag_members WHERE user_id = ? ORDER BY guild_id')
      .all(userId)
      .map((row) => row.guildId);
  }

  deleteGuild(guildId) {
    this.#db.prepare("DELETE FROM guild_tag_members WHERE guild_id = ?").run(guildId);
  }

  count(guildId) {
    return this.#db.prepare('SELECT COUNT(*) AS total FROM guild_tag_members WHERE guild_id = ?').get(guildId).total;
  }

  close() {
    this.#db.close();
  }
}
