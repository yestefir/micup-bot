import cardConfig from '../../../config/general/card.json' with { type: 'json' };
import { FONT_STACK, registerFonts } from './fonts.js';

const { colors, scale } = cardConfig;

export const RANK_LAYOUT = Object.freeze({
  width: 900,
  height: 240,
  radius: 24,
  avatar: { x: 44, y: 66, size: 108 },
  contentX: 188,
  contentRight: 856,
  bar: { y: 146, height: 10 },
  labelY: 68,
  valueY: 110,
  nameY: 110,
  captionY: 192,
});

export const REWARD_ROW = Object.freeze({ extra: 44, y: 238 });

export const LEVEL_UP_LAYOUT = Object.freeze({
  width: 720,
  height: 176,
  radius: 24,
  avatar: { x: 40, y: 44, size: 88 },
  contentX: 156,
  contentRight: 680,
  nameY: 98,
  valueY: 114,
  valueSize: 72,
  arrow: { width: 36, gap: 22, thickness: 4, wing: 11 },
});

export const LEADERBOARD_LAYOUT = Object.freeze({
  width: 720,
  radius: 24,
  padding: 40,
  titleY: 56,
  dividerY: 76,
  headerHeight: 88,
  rowHeight: 52,
  bottom: 24,
  avatarSize: 32,
  topRanks: 3,
});

export const WELCOME_LAYOUT = Object.freeze({
  width: 900,
  height: 300,
  radius: 24,
  avatar: { x: 390, y: 36, size: 120 },
  labelY: 196,
  nameY: 240,
  subtitleY: 270,
  textWidth: 780,
});

export const leaderboardHeight = (rowCount) =>
  LEADERBOARD_LAYOUT.headerHeight + rowCount * LEADERBOARD_LAYOUT.rowHeight + LEADERBOARD_LAYOUT.bottom;

let canvasModule;

async function loadCanvas() {
  if (!canvasModule) {
    const loaded = await import('@napi-rs/canvas');
    registerFonts(loaded.GlobalFonts);
    canvasModule = loaded;
  }
  return canvasModule;
}

export function fitText(context, text, maxWidth) {
  if (context.measureText(text).width <= maxWidth) return text;
  const characters = Array.from(text);
  while (characters.length > 0) {
    characters.pop();
    const candidate = `${characters.join('').trimEnd()}…`;
    if (context.measureText(candidate).width <= maxWidth) return candidate;
  }
  return '';
}

const font = (weight, size) => `${weight} ${size}px ${FONT_STACK}`;

function setup(canvasApi, layout) {
  const canvas = canvasApi.createCanvas(layout.width * scale, layout.height * scale);
  const context = canvas.getContext('2d');
  context.scale(scale, scale);
  context.textBaseline = 'alphabetic';
  return { canvas, context };
}

function drawSurface(context, layout) {
  context.beginPath();
  context.roundRect(0.5, 0.5, layout.width - 1, layout.height - 1, layout.radius);
  context.fillStyle = colors.background;
  context.fill();
  context.lineWidth = 1;
  context.strokeStyle = colors.border;
  context.stroke();
}

function drawAvatar(context, image, name, { x, y, size }) {
  context.save();
  context.beginPath();
  context.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  context.closePath();
  context.clip();

  if (image) {
    const side = Math.min(image.width, image.height);
    const sourceX = (image.width - side) / 2;
    const sourceY = (image.height - side) / 2;
    context.drawImage(image, sourceX, sourceY, side, side, x, y, size, size);
  } else {
    context.fillStyle = colors.placeholder;
    context.fillRect(x, y, size, size);
    context.fillStyle = colors.muted;
    context.font = font(600, Math.round(size * 0.42));
    context.textAlign = 'center';
    const initial = Array.from(name.trim())[0]?.toLocaleUpperCase() ?? '?';
    context.fillText(initial, x + size / 2, y + size / 2 + size * 0.15);
  }
  context.restore();
}

function spaced(context, value) {
  if ('letterSpacing' in context) context.letterSpacing = value;
}

function drawLabel(context, text, x, y, align, lang) {
  context.font = font(600, 12);
  context.fillStyle = colors.muted;
  context.textAlign = align;
  spaced(context, '1.6px');
  context.fillText(text.toLocaleUpperCase(lang), x, y);
  spaced(context, '0px');
}

function columnWidth(context, label, value, lang, valueFont) {
  context.font = font(600, 12);
  spaced(context, '1.6px');
  const labelWidth = context.measureText(label.toLocaleUpperCase(lang)).width;
  spaced(context, '0px');
  context.font = valueFont;
  return Math.max(labelWidth, context.measureText(value).width);
}

async function open(data) {
  const canvasApi = await loadCanvas();
  const image = data.avatar ? await canvasApi.loadImage(data.avatar).catch(() => null) : null;
  return { canvasApi, image };
}

export async function renderRankCard(data) {
  const layout = data.reward ? { ...RANK_LAYOUT, height: RANK_LAYOUT.height + REWARD_ROW.extra } : RANK_LAYOUT;
  const { canvasApi, image } = await open(data);
  const { canvas, context } = setup(canvasApi, layout);
  const { lang, labels } = data;

  drawSurface(context, layout);
  drawAvatar(context, image, data.name, layout.avatar);

  const valueFont = font(700, 44);
  const gap = 44;
  const rankValue = data.rank;
  const levelValue = String(data.level);
  const rankWidth = columnWidth(context, labels.rank, rankValue, lang, valueFont);
  const levelWidth = columnWidth(context, labels.level, levelValue, lang, valueFont);
  const rankRight = layout.contentRight;
  const levelRight = rankRight - rankWidth - gap;

  drawLabel(context, labels.level, levelRight, layout.labelY, 'right', lang);
  context.font = valueFont;
  context.fillStyle = colors.text;
  context.textAlign = 'right';
  context.fillText(levelValue, levelRight, layout.valueY);

  drawLabel(context, labels.rank, rankRight, layout.labelY, 'right', lang);
  context.font = valueFont;
  context.fillStyle = colors.secondary;
  context.textAlign = 'right';
  context.fillText(rankValue, rankRight, layout.valueY);

  context.font = font(600, 30);
  context.fillStyle = colors.text;
  context.textAlign = 'left';
  const nameWidth = levelRight - levelWidth - 32 - layout.contentX;
  context.fillText(fitText(context, data.name, nameWidth), layout.contentX, layout.nameY);

  const barWidth = layout.contentRight - layout.contentX;
  const { y, height } = layout.bar;
  context.beginPath();
  context.roundRect(layout.contentX, y, barWidth, height, height / 2);
  context.fillStyle = colors.track;
  context.fill();

  if (data.ratio > 0) {
    const fillWidth = Math.max(height, Math.min(barWidth, data.ratio * barWidth));
    context.beginPath();
    context.roundRect(layout.contentX, y, fillWidth, height, height / 2);
    context.fillStyle = colors.fill;
    context.fill();
  }

  context.font = font(400, 16);
  context.fillStyle = colors.secondary;
  context.textAlign = 'left';
  context.fillText(`${data.xpInto} / ${data.xpNeeded} XP`, layout.contentX, layout.captionY);

  context.font = font(600, 16);
  context.fillStyle = colors.text;
  context.textAlign = 'right';
  const totalText = data.totalXp;
  context.fillText(totalText, layout.contentRight, layout.captionY);
  const totalTextWidth = context.measureText(totalText).width;
  context.font = font(400, 16);
  context.fillStyle = colors.muted;
  context.fillText(labels.totalXp, layout.contentRight - totalTextWidth - 10, layout.captionY);

  if (data.reward) drawReward(context, data.reward, layout, data.lang);

  return canvas.toBuffer('image/png');
}

function drawReward(context, reward, layout, lang) {
  rule(context, layout.contentX, REWARD_ROW.y - 24, layout.contentRight - layout.contentX);

  drawLabel(context, reward.label, layout.contentX, REWARD_ROW.y, 'left', lang);
  context.font = font(600, 12);
  spaced(context, '1.6px');
  const labelWidth = context.measureText(reward.label.toLocaleUpperCase(lang)).width;
  spaced(context, '0px');

  context.font = font(600, 16);
  context.fillStyle = colors.text;
  context.textAlign = 'left';
  const x = layout.contentX + labelWidth + 16;
  context.fillText(fitText(context, reward.text, layout.contentRight - x), x, REWARD_ROW.y + 1);
}

export async function renderLevelUpCard(data) {
  const layout = LEVEL_UP_LAYOUT;
  const { canvasApi, image } = await open(data);
  const { canvas, context } = setup(canvasApi, layout);
  const { arrow } = layout;

  drawSurface(context, layout);
  drawAvatar(context, image, data.name, layout.avatar);

  const fromText = String(data.from);
  const toText = String(data.level);
  context.font = font(700, layout.valueSize);
  const fromWidth = context.measureText(fromText).width;
  const toWidth = context.measureText(toText).width;

  const toRight = layout.contentRight;
  const arrowRight = toRight - toWidth - arrow.gap;
  const arrowLeft = arrowRight - arrow.width;
  const fromRight = arrowLeft - arrow.gap;

  context.textAlign = 'right';
  context.fillStyle = colors.muted;
  context.fillText(fromText, fromRight, layout.valueY);
  context.fillStyle = colors.text;
  context.fillText(toText, toRight, layout.valueY);
  drawArrow(context, arrowLeft, arrowRight, layout.valueY - layout.valueSize * 0.36, arrow);

  context.font = font(600, 28);
  context.fillStyle = colors.text;
  context.textAlign = 'left';
  const blockWidth = toRight - (fromRight - fromWidth);
  const nameWidth = layout.contentRight - blockWidth - 36 - layout.contentX;
  context.fillText(fitText(context, data.name, nameWidth), layout.contentX, layout.nameY);

  return canvas.toBuffer('image/png');
}

export async function renderWelcomeCard(data) {
  const layout = WELCOME_LAYOUT;
  const { canvasApi, image } = await open(data);
  const { canvas, context } = setup(canvasApi, layout);
  const center = layout.width / 2;

  drawSurface(context, layout);
  drawAvatar(context, image, data.name, layout.avatar);

  drawLabel(context, data.labels.welcome, center, layout.labelY, 'center', data.lang);

  context.font = font(700, 36);
  context.fillStyle = colors.text;
  context.textAlign = 'center';
  context.fillText(fitText(context, data.name, layout.textWidth), center, layout.nameY);

  context.font = font(400, 16);
  context.fillStyle = colors.secondary;
  context.fillText(fitText(context, data.subtitle, layout.textWidth), center, layout.subtitleY);

  return canvas.toBuffer('image/png');
}

function drawArrow(context, left, right, centerY, { thickness, wing }) {
  context.save();
  context.strokeStyle = colors.muted;
  context.lineWidth = thickness;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.beginPath();
  context.moveTo(left + thickness / 2, centerY);
  context.lineTo(right - thickness / 2, centerY);
  context.moveTo(right - thickness / 2 - wing, centerY - wing);
  context.lineTo(right - thickness / 2, centerY);
  context.lineTo(right - thickness / 2 - wing, centerY + wing);
  context.stroke();
  context.restore();
}

function widest(context, fontValue, texts) {
  context.font = fontValue;
  return texts.reduce((largest, text) => Math.max(largest, context.measureText(text).width), 0);
}

function rule(context, x, y, width) {
  context.fillStyle = colors.border;
  context.fillRect(x, y, width, 1);
}

export async function renderLeaderboardCard(data) {
  const layout = LEADERBOARD_LAYOUT;
  const { padding, avatarSize, rowHeight } = layout;
  const height = leaderboardHeight(data.rows.length);
  const canvasApi = await loadCanvas();
  const images = await Promise.all(
    data.rows.map((row) => (row.avatar ? canvasApi.loadImage(row.avatar).catch(() => null) : null)),
  );
  const { canvas, context } = setup(canvasApi, { width: layout.width, height });
  const left = padding;
  const right = layout.width - padding;

  drawSurface(context, { width: layout.width, height, radius: layout.radius });

  context.font = font(400, 14);
  context.fillStyle = colors.muted;
  context.textAlign = 'right';
  context.fillText(data.pageLabel, right, layout.titleY - 2);
  const pageWidth = context.measureText(data.pageLabel).width;

  context.font = font(600, 24);
  context.fillStyle = colors.text;
  context.textAlign = 'left';
  context.fillText(fitText(context, data.title, right - left - pageWidth - 24), left, layout.titleY);

  rule(context, left, layout.dividerY, right - left);

  const positionWidth = Math.max(24, widest(context, font(700, 16), data.rows.map((row) => String(row.position))));
  const avatarX = left + positionWidth + 16;
  const nameX = avatarX + avatarSize + 16;
  context.font = font(400, 14);
  const unitWidth = context.measureText('XP').width;
  const xpWidth = widest(context, font(600, 16), data.rows.map((row) => row.xp)) + unitWidth + 7;
  const levelTexts = data.rows.map((row) => `${data.levelLabel} ${row.level}`);
  const levelWidth = widest(context, font(400, 15), levelTexts);
  const levelRight = right - xpWidth - 28;
  const nameWidth = levelRight - levelWidth - 24 - nameX;

  data.rows.forEach((row, index) => {
    const top = layout.headerHeight + index * rowHeight;
    const centerY = top + rowHeight / 2;
    const leading = row.position <= layout.topRanks;

    if (index > 0) rule(context, left, top, right - left);

    context.font = font(leading ? 700 : 600, 16);
    context.fillStyle = leading ? colors.text : colors.muted;
    context.textAlign = 'left';
    context.fillText(String(row.position), left, centerY + 6);

    drawAvatar(context, images[index], row.name, { x: avatarX, y: centerY - avatarSize / 2, size: avatarSize });

    context.font = font(600, 17);
    context.fillStyle = colors.text;
    context.textAlign = 'left';
    context.fillText(fitText(context, row.name, nameWidth), nameX, centerY + 6);

    context.font = font(400, 15);
    context.fillStyle = colors.secondary;
    context.textAlign = 'right';
    context.fillText(levelTexts[index], levelRight, centerY + 5);

    context.font = font(400, 14);
    context.fillStyle = colors.muted;
    context.textAlign = 'right';
    context.fillText('XP', right, centerY + 6);

    context.font = font(600, 16);
    context.fillStyle = colors.text;
    context.fillText(row.xp, right - unitWidth - 7, centerY + 6);
  });

  return canvas.toBuffer('image/png');
}
