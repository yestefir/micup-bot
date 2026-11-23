import { hash } from 'node:crypto';
import { hasPermissions, Permission } from 'micup.ts';
import { parse as parseDomain } from 'tldts-icann';
import { createContext } from '../../core/interaction/src/context.js';
import { attachResponder, messageTarget } from '../message/response.js';

const LINKS = /https?:\/\/(?:\[[\da-f:.]+\])?[^\s<>"\x60()[\]{},]*|(?<![\p{L}\p{N}_.@/-])(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?\.)+(?:xn--[a-z\d-]+|\p{L}{2,63})(?![\p{L}\p{N}_@-])(?::\d+)?(?:[/?#][^\s<>"\x60()[\]{},]*)?/giu;
const REPEAT_WINDOW = 10_000;
const RATE_WINDOW = 5_000;
const RATE_LIMIT = 6;
const REPEAT_LIMIT = 3;
const HISTORY_LIMIT = 5_000;
const BYPASS_PERMISSIONS = Permission.ManageMessages | Permission.ManageGuild | Permission.Administrator;

function linkHost(link) {
  const explicit = /^https?:\/\//i.test(link);
  const address = explicit ? link : 'https://' + link;
  const host = URL.parse(address.replace(/[.,!?;:]+$/, ''))?.hostname.replace(/\.$/, '');
  if (host && (explicit || parseDomain(host, { extractHostname: false }).isIcann)) return host;
  return null;
}

function advertisement(message, settings, hosts, permissions) {
  if (hosts.includes('media.micup.gg') && !hasPermissions(permissions, Permission.AttachFiles)) {
    return 'mediaPermission';
  }

  const exempt = settings.get(message.guildId, 'automod.adExemptChannels');
  if (exempt.includes(message.channelId) || exempt.includes(message.channel?.parentId)) return null;
  const external = hosts.some((host) =>
    host !== 'media.micup.gg' && host !== 'klipy.com' && !host.endsWith('.klipy.com'),
  );
  return external ? 'advertisement' : null;
}

function foldCase(text) {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u0307\p{Cf}]/gu, '')
    .replaceAll('ı', 'i');
}

function normalizeWords(text) {
  return foldCase(text).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function containsProfanity(text, list) {
  const words = ' ' + normalizeWords(text) + ' ';
  return list.split(/[,\r\n]+/).some((entry) => {
    const term = normalizeWords(entry);
    return term && words.includes(' ' + term + ' ');
  });
}

function isCaps(text) {
  const letters = text.match(/[\p{Lu}\p{Lt}\p{Ll}]/gu) ?? [];
  if (letters.length < 12) return false;
  const uppercase = letters.filter((letter) => letter === letter.toUpperCase());
  return uppercase.length / letters.length >= 0.7;
}

function spamState(history, message, now) {
  const key = [message.guildId, message.channelId, message.author.id].join(':');
  const previous = history.get(key);
  const recent = (previous?.recent ?? []).filter(({ at }) => now - at < REPEAT_WINDOW);
  const content = foldCase(message.content).trim().replace(/\s+/g, ' ');
  const signature = content && hash('sha256', content);
  recent.push({ at: now, signature });

  const state = {
    recent: recent.slice(-2 * RATE_LIMIT),
    warningAt: previous?.warningAt ?? -Infinity,
    blocked: recent.filter(({ at }) => now - at < RATE_WINDOW).length >= RATE_LIMIT ||
      Boolean(signature && recent.filter((entry) => entry.signature === signature).length >= REPEAT_LIMIT),
  };

  history.delete(key);
  history.set(key, state);
  if (history.size > HISTORY_LIMIT) history.delete(history.keys().next().value);
  return state;
}

export async function moderateMessage(message, client, { edited = false, now = Date.now() } = {}) {
  const { guildId, author, content } = message;
  if (!guildId || author.bot || message.fromSelf || message.fromWebhook || typeof content !== 'string') return false;

  const permissions = client.permissionsFor(guildId, author.id, message.channelId) ?? 0n;
  if ((permissions & BYPASS_PERMISSIONS) !== 0n) return false;

  const { app } = client;
  const spam = edited ? null : spamState(app.automodHistory, message, now);
  const hosts = [];
  const text = content.replace(LINKS, (link) => {
    const host = linkHost(link);
    if (!host) return link;
    hosts.push(host);
    return ' ';
  });
  let reason = hosts.length ? advertisement(message, app.settings, hosts, permissions) : null;
  if (!reason && containsProfanity(text, app.settings.get(guildId, 'automod.profanityWords'))) reason = 'profanity';
  if (!reason && isCaps(text)) reason = 'caps';
  if (!reason && spam?.blocked) reason = 'spam';
  if (!reason) return false;

  const warn = reason !== 'spam' || now - spam.warningAt >= RATE_WINDOW;
  if (reason === 'spam' && warn) spam.warningAt = now;

  try {
    await message.delete();
  } catch (error) {
    if (error.status === 404) return true;
    app.logger.warn('[automod] message deletion failed:', error);
  }

  if (warn) {
    const context = attachResponder(createContext(app, client, { guildId }), messageTarget(message));
    try {
      await context.warning('<@' + author.id + '> ' + context.t('automod.' + reason), { reply: false });
    } catch (error) {
      app.logger.warn('[automod] warning delivery failed:', error);
    }
  }
  return true;
}
