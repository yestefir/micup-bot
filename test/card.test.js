import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import cardConfig from '../src/config/general/card.json' with { type: 'json' };
import { avatarUrl, clearAvatarCache, fetchAvatar } from '../src/utils/levels/card/avatar.js';
import {
  LEADERBOARD_LAYOUT,
  LEVEL_UP_LAYOUT,
  RANK_LAYOUT,
  fitText,
  leaderboardHeight,
  renderLeaderboardCard,
  renderLevelUpCard,
  renderRankCard,
} from '../src/utils/levels/card/render.js';

const { scale } = cardConfig;
const PNG_SIGNATURE = '89504e470d0a1a0a';

const labels = { level: 'Seviye', rank: 'Sıralama', totalXp: 'Toplam XP', levelUp: 'Seviye atladı' };
const rankData = (overrides = {}) => ({
  name: 'Şükrü Ağaoğlu',
  avatar: null,
  lang: 'tr',
  labels,
  level: 12,
  rank: '#3',
  ratio: 0.5,
  xpInto: '1.436',
  xpNeeded: '2.320',
  totalXp: '14.208',
  ...overrides,
});
const levelUpData = (overrides = {}) => ({ name: 'Şükrü Ağaoğlu', avatar: null, lang: 'tr', labels, from: 12, level: 13, ...overrides });

async function pixels(png) {
  const image = await loadImage(png);
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  return {
    width: image.width,
    height: image.height,
    at: (x, y) => Array.from(context.getImageData(Math.round(x * scale), Math.round(y * scale), 1, 1).data),
    brightIn: (x, y, width, height) => {
      const data = context.getImageData(x * scale, y * scale, width * scale, height * scale).data;
      let count = 0;
      for (let index = 0; index < data.length; index += 4) if (data[index] > 200) count += 1;
      return count;
    },
    litIn: (x, y, width, height, threshold = 60) => {
      const data = context.getImageData(x * scale, y * scale, width * scale, height * scale).data;
      let count = 0;
      for (let index = 0; index < data.length; index += 4) if (data[index] > threshold) count += 1;
      return count;
    },
    nearIn: (x, y, width, height, color, tolerance = 8) => {
      const data = context.getImageData(x * scale, y * scale, width * scale, height * scale).data;
      let count = 0;
      for (let index = 0; index < data.length; index += 4) {
        if (near([data[index], data[index + 1], data[index + 2]], color, tolerance)) count += 1;
      }
      return count;
    },
  };
}

function solidPng(color, size = 64) {
  const canvas = createCanvas(size, size);
  const context = canvas.getContext('2d');
  context.fillStyle = color;
  context.fillRect(0, 0, size, size);
  return canvas.toBuffer('image/png');
}

const near = (actual, expected, tolerance = 6) => actual.every((value, index) => Math.abs(value - expected[index]) <= tolerance);

test('rank card is a PNG at the configured scale', async () => {
  const png = await renderRankCard(rankData());
  assert.equal(png.subarray(0, 8).toString('hex'), PNG_SIGNATURE);
  const sample = await pixels(png);
  assert.equal(sample.width, RANK_LAYOUT.width * scale);
  assert.equal(sample.height, RANK_LAYOUT.height * scale);
  assert.ok(png.length < 200_000);
});

test('level up card is a PNG at the configured scale', async () => {
  const png = await renderLevelUpCard(levelUpData());
  assert.equal(png.subarray(0, 8).toString('hex'), PNG_SIGNATURE);
  const sample = await pixels(png);
  assert.equal(sample.width, LEVEL_UP_LAYOUT.width * scale);
  assert.equal(sample.height, LEVEL_UP_LAYOUT.height * scale);
});

test('the card corners are transparent and the surface is the flat background color', async () => {
  const sample = await pixels(await renderRankCard(rankData()));
  assert.equal(sample.at(1, 1)[3], 0);
  assert.deepEqual(sample.at(RANK_LAYOUT.width / 2, 12).slice(0, 3), [14, 16, 19]);
  assert.equal(sample.at(RANK_LAYOUT.width / 2, 12)[3], 255);
});

test('the progress bar fills exactly the given share of the track', async () => {
  const { contentX, contentRight, bar } = RANK_LAYOUT;
  const width = contentRight - contentX;
  const y = bar.y + bar.height / 2;
  const sample = await pixels(await renderRankCard(rankData({ ratio: 0.5 })));

  assert.ok(near(sample.at(contentX + width * 0.25, y), [242, 243, 245, 255]), 'inside the fill');
  assert.ok(near(sample.at(contentX + width * 0.48, y), [242, 243, 245, 255]), 'just before the end of the fill');
  assert.ok(near(sample.at(contentX + width * 0.52, y), [34, 38, 45, 255]), 'just after the end of the fill');
  assert.ok(near(sample.at(contentX + width * 0.75, y), [34, 38, 45, 255]), 'inside the track');
});

test('an empty bar shows only the track and a tiny share still shows a visible fill', async () => {
  const { contentX, bar } = RANK_LAYOUT;
  const y = bar.y + bar.height / 2;

  const empty = await pixels(await renderRankCard(rankData({ ratio: 0 })));
  assert.ok(near(empty.at(contentX + 8, y), [34, 38, 45, 255]));

  const tiny = await pixels(await renderRankCard(rankData({ ratio: 0.001 })));
  assert.ok(near(tiny.at(contentX + bar.height / 2, y), [242, 243, 245, 255]));
});

test('a full bar covers the whole track', async () => {
  const { contentX, contentRight, bar } = RANK_LAYOUT;
  const y = bar.y + bar.height / 2;
  const sample = await pixels(await renderRankCard(rankData({ ratio: 1 })));
  assert.ok(near(sample.at(contentRight - 8, y), [242, 243, 245, 255]));
  assert.ok(near(sample.at(contentX + 8, y), [242, 243, 245, 255]));
});

test('the avatar is cropped to a circle and drawn from the given image', async () => {
  const { x, y, size } = RANK_LAYOUT.avatar;
  const sample = await pixels(await renderRankCard(rankData({ avatar: solidPng('#C0392B') })));

  assert.ok(near(sample.at(x + size / 2, y + size / 2), [192, 57, 43, 255]), 'center');
  assert.ok(near(sample.at(x + size * 0.5, y + size * 0.08), [192, 57, 43, 255]), 'near the top edge');
  assert.ok(near(sample.at(x + 2, y + 2), [14, 16, 19, 255]), 'the corner of the square stays background');
});

test('a wide avatar is cropped to a square instead of stretched', async () => {
  const { x, y, size } = RANK_LAYOUT.avatar;
  const canvas = createCanvas(200, 100);
  const context = canvas.getContext('2d');
  context.fillStyle = '#2980B9';
  context.fillRect(0, 0, 200, 100);
  context.fillStyle = '#27AE60';
  context.fillRect(0, 0, 50, 100);
  context.fillRect(150, 0, 50, 100);
  const sample = await pixels(await renderRankCard(rankData({ avatar: canvas.toBuffer('image/png') })));

  assert.ok(near(sample.at(x + size / 2, y + size / 2), [41, 128, 185, 255]));
  assert.ok(near(sample.at(x + size * 0.15, y + size / 2), [41, 128, 185, 255]));
});

test('without an avatar a quiet placeholder circle with an initial is drawn', async () => {
  const { x, y, size } = RANK_LAYOUT.avatar;
  const sample = await pixels(await renderRankCard(rankData({ avatar: null })));

  assert.ok(near(sample.at(x + size * 0.5, y + size * 0.1), [26, 29, 35, 255]), 'placeholder fill');
  assert.ok(sample.brightIn(x + size * 0.25, y + size * 0.25, size * 0.5, size * 0.5) === 0, 'initial is muted, not bright');
  assert.ok(near(sample.at(x + 2, y + 2), [14, 16, 19, 255]));
});

test('an unreadable avatar buffer falls back to the placeholder', async () => {
  const { x, y, size } = RANK_LAYOUT.avatar;
  const sample = await pixels(await renderRankCard(rankData({ avatar: Buffer.from('not an image') })));
  assert.ok(near(sample.at(x + size * 0.5, y + size * 0.1), [26, 29, 35, 255]));
});

test('text is drawn: the level number and the name produce bright pixels', async () => {
  const sample = await pixels(await renderRankCard(rankData()));
  const { contentX, nameY, contentRight, valueY } = RANK_LAYOUT;
  assert.ok(sample.brightIn(contentX, nameY - 28, 200, 34) > 200, 'name');
  assert.ok(sample.brightIn(contentRight - 260, valueY - 36, 110, 40) > 150, 'level number');
});

const MUTED = [118, 124, 134, 255];
const UP_FONT = '700 72px "Inter Latin", "Inter Latin Ext", "Inter Cyrillic"';

function levelUpGeometry(from, to) {
  const context = createCanvas(10, 10).getContext('2d');
  context.font = UP_FONT;
  const layout = LEVEL_UP_LAYOUT;
  const fromWidth = context.measureText(String(from)).width;
  const toWidth = context.measureText(String(to)).width;
  const toLeft = layout.contentRight - toWidth;
  const arrowRight = toLeft - layout.arrow.gap;
  const arrowLeft = arrowRight - layout.arrow.width;
  const fromRight = arrowLeft - layout.arrow.gap;
  const centerY = layout.valueY - layout.valueSize * 0.36;
  return { fromWidth, toWidth, toLeft, arrowLeft, arrowRight, fromRight, fromLeft: fromRight - fromWidth, centerY };
}

test('level up card shows the old level muted, a drawn arrow, and the new level bright', async () => {
  const sample = await pixels(await renderLevelUpCard(levelUpData({ from: 2, level: 3 })));
  const { valueY, valueSize } = LEVEL_UP_LAYOUT;
  const geometry = levelUpGeometry(2, 3);
  const top = valueY - valueSize * 0.75;
  const band = valueSize * 0.8;

  assert.ok(sample.brightIn(geometry.toLeft, top, geometry.toWidth, band) > 300, 'new level is bright');
  assert.equal(sample.brightIn(geometry.fromLeft, top, geometry.fromWidth, band), 0, 'old level is not bright');
  assert.ok(sample.nearIn(geometry.fromLeft, top, geometry.fromWidth, band, MUTED) > 300, 'old level is muted');
});

test('level up card draws the arrow as a shape with a shaft and a head between the numbers', async () => {
  const sample = await pixels(await renderLevelUpCard(levelUpData({ from: 2, level: 3 })));
  const { arrow } = LEVEL_UP_LAYOUT;
  const g = levelUpGeometry(2, 3);
  const tip = g.arrowRight - arrow.thickness / 2;

  assert.ok(near(sample.at((g.arrowLeft + g.arrowRight) / 2 - 4, g.centerY), MUTED, 8), 'shaft');
  assert.ok(near(sample.at(tip - arrow.wing / 2, g.centerY - arrow.wing / 2), MUTED, 8), 'upper wing');
  assert.ok(near(sample.at(tip - arrow.wing / 2, g.centerY + arrow.wing / 2), MUTED, 8), 'lower wing');
  assert.ok(near(sample.at(g.arrowLeft + 6, g.centerY - 12), [14, 16, 19, 255], 4), 'nothing above the shaft');
  assert.equal(sample.brightIn(g.arrowLeft, g.centerY - 20, arrow.width, 40), 0, 'the arrow is not bright');
});

test('level up card has no title above the name and keeps the name beside the avatar', async () => {
  const sample = await pixels(await renderLevelUpCard(levelUpData()));
  const { contentX, nameY } = LEVEL_UP_LAYOUT;

  assert.equal(sample.litIn(contentX, 40, 240, nameY - 24 - 40), 0, 'the old title area is empty');
  assert.ok(sample.brightIn(contentX, nameY - 22, 200, 30) > 150, 'name');
});

test('level up card shrinks the name instead of touching the level numbers', async () => {
  const longName = 'A very long display name that should never overflow the card';
  const sample = await pixels(await renderLevelUpCard(levelUpData({ name: longName, from: 138, level: 139 })));
  const { nameY, arrow, contentX } = LEVEL_UP_LAYOUT;
  const g = levelUpGeometry(138, 139);
  const gap = g.fromLeft - 30;

  assert.equal(sample.litIn(gap, nameY - 24, 26, 34), 0, 'clear space before the old level');
  assert.ok(sample.brightIn(contentX, nameY - 22, 60, 30) > 40, 'the name still starts at the usual place');
  assert.ok(g.arrowRight - g.arrowLeft === arrow.width);
});

test('level up card handles jumps over several levels and large numbers', async () => {
  for (const [from, level] of [[9, 12], [99, 100], [99999, 100000]]) {
    const png = await renderLevelUpCard(levelUpData({ from, level }));
    assert.equal(png.subarray(0, 4).toString('hex'), '89504e47', `${from} to ${level}`);
  }
});

test('extreme inputs never throw and keep the card size', async () => {
  const names = ['', ' ', 'x'.repeat(600), '😀 emoji ✨ 名前', 'العربية', 'a\nb\tc'];
  for (const name of names) {
    const rank = await renderRankCard(rankData({ name, level: 99999, rank: '#1000000', totalXp: '1.234.567.890' }));
    const up = await renderLevelUpCard(levelUpData({ name, level: 99999 }));
    assert.equal((await pixels(rank)).width, RANK_LAYOUT.width * scale, JSON.stringify(name));
    assert.equal((await pixels(up)).width, LEVEL_UP_LAYOUT.width * scale, JSON.stringify(name));
  }
});

test('upper case labels follow the language', async () => {
  for (const lang of ['tr', 'ru', 'de', 'en-US']) {
    const png = await renderRankCard(rankData({ lang, labels: { ...labels, level: 'istanbul' } }));
    assert.equal(png.subarray(0, 4).toString('hex'), '89504e47', lang);
  }
  assert.equal('Seviye'.toLocaleUpperCase('tr'), 'SEVİYE');
});

test('fitText keeps short text, shortens long text with an ellipsis and never exceeds the width', () => {
  const context = createCanvas(10, 10).getContext('2d');
  context.font = '30px sans-serif';
  assert.equal(fitText(context, 'ali', 400), 'ali');

  const long = 'A very long display name that should never overflow the card';
  const fitted = fitText(context, long, 300);
  assert.ok(fitted.endsWith('…'));
  assert.ok(fitted.length < long.length);
  assert.ok(context.measureText(fitted).width <= 300);

  assert.equal(fitText(context, 'x', 1), '');
  assert.equal(fitText(context, 'xxxxx', context.measureText('…').width + 0.5), '…');
  assert.equal(fitText(context, 'xxxxx', -20), '');
  assert.equal(fitText(context, '', 10), '');
});

test('fitText does not split a surrogate pair', () => {
  const context = createCanvas(10, 10).getContext('2d');
  context.font = '30px sans-serif';
  const fitted = fitText(context, '😀😀😀😀😀😀😀😀😀😀', 120);
  assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(fitted));
  assert.ok(!/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(fitted));
});

beforeEach(() => clearAvatarCache());

const imageResponse = (body = Buffer.from('png-bytes'), headers = { 'content-type': 'image/png' }) =>
  new Response(body, { status: 200, headers });

test('avatarUrl asks for a png and survives a user without media support', () => {
  const asked = [];
  assert.equal(avatarUrl({ avatarURL: (options) => (asked.push(options), 'https://cdn.example/a.png') }), 'https://cdn.example/a.png');
  assert.deepEqual(asked, [{ format: 'png', size: 256 }]);
  assert.equal(avatarUrl({ avatarURL: () => { throw new Error('no media'); } }), null);
  assert.equal(avatarUrl({}), null);
});

test('fetchAvatar downloads once and serves repeats from the cache', async () => {
  let calls = 0;
  const fetcher = async () => (calls += 1, imageResponse());
  const first = await fetchAvatar('https://cdn.example/a.png', { fetcher, now: 1000 });
  const second = await fetchAvatar('https://cdn.example/a.png', { fetcher, now: 2000 });
  assert.equal(first.toString(), 'png-bytes');
  assert.equal(second, first);
  assert.equal(calls, 1);
});

test('fetchAvatar refreshes an expired cache entry', async () => {
  let calls = 0;
  const fetcher = async () => (calls += 1, imageResponse());
  await fetchAvatar('https://cdn.example/a.png', { fetcher, now: 0 });
  await fetchAvatar('https://cdn.example/a.png', { fetcher, now: 10 * 60 * 1000 + 1 });
  assert.equal(calls, 2);
});

test('fetchAvatar refuses everything that is not a small https image', async () => {
  const never = async () => {
    throw new Error('must not be called');
  };
  assert.equal(await fetchAvatar(null, { fetcher: never }), null);
  assert.equal(await fetchAvatar('', { fetcher: never }), null);
  assert.equal(await fetchAvatar('not a url', { fetcher: never }), null);
  assert.equal(await fetchAvatar('http://cdn.example/a.png', { fetcher: never }), null);
  assert.equal(await fetchAvatar('file:///etc/passwd', { fetcher: never }), null);

  const text = async () => imageResponse(Buffer.from('<html>'), { 'content-type': 'text/html' });
  assert.equal(await fetchAvatar('https://cdn.example/a', { fetcher: text }), null);

  const huge = async () => imageResponse(Buffer.from('x'), { 'content-type': 'image/png', 'content-length': String(10 * 1024 * 1024) });
  assert.equal(await fetchAvatar('https://cdn.example/b', { fetcher: huge }), null);

  const oversizedBody = async () => imageResponse(Buffer.alloc(4 * 1024 * 1024));
  assert.equal(await fetchAvatar('https://cdn.example/c', { fetcher: oversizedBody }), null);

  const empty = async () => imageResponse(Buffer.alloc(0));
  assert.equal(await fetchAvatar('https://cdn.example/d', { fetcher: empty }), null);
});

test('fetchAvatar turns failures into null', async () => {
  const notFound = async () => new Response('x', { status: 404, headers: { 'content-type': 'image/png' } });
  assert.equal(await fetchAvatar('https://cdn.example/a', { fetcher: notFound }), null);

  const broken = async () => {
    throw new Error('network down');
  };
  assert.equal(await fetchAvatar('https://cdn.example/b', { fetcher: broken }), null);
});

test('fetchAvatar passes a timeout signal and does not cache failures', async () => {
  const signals = [];
  let ok = false;
  const fetcher = async (url, options) => {
    signals.push(options.signal);
    return ok ? imageResponse() : new Response('x', { status: 500 });
  };
  assert.equal(await fetchAvatar('https://cdn.example/a', { fetcher }), null);
  ok = true;
  assert.ok(await fetchAvatar('https://cdn.example/a', { fetcher }));
  assert.ok(signals.every((signal) => signal instanceof AbortSignal));
});

test('the avatar cache is bounded', async () => {
  let calls = 0;
  const fetcher = async () => (calls += 1, imageResponse());
  for (let index = 0; index < 205; index += 1) await fetchAvatar(`https://cdn.example/${index}`, { fetcher, now: 1 });
  assert.equal(calls, 205);
  await fetchAvatar('https://cdn.example/204', { fetcher, now: 2 });
  assert.equal(calls, 205);
  await fetchAvatar('https://cdn.example/0', { fetcher, now: 2 });
  assert.equal(calls, 206);
});

const boardRows = (count, overrides = {}) =>
  Array.from({ length: count }, (_, index) => ({
    position: index + 1,
    name: String.fromCharCode(65 + (index % 26)),
    avatar: null,
    level: 9 - (index % 9),
    xp: String(1000 - index * 10),
    ...overrides,
  }));

const boardData = (rows, overrides = {}) => ({
  lang: 'tr',
  title: 'Liderlik tablosu',
  pageLabel: 'Sayfa 1/3',
  levelLabel: 'Seviye',
  rows,
  ...overrides,
});

const rowCenter = (index) => LEADERBOARD_LAYOUT.headerHeight + index * LEADERBOARD_LAYOUT.rowHeight + LEADERBOARD_LAYOUT.rowHeight / 2;
const AVATAR_X = LEADERBOARD_LAYOUT.padding + 24 + 16;

test('leaderboard card grows with the number of rows', async () => {
  for (const count of [1, 3, 10]) {
    const png = await renderLeaderboardCard(boardData(boardRows(count)));
    assert.equal(png.subarray(0, 8).toString('hex'), PNG_SIGNATURE);
    const sample = await pixels(png);
    assert.equal(sample.width, LEADERBOARD_LAYOUT.width * scale);
    assert.equal(sample.height, leaderboardHeight(count) * scale);
  }
  assert.ok(leaderboardHeight(10) > leaderboardHeight(1));
});

test('leaderboard card draws each avatar inside its own row', async () => {
  const rows = boardRows(3);
  rows[0].avatar = solidPng('#C0392B');
  rows[2].avatar = solidPng('#27AE60');
  const sample = await pixels(await renderLeaderboardCard(boardData(rows)));
  const half = LEADERBOARD_LAYOUT.avatarSize / 2;

  assert.ok(near(sample.at(AVATAR_X + half, rowCenter(0)), [192, 57, 43, 255]), 'first row');
  assert.ok(near(sample.at(AVATAR_X + half, rowCenter(2)), [39, 174, 96, 255]), 'third row');
  assert.ok(near(sample.at(AVATAR_X + half, rowCenter(1) - half * 0.8), [26, 29, 35, 255]), 'second row placeholder');
  assert.ok(near(sample.at(AVATAR_X + 1, rowCenter(0) - half + 1), [14, 16, 19, 255]), 'circle corner stays background');
});

test('leaderboard card separates the header and the rows with hairlines but not the last row', async () => {
  const sample = await pixels(await renderLeaderboardCard(boardData(boardRows(3))));
  const middle = LEADERBOARD_LAYOUT.width / 2;
  const { headerHeight, rowHeight, dividerY } = LEADERBOARD_LAYOUT;

  assert.ok(near(sample.at(middle, dividerY + 0.25), [30, 33, 39, 255], 3), 'under the header');
  assert.ok(near(sample.at(middle, headerHeight + rowHeight + 0.25), [30, 33, 39, 255], 3), 'between rows 1 and 2');
  assert.ok(near(sample.at(middle, headerHeight + 2 * rowHeight + 0.25), [30, 33, 39, 255], 3), 'between rows 2 and 3');
  assert.ok(near(sample.at(middle, headerHeight + 3 * rowHeight + 0.25), [14, 16, 19, 255], 3), 'nothing after the last row');
});

test('leaderboard card highlights only the first three positions', async () => {
  const sample = await pixels(await renderLeaderboardCard(boardData(boardRows(6))));
  const { padding } = LEADERBOARD_LAYOUT;
  const column = (index) => sample.brightIn(padding, rowCenter(index) - 12, 24, 24);

  for (const index of [0, 1, 2]) assert.ok(column(index) > 20, `position ${index + 1} is bright`);
  for (const index of [3, 4, 5]) assert.equal(column(index), 0, `position ${index + 1} is muted`);
});

test('leaderboard card keeps everything inside the padding even with huge numbers and long names', async () => {
  const rows = boardRows(10, { name: 'A very long display name that should never overflow the card at all', xp: '982.000.000.000', level: 99999 });
  rows.forEach((row, index) => {
    row.position = 99990 + index;
  });
  const sample = await pixels(await renderLeaderboardCard(boardData(rows, { pageLabel: 'Sayfa 99999/99999' })));
  const { width, padding } = LEADERBOARD_LAYOUT;
  const height = leaderboardHeight(10);

  assert.equal(sample.brightIn(width - padding + 2, 0, padding - 6, height - 30), 0, 'right padding stays empty');
  assert.equal(sample.brightIn(6, 20, padding - 12, height - 40), 0, 'left padding stays empty');
});

test('leaderboard card handles a broken avatar, no rows and odd names without throwing', async () => {
  const sample = await pixels(await renderLeaderboardCard(boardData(boardRows(1, { avatar: Buffer.from('nope') }))));
  assert.ok(near(sample.at(AVATAR_X + 16, rowCenter(0) - 13), [26, 29, 35, 255]));

  const empty = await renderLeaderboardCard(boardData([]));
  assert.equal((await pixels(empty)).height, leaderboardHeight(0) * scale);

  for (const name of ['', ' ', '😀 emoji ✨ 名前', 'العربية', 'x'.repeat(600)]) {
    const png = await renderLeaderboardCard(boardData(boardRows(2, { name })));
    assert.equal(png.subarray(0, 4).toString('hex'), '89504e47', JSON.stringify(name));
  }
});
