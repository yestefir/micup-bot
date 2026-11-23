import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GuildTagStore } from '../src/core/guildtag/store.js';

test('an empty store knows nobody', () => {
  const store = new GuildTagStore(':memory:');
  assert.equal(store.has('g', 'u'), false);
  assert.equal(store.granted('g', 'u'), null);
  assert.equal(store.release('g', 'u'), null);
  assert.deepEqual(store.guildsOf('u'), []);
  assert.equal(store.count('g'), 0);
});

test('recording a member remembers the roles that were given', () => {
  const store = new GuildTagStore(':memory:');
  store.record('g', 'u', ['r1', 'r2']);
  assert.equal(store.has('g', 'u'), true);
  assert.deepEqual(store.granted('g', 'u'), ['r1', 'r2']);
  assert.equal(store.count('g'), 1);
});

test('a member can be recorded without any roles', () => {
  const store = new GuildTagStore(':memory:');
  store.record('g', 'u');
  assert.equal(store.has('g', 'u'), true);
  assert.deepEqual(store.granted('g', 'u'), []);
});

test('recording again replaces the roles but keeps one row', () => {
  const store = new GuildTagStore(':memory:');
  store.record('g', 'u', ['r1']);
  store.record('g', 'u', ['r2', 'r3']);
  assert.deepEqual(store.granted('g', 'u'), ['r2', 'r3']);
  assert.equal(store.count('g'), 1);
});

test('release returns the roles that were given and forgets the member', () => {
  const store = new GuildTagStore(':memory:');
  store.record('g', 'u', ['r1', 'r2']);
  assert.deepEqual(store.release('g', 'u'), ['r1', 'r2']);
  assert.equal(store.has('g', 'u'), false);
  assert.equal(store.release('g', 'u'), null);
  assert.equal(store.count('g'), 0);
});

test('members are kept apart per server and per user', () => {
  const store = new GuildTagStore(':memory:');
  store.record('g1', 'u', ['a']);
  store.record('g2', 'u', ['b']);
  store.record('g1', 'v', ['c']);

  assert.deepEqual(store.guildsOf('u'), ['g1', 'g2']);
  assert.deepEqual(store.guildsOf('v'), ['g1']);
  assert.equal(store.count('g1'), 2);
  assert.equal(store.count('g2'), 1);

  store.release('g1', 'u');
  assert.deepEqual(store.guildsOf('u'), ['g2']);
  assert.deepEqual(store.granted('g1', 'v'), ['c']);
});

test('ids that look like SQL are just ids', () => {
  const store = new GuildTagStore(':memory:');
  store.record("g'; DROP TABLE guild_tag_members; --", 'u', ["r'1"]);
  assert.deepEqual(store.granted("g'; DROP TABLE guild_tag_members; --", 'u'), ["r'1"]);
  assert.equal(store.count("g'; DROP TABLE guild_tag_members; --"), 1);
});

test('the store survives a restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'micup-guildtag-'));
  const file = join(directory, 'guildtag.db');
  try {
    const first = new GuildTagStore(file);
    first.record('g', 'u', ['r1', 'r2']);
    first.close();

    const second = new GuildTagStore(file);
    assert.equal(second.has('g', 'u'), true);
    assert.deepEqual(second.granted('g', 'u'), ['r1', 'r2']);
    assert.deepEqual(second.guildsOf('u'), ['g']);
    second.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
