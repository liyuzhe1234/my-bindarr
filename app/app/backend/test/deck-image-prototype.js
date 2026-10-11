const sharp = require('sharp');
const cvScan = require('../src/cvScan');
const catalog = require('../src/tcgplayerCatalog');
const db = require('../src/db');
const fs = require('fs');
const path = require('path');

const indexDir = path.join(__dirname, '..', 'data', 'deck-image');
const localMeta = JSON.parse(fs.readFileSync(path.join(indexDir, 'pokemon-cn.json')));
const localRgb = fs.readFileSync(path.join(indexDir, 'pokemon-cn.rgb'));

async function localMatches(image, count = 3) {
  const { data } = await sharp(image).removeAlpha().resize(localMeta.width, localMeta.height, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
  const stride = localMeta.width * localMeta.height * 3;
  const best = [];
  for (let card = 0; card < localMeta.cards.length; card++) {
    let distance = 0;
    const offset = card * stride;
    for (let y = 0; y < localMeta.height; y++) {
      for (let x = 0; x < localMeta.width; x++) {
        if (x >= 9 && y >= 12) continue; // exporter quantity badge
        const p = (y * localMeta.width + x) * 3;
        for (let c = 0; c < 3; c++) distance += Math.abs(data[p + c] - localRgb[offset + p + c]);
      }
    }
    if (best.length < count || distance < best.at(-1).distance) {
      best.push({ ...localMeta.cards[card], distance });
      best.sort((a, b) => a.distance - b.distance);
      if (best.length > count) best.pop();
    }
  }
  return best;
}

const source = process.argv[2] || 'C:/Users/16601/Desktop/IMG_2303.PNG';
const quantities = [
  [1, 1, 2, 2, 2, 2, 1],
  [1, 1, 1, 1, 4, 4, 1],
  [4, 1, 1, 1, 1, 4, 3],
  [2, 1, 1, 1, 1, 1, 2],
  [2, 5, 5],
];

async function productName(productId) {
  const cached = await db.get(
    `SELECT c.id, c.name, c.printed_name, c.set_id, c.set_name, c.number, c.lang
       FROM tcgplayer_product t JOIN card_cache c ON c.id = t.card_id
      WHERE t.product_id = ? LIMIT 1`,
    [productId]
  ).catch(() => null);
  return cached || await catalog.lookup(productId);
}

(async () => {
  const meta = await sharp(source).metadata();
  const sx = meta.width / 898;
  const sy = meta.height / 1460;
  const rows = [];
  for (let row = 0; row < quantities.length; row++) {
    for (let col = 0; col < quantities[row].length; col++) {
      const crop = await sharp(source).extract({
        left: Math.round((43 + col * 117) * sx),
        top: Math.round((528 + row * 164) * sy),
        width: Math.round(108 * sx),
        height: Math.round(157 * sy),
      }).png().toBuffer();
      const result = await cvScan.match(crop, 'pokemon', 3, {
        lang: 'Chinese (Simplified)', cropped: true,
      });
      const first = result.candidates[0];
      rows.push({
        row: row + 1, col: col + 1, quantity: quantities[row][col],
        score: first?.score, margin: result.margin, gap: result.gap,
        productId: first?.productId,
        card: first ? await productName(first.productId) : null,
        local: await localMatches(crop),
      });
      console.log(JSON.stringify(rows.at(-1)));
    }
  }
  console.log(`TOTAL=${rows.reduce((n, r) => n + r.quantity, 0)} TYPES=${rows.length}`);
  process.exit(0);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
