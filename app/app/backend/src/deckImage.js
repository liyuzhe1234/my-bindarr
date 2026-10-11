const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const db = require('./db');
const { parseCardRow } = require('./utils/priceHelpers');

const DATA = path.join(__dirname, '..', 'data', 'deck-image');
let indexCache;

function index() {
  if (indexCache) return indexCache;
  const meta = JSON.parse(fs.readFileSync(path.join(DATA, 'pokemon-cn.json'), 'utf8'));
  const rgb = fs.readFileSync(path.join(DATA, 'pokemon-cn.rgb'));
  const quantity = JSON.parse(fs.readFileSync(path.join(DATA, 'quantity-templates.json'), 'utf8'));
  const memberQuantity = JSON.parse(fs.readFileSync(path.join(DATA, 'quantity-templates-member.json'), 'utf8'));
  const decodeQuantity = value => ({
    width: value.width, height: value.height,
    templates: Object.fromEntries(Object.entries(value.templates).map(([key, values]) =>
      [key, (Array.isArray(values) ? values : [values]).map(item => Buffer.from(item, 'base64'))]
    )),
  });
  indexCache = {
    ...meta, rgb,
    quantity: decodeQuantity(quantity),
    memberQuantity: decodeQuantity(memberQuantity),
  };
  return indexCache;
}

async function feature(image, width, height) {
  return (await sharp(image).removeAlpha().resize(width, height, { fit: 'fill' }).raw().toBuffer());
}

function nearestCards(pixels, idx, count = 4) {
  const stride = idx.width * idx.height * 3;
  const best = [];
  for (let card = 0; card < idx.cards.length; card++) {
    let distance = 0;
    const offset = card * stride;
    for (let y = 0; y < idx.height; y++) {
      for (let x = 0; x < idx.width; x++) {
        // 集换社的数量角标覆盖卡图右下角；这块不能参与卡图比较。
        if (x >= Math.floor(idx.width * 0.75) && y >= Math.floor(idx.height * 0.75)) continue;
        const p = (y * idx.width + x) * 3;
        distance += Math.abs(pixels[p] - idx.rgb[offset + p]);
        distance += Math.abs(pixels[p + 1] - idx.rgb[offset + p + 1]);
        distance += Math.abs(pixels[p + 2] - idx.rgb[offset + p + 2]);
      }
    }
    if (best.length < count || distance < best[best.length - 1].distance) {
      best.push({ ...idx.cards[card], distance });
      best.sort((a, b) => a.distance - b.distance);
      if (best.length > count) best.pop();
    }
  }
  return best;
}

async function quantityOf(image, idx) {
  const q = idx.quantity;
  const pixels = await sharp(image).greyscale().resize(q.width, q.height, { fit: 'fill' }).raw().toBuffer();
  let winner = { quantity: 1, distance: Infinity };
  for (const [label, templates] of Object.entries(q.templates)) {
    for (const template of templates) {
      let distance = 0;
      for (let i = 0; i < pixels.length; i++) distance += Math.abs(pixels[i] - template[i]);
      if (distance < winner.distance) winner = { quantity: Number(label), distance };
    }
  }
  return winner;
}

async function hydrate(matches) {
  const ids = [...new Set(matches.flatMap(row => row.map(card => card.id)))];
  if (!ids.length) return new Map();
  const placeholders = ids.map(() => '?').join(',');
  const rows = await db.all(`SELECT * FROM card_cache WHERE id IN (${placeholders})`, ids);
  return new Map(rows.map(row => [row.id, parseCardRow(row)]));
}

async function findListTop(buffer, width, height) {
  // Average each complete image row down to one grey pixel. 集换社 exports use a
  // grey hero followed by a near-white deck list, but the hero height changes
  // with the title wrapping and export version. Detect that boundary instead of
  // inheriting the first sample's y=402 forever.
  // Sample the centre strip. The membership-app template rounds the white
  // panel's top corners, so averaging the full row mixes in black corners and
  // can hide the transition completely.
  const column = await sharp(buffer)
    .extract({ left: Math.round(width * 0.4), top: 0, width: Math.max(1, Math.round(width * 0.2)), height })
    .greyscale().resize(1, height, { fit: 'fill' }).raw().toBuffer();
  const from = Math.floor(height * 0.2);
  const to = Math.floor(height * 0.45);
  for (let y = from + 8; y < to; y++) {
    let before = 0;
    let after = 0;
    for (let n = 1; n <= 8; n++) {
      before += column[y - n];
      after += column[Math.min(height - 1, y + n - 1)];
    }
    before /= 8;
    after /= 8;
    if (after > 238 && after - before > 28) return y;
  }
  // Compatibility fallback for unusual crops; recognition will still return a
  // reviewable draft instead of failing outright.
  return Math.round(402 * (width / 898));
}

async function recognize(buffer) {
  const idx = index();
  const metadata = await sharp(buffer).metadata();
  if (!metadata.width || !metadata.height || metadata.width < 500) throw new Error('图片分辨率太低');
  const scale = metadata.width / 898;
  const listTop = await findListTop(buffer, metadata.width, metadata.height);
  const headerStats = await sharp(buffer).extract({
    left: Math.round(metadata.width * 0.70), top: Math.round(metadata.height * 0.08),
    width: Math.max(1, Math.round(metadata.width * 0.08)),
    height: Math.max(1, Math.round(metadata.height * 0.12)),
  }).stats();
  const headerMean = headerStats.channels.slice(0, 3).reduce((sum, channel) => sum + channel.mean, 0) / 3;
  const memberFormat = headerMean < 175;
  const layout = memberFormat ? {
    name: 'pokemon-member-deck-image', baseWidth: 1053, columns: 8,
    left: 48, xStep: 120, cardWidth: 107, cardHeight: 147,
    firstTopOffset: 115, yStep: 168,
    badge: { left: 78, top: 108, width: 29, height: 35 },
    quantity: idx.memberQuantity,
  } : {
    name: 'jihuanshe-deck-image', baseWidth: 898, columns: 7,
    left: 43, xStep: 117, cardWidth: 108, cardHeight: 157,
    firstTopOffset: 126, yStep: 164,
    badge: { left: 84, top: 127, width: 24, height: 28 },
    quantity: idx.quantity,
  };
  const layoutScale = metadata.width / layout.baseWidth;
  const cardW = Math.round(layout.cardWidth * layoutScale);
  const cardH = Math.round(layout.cardHeight * layoutScale);
  const raw = [];

  // 集换社卡组助手的导出图使用固定的 7 列网格；高度随卡牌种类数增长。
  for (let row = 0; ; row++) {
    const top = Math.round(listTop + (layout.firstTopOffset + row * layout.yStep) * layoutScale);
    if (top + cardH > metadata.height - Math.round(18 * scale)) break;
    let foundInRow = 0;
    for (let col = 0; col < layout.columns; col++) {
      const left = Math.round((layout.left + col * layout.xStep) * layoutScale);
      if (left + cardW > metadata.width) continue;
      const card = await sharp(buffer).extract({ left, top, width: cardW, height: cardH }).png().toBuffer();
      const stats = await sharp(card).stats();
      const mean = stats.channels.slice(0, 3).reduce((sum, x) => sum + x.mean, 0) / 3;
      if (mean > 248 && stats.entropy < 1.2) continue;
      foundInRow++;
      const badge = await sharp(card).extract({
        left: Math.round(layout.badge.left / layout.cardWidth * cardW),
        top: Math.round(layout.badge.top / layout.cardHeight * cardH),
        width: Math.max(8, Math.round(layout.badge.width / layout.cardWidth * cardW)),
        height: Math.max(8, Math.round(layout.badge.height / layout.cardHeight * cardH)),
      }).png().toBuffer();
      raw.push({
        row, col, card,
        quantity: (await quantityOf(badge, { quantity: layout.quantity })).quantity,
        matches: nearestCards(await feature(card, idx.width, idx.height), idx),
      });
    }
    if (!foundInRow) break;
  }
  if (!raw.length) throw new Error('没有检测到集换社卡组网格');
  const cardsById = await hydrate(raw.map(x => x.matches));
  const cards = raw.map(item => ({
    row: item.row, col: item.col, quantity: item.quantity,
    candidates: item.matches.map((match, rank) => ({
      ...match,
      confidence: rank === 0 && item.matches[1]
        ? Math.max(0, Math.min(1, (item.matches[1].distance - match.distance) / Math.max(item.matches[1].distance, 1)))
        : 0,
      card: cardsById.get(match.id) || { id: match.id, name: match.sourceId },
    })),
  }));
  return {
    source: layout.name, width: metadata.width, height: metadata.height,
    total: cards.reduce((sum, card) => sum + card.quantity, 0), cards,
  };
}

module.exports = { recognize };
